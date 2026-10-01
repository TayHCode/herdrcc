import { execFile } from "node:child_process";
import { Router, json } from "express";
import type { LiveAgent, LiveChat, RecentTask, LiveState, LiveTab, LiveWorkspace, AgentStatus } from "../shared/live.js";
import { loadLayout } from "./layout.js";
import { checkConsoleLine, classifyProcess, type PaneClass } from "./process.js";
import { lastModified, lastRequest, readChat, sessionFile } from "./chat.js";

/** A named Herdr session. `default` is the one `herdr` uses without --session. */
export interface SessionInfo { name: string; running: boolean; default: boolean }

export interface LiveSource {
  sessions(): Promise<SessionInfo[]>;
  state(session?: string): Promise<LiveState>;
  output(paneId: string, lines: number, session?: string): Promise<string>;
  prompt(paneId: string, text: string, session?: string): Promise<void>;
  keys(paneId: string, keys: string[], session?: string): Promise<void>;
  /** What is in the pane's foreground, which decides how text may be sent. */
  process(paneId: string, session?: string): Promise<{ cls: PaneClass; command: string | null }>;
  /** Types one line into the pane and presses Enter (for custom consoles). */
  run(paneId: string, line: string, session?: string): Promise<void>;
  chat(paneId: string, session?: string): Promise<LiveChat>;
  recent(session?: string): Promise<RecentTask[]>;
  rename(paneId: string, name: string | null, session?: string): Promise<void>;
  close(paneId: string, session?: string): Promise<void>;
}

const CLI = process.env.HERDR_CONTROL_CENTER_CLI?.trim() || "herdr";
const PANE_ID = /^[A-Za-z0-9:_-]{1,40}$/u;
const SAFE_KEYS = new Set(["enter", "esc", "escape", "tab", "up", "down", "left", "right", "y", "n", "1", "2", "3", "ctrl-c"]);
const STATUSES = new Set<AgentStatus>(["idle", "working", "blocked", "done", "unknown"]);

function run(args: string[], session?: string, timeout = 8000): Promise<string> {
  const prefix = session && session !== "default" ? ["--session", session] : [];
  return new Promise((resolve, reject) => {
    execFile(CLI, [...prefix, ...args], { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function status(value: unknown): AgentStatus {
  return typeof value === "string" && STATUSES.has(value as AgentStatus) ? (value as AgentStatus) : "unknown";
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const KNOWN_KINDS = new Set(["codex", "claude", "gemini", "opencode", "aider", "amp", "cursor", "droid", "goose", "pi", "qwen", "copilot", "kimi", "hermes"]);
/** Some setups put an agent's display name (like "Ada") in the `agent` field instead of its kind. */
function isKnownKind(value: string | null): boolean {
  return value === null || KNOWN_KINDS.has(value.toLowerCase());
}

function agentName(raw: Record<string, unknown>): string | null {
  const name = str(raw.name);
  if (name) return name;
  const title = str(raw.terminal_title_stripped) ?? str(raw.terminal_title);
  return title ? title.split("|")[0].trim() || null : null;
}

/** "Ada - Checkout" -> "Ada"; only used when the agent itself has no name. */
function wsShort(label: string | null): string | null {
  return label ? label.split(" - ")[0].trim() || label : null;
}

export class HerdrLive implements LiveSource {
  async sessions(): Promise<SessionInfo[]> {
    const parsed = JSON.parse(await run(["session", "list", "--json"])) as { sessions?: Array<Record<string, unknown>> };
    return (parsed.sessions ?? []).map((x) => ({ name: String(x.name), running: x.running === true, default: x.default === true }));
  }

  async state(session?: string): Promise<LiveState> {
    const parsed = JSON.parse(await run(["api", "snapshot"], session)) as { result?: { snapshot?: Record<string, unknown[]> } };
    const snap = parsed.result?.snapshot ?? {};
    const workspaces: LiveWorkspace[] = (snap.workspaces ?? []).map((w) => {
      const r = w as Record<string, unknown>;
      return {
        id: String(r.workspace_id), label: str(r.label), number: Number(r.number) || 0,
        status: status(r.agent_status), focused: r.focused === true,
        tabCount: Number(r.tab_count) || 0, paneCount: Number(r.pane_count) || 0,
      };
    });
    const tabs: LiveTab[] = (snap.tabs ?? []).map((t) => {
      const r = t as Record<string, unknown>;
      return { id: String(r.tab_id), workspaceId: String(r.workspace_id), label: str(r.label), status: status(r.agent_status) };
    });
    const wsLabel = new Map(workspaces.map((w) => [w.id, w.label]));
    const perWorkspace = new Map<string, number>();
    for (const a of snap.agents ?? []) { const id = String((a as Record<string, unknown>).workspace_id); perWorkspace.set(id, (perWorkspace.get(id) ?? 0) + 1); }
    // An unnamed agent alone in its workspace takes the workspace's name; otherwise fall back to its terminal title.
    const nameOf = (r: Record<string, unknown>) => str(r.name)
      ?? (isKnownKind(str(r.agent)) ? null : str(r.agent))
      ?? (perWorkspace.get(String(r.workspace_id)) === 1 ? wsShort(wsLabel.get(String(r.workspace_id)) ?? null) : null)
      ?? agentName(r);
    const agents: LiveAgent[] = (snap.agents ?? []).map((a) => {
      const r = a as Record<string, unknown>;
      const sessionInfo = r.agent_session as Record<string, unknown> | undefined;
      // Some setups put an agent's display name in `agent`; the real kind is then in the session record.
      const kind = isKnownKind(str(r.agent)) ? str(r.agent) : str(sessionInfo?.agent);
      return {
        paneId: String(r.pane_id), workspaceId: String(r.workspace_id), tabId: String(r.tab_id),
        name: nameOf(r), kind, status: status(r.agent_status),
        cwd: str(r.foreground_cwd) ?? str(r.cwd), title: str(r.terminal_title_stripped) ?? str(r.terminal_title),
        ready: r.interactive_ready === true, stateSeq: Number(r.state_change_seq) || 0,
        session: str((r.agent_session as Record<string, unknown> | undefined)?.value),
        lastActiveAt: lastModified(sessionFile(kind, str(sessionInfo?.value))),
      };
    });
    return { source: "herdr", observedAt: new Date().toISOString(), workspaces, tabs, agents };
  }

  async output(paneId: string, lines: number, session?: string): Promise<string> {
    return run(["agent", "read", paneId, "--source", "recent-unwrapped", "--lines", String(lines)], session);
  }

  async prompt(paneId: string, text: string, session?: string): Promise<void> {
    await run(["agent", "prompt", paneId, text], session);
  }

  async keys(paneId: string, keys: string[], session?: string): Promise<void> {
    await run(["agent", "send-keys", paneId, ...keys], session);
  }

  async process(paneId: string, session?: string): Promise<{ cls: PaneClass; command: string | null }> {
    try { return classifyProcess(JSON.parse(await run(["pane", "process-info", "--pane", paneId], session))); }
    catch { return { cls: "unknown", command: null }; }
  }

  async run(paneId: string, line: string, session?: string): Promise<void> {
    await run(["pane", "run", paneId, line], session);
  }

  async chat(paneId: string, session?: string): Promise<LiveChat> {
    const agent = (await this.state(session)).agents.find((a) => a.paneId === paneId);
    const items = agent ? readChat(agent.kind, agent.session) : null;
    return { paneId, available: items !== null, items: items ?? [], at: new Date().toISOString() };
  }

  async recent(session?: string): Promise<RecentTask[]> {
    const out: RecentTask[] = [];
    for (const a of (await this.state(session)).agents) {
      const request = lastRequest(a.kind, a.session);
      if (request) out.push({ paneId: a.paneId, text: request.text.slice(0, 280), at: request.at });
    }
    return out.sort((x, y) => (y.at ?? "").localeCompare(x.at ?? "")).slice(0, 12);
  }

  async rename(paneId: string, name: string | null, session?: string): Promise<void> {
    await run(name ? ["agent", "rename", paneId, name] : ["agent", "rename", paneId, "--clear"], session);
  }

  async close(paneId: string, session?: string): Promise<void> {
    await run(["pane", "close", paneId], session);
  }
}

export function createLiveRouter(source: LiveSource): Router {
  const router = Router();
  router.use("/api/v2", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use("/api/v2", json({ limit: "64kb" }));

  const SESSION_NAME = /^[A-Za-z0-9._-]{1,64}$/u;
  let known: { at: number; sessions: SessionInfo[] } | null = null;
  const knownSessions = async () => {
    if (!known || Date.now() - known.at > 5000) known = { at: Date.now(), sessions: await source.sessions() };
    return known.sessions;
  };

  // `?session=name` picks a named Herdr session. Only sessions Herdr lists as running are accepted, because
  // `herdr --session <unknown>` would otherwise create one.
  router.use("/api/v2", async (req, res, next) => {
    const raw = req.query.session;
    if (req.path === "/sessions" || raw === undefined || raw === "" || raw === "default") { res.locals.session = undefined; return next(); }
    if (typeof raw !== "string" || !SESSION_NAME.test(raw)) { res.status(400).json({ error: { code: "bad_session", message: "Invalid session name." } }); return; }
    try {
      const match = (await knownSessions()).find((x) => x.name === raw);
      if (!match || !match.running) { res.status(404).json({ error: { code: "no_session", message: "That Herdr session is not running." } }); return; }
    } catch { res.status(503).json({ error: { code: "request_failed", message: "Herdr could not be reached." } }); return; }
    res.locals.session = raw;
    next();
  });

  /**
   * Decides, on the server, how text may reach a pane. A recognized agent takes `herdr agent prompt`; a custom console
   * takes one typed line through `pane run`; a plain shell, or anything unidentifiable, is never written to.
   */
  const paneClass = async (pane: string, session: string | undefined): Promise<PaneClass> => {
    const { cls } = await source.process(pane, session);
    return cls;
  };

  const fail = (res: import("express").Response, code: number, message: string) =>
    res.status(code).json({ error: { code: "request_failed", message } });

  router.get("/api/v2/sessions", async (_req, res) => {
    try { res.json({ sessions: await knownSessions() }); }
    catch { fail(res, 503, "Herdr could not be reached."); }
  });

  router.get("/api/v2/layout", (_req, res) => {
    res.json({ layout: loadLayout(res.locals.session) });
  });

  router.get("/api/v2/state", async (_req, res) => {
    try { res.json(await source.state(res.locals.session)); }
    catch { fail(res, 503, "Herdr could not be reached."); }
  });

  router.get("/api/v2/agents/:pane/output", async (req, res) => {
    const pane = String(req.params.pane);
    if (!PANE_ID.test(pane)) return fail(res, 400, "Invalid pane.");
    const lines = Math.min(400, Math.max(10, Number(req.query.lines) || 120));
    try { res.json({ paneId: pane, text: await source.output(pane, lines, res.locals.session), at: new Date().toISOString() }); }
    catch { fail(res, 502, "Could not read this agent."); }
  });

  router.get("/api/v2/agents/:pane/process", async (req, res) => {
    const pane = String(req.params.pane);
    if (!PANE_ID.test(pane)) return fail(res, 400, "Invalid pane.");
    try { res.json(await source.process(pane, res.locals.session)); }
    catch { fail(res, 502, "Could not inspect this pane."); }
  });

  router.post("/api/v2/agents/:pane/prompt", async (req, res) => {
    const pane = String(req.params.pane);
    const text = (req.body as { text?: unknown })?.text;
    if (!PANE_ID.test(pane)) return fail(res, 400, "Invalid pane.");
    if (typeof text !== "string" || text.trim().length === 0 || text.length > 8000) return fail(res, 400, "Message must be 1 to 8000 characters.");
    try {
      const cls = await paneClass(pane, res.locals.session);
      if (cls === "shell" || cls === "unknown") return fail(res, 409, cls === "shell"
        ? "This pane is at a shell prompt, so typing into it would run as a command. Start the agent there first."
        : "Control Center cannot tell what is running in this pane, so it will not type into it.");
      if (cls === "console") {
        const problem = checkConsoleLine(text);
        if (problem) return fail(res, 400, problem);
        await source.run(pane, text, res.locals.session);
      } else {
        await source.prompt(pane, text, res.locals.session);
      }
      res.json({ ok: true });
    }
    catch { fail(res, 502, "The message was not delivered."); }
  });

  router.post("/api/v2/agents/:pane/keys", async (req, res) => {
    const pane = String(req.params.pane);
    const keys = (req.body as { keys?: unknown })?.keys;
    if (!PANE_ID.test(pane)) return fail(res, 400, "Invalid pane.");
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 8
      || !keys.every((k) => typeof k === "string" && SAFE_KEYS.has(k.toLowerCase()))) return fail(res, 400, "Unsupported key.");
    try {
      if ((await paneClass(pane, res.locals.session)) !== "agent") return fail(res, 409, "Keys can only be sent to a recognized agent session.");
      await source.keys(pane, keys.map((k: string) => k.toLowerCase()), res.locals.session); res.json({ ok: true });
    }
    catch { fail(res, 502, "The key was not delivered."); }
  });

  router.get("/api/v2/agents/:pane/chat", async (req, res) => {
    const pane = String(req.params.pane);
    if (!PANE_ID.test(pane)) return fail(res, 400, "Invalid pane.");
    try { res.json(await source.chat(pane, res.locals.session)); }
    catch { fail(res, 502, "Could not read this conversation."); }
  });

  router.get("/api/v2/recent", async (_req, res) => {
    try { res.json({ tasks: await source.recent(res.locals.session) }); }
    catch { fail(res, 502, "Could not read recent requests."); }
  });

  router.post("/api/v2/agents/:pane/rename", async (req, res) => {
    const pane = String(req.params.pane);
    const name = (req.body as { name?: unknown })?.name;
    if (!PANE_ID.test(pane)) return fail(res, 400, "Invalid pane.");
    if (name !== null && (typeof name !== "string" || name.trim().length > 60 || /[\u0000-\u001f]/u.test(name))) return fail(res, 400, "Name must be up to 60 characters.");
    try { await source.rename(pane, typeof name === "string" && name.trim() ? name.trim() : null, res.locals.session); res.json({ ok: true }); }
    catch { fail(res, 502, "Could not rename this agent."); }
  });

  router.post("/api/v2/agents/:pane/close", async (req, res) => {
    const pane = String(req.params.pane);
    if (!PANE_ID.test(pane)) return fail(res, 400, "Invalid pane.");
    if ((req.body as { confirm?: unknown })?.confirm !== true) return fail(res, 400, "Closing needs confirmation.");
    try { await source.close(pane, res.locals.session); res.json({ ok: true }); }
    catch { fail(res, 502, "Could not close this pane."); }
  });

  return router;
}
