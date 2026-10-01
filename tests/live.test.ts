import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { DemoLive } from "../src/server/demo.js";

const capability = "B".repeat(43);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function start() {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const server = createServer(createApp({ capability, port, production: true }, new DemoLive()));
  servers.push(server);
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const base = `http://127.0.0.1:${port}`;
  const call = (path: string, init: RequestInit = {}, auth = true) => fetch(base + path, {
    ...init,
    headers: { ...(auth ? { Authorization: `Bearer ${capability}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  return call;
}

describe("live conversation API", () => {
  it("requires the launch capability", async () => {
    const call = await start();
    expect((await call("/api/v2/state", {}, false)).status).toBe(401);
    expect((await call("/api/v2/agents/d1:p1/prompt", { method: "POST", body: JSON.stringify({ text: "hi" }) }, false)).status).toBe(401);
  });

  it("lists agents and reads output", async () => {
    const call = await start();
    const state = await (await call("/api/v2/state")).json();
    expect(state.source).toBe("demo");
    expect(state.agents.length).toBeGreaterThan(3);
    const out = await (await call("/api/v2/agents/d3:p1/output")).json();
    expect(out.text).toContain("migration");
  });

  it("delivers prompts and changes agent state", async () => {
    const call = await start();
    const res = await call("/api/v2/agents/d4:p1/prompt", { method: "POST", body: JSON.stringify({ text: "Summarize TODOs" }) });
    expect(res.status).toBe(200);
    const out = await (await call("/api/v2/agents/d4:p1/output")).json();
    expect(out.text).toContain("Summarize TODOs");
    const state = await (await call("/api/v2/state")).json();
    expect(state.agents.find((a: { paneId: string }) => a.paneId === "d4:p1").status).toBe("working");
  });

  it("answers a blocked prompt with an allowed key", async () => {
    const call = await start();
    const res = await call("/api/v2/agents/d3:p1/keys", { method: "POST", body: JSON.stringify({ keys: ["1"] }) });
    expect(res.status).toBe(200);
    const state = await (await call("/api/v2/state")).json();
    expect(state.agents.find((a: { paneId: string }) => a.paneId === "d3:p1").status).toBe("working");
  });

  it("rejects bad input", async () => {
    const call = await start();
    const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
    expect((await post("/api/v2/agents/d1:p1/prompt", { text: "   " })).status).toBe(400);
    expect((await post("/api/v2/agents/d1:p1/prompt", { text: "x".repeat(8001) })).status).toBe(400);
    expect((await post("/api/v2/agents/..%2Fetc/prompt", { text: "hi" })).status).toBe(400);
    expect((await post("/api/v2/agents/d1:p1/keys", { keys: ["rm -rf"] })).status).toBe(400);
    expect((await post("/api/v2/agents/d1:p1/keys", { keys: [] })).status).toBe(400);
  });
});

describe("tailnet host", () => {
  it("accepts only the configured host relayed from loopback over https", async () => {
    const { validRemoteRequest } = await import("../src/server/app.js");
    const req = (headers: Record<string, string>, addr = "127.0.0.1") => ({
      rawHeaders: Object.entries(headers).flatMap(([k, v]) => [k, v]),
      headers, socket: { remoteAddress: addr },
    }) as never;
    const host = "box.example.ts.net:10000";
    expect(validRemoteRequest(req({ host, "x-forwarded-proto": "https", origin: `https://${host}` }), host)).toBe(true);
    expect(validRemoteRequest(req({ host, "x-forwarded-host": host }), host)).toBe(true);
    expect(validRemoteRequest(req({ host, "x-forwarded-host": "evil.example" }), host)).toBe(false);
    expect(validRemoteRequest(req({ host: "evil.example" }), host)).toBe(false);
    expect(validRemoteRequest(req({ host }, "100.64.0.9"), host)).toBe(false);
    expect(validRemoteRequest(req({ host, origin: "https://evil.example" }), host)).toBe(false);
    expect(validRemoteRequest(req({ host, "x-forwarded-proto": "http" }), host)).toBe(false);
    expect(validRemoteRequest(req({ host, "sec-fetch-site": "cross-site" }), host)).toBe(false);
  });
});

describe("agent management and chat", () => {
  it("renames, requires confirmation to close, and closes", async () => {
    const call = await start();
    const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
    expect((await post("/api/v2/agents/d4:p1/rename", { name: "Nova" })).status).toBe(200);
    let state = await (await call("/api/v2/state")).json();
    expect(state.agents.find((a: { paneId: string }) => a.paneId === "d4:p1").name).toBe("Nova");
    expect((await post("/api/v2/agents/d4:p1/rename", { name: "x".repeat(61) })).status).toBe(400);
    expect((await post("/api/v2/agents/d4:p1/close", {})).status).toBe(400);
    expect((await post("/api/v2/agents/d4:p1/close", { confirm: true })).status).toBe(200);
    state = await (await call("/api/v2/state")).json();
    expect(state.agents.some((a: { paneId: string }) => a.paneId === "d4:p1")).toBe(false);
  });

  it("returns a structured conversation", async () => {
    const call = await start();
    const chat = await (await call("/api/v2/agents/d3:p1/chat")).json();
    expect(chat.available).toBe(true);
    expect(chat.items.some((i: { kind: string }) => i.kind === "work")).toBe(true);
    expect(chat.items.some((i: { kind: string; role?: string }) => i.kind === "message" && i.role === "assistant")).toBe(true);
  });
});

describe("session log parsing", () => {
  it("builds messages and collapses tool calls from Codex and Claude logs", async () => {
    const { parseCodex, parseClaude } = await import("../src/server/chat.js");
    const codex = [
      { type: "response_item", timestamp: "t1", payload: { type: "message", role: "developer", content: [{ text: "secret rules" }] } },
      { type: "response_item", timestamp: "t2", payload: { type: "message", role: "user", content: [{ text: "<environment_context>x</environment_context>" }] } },
      { type: "response_item", timestamp: "t3", payload: { type: "message", role: "user", content: [{ text: "Fix the bug" }] } },
      { type: "response_item", timestamp: "t4", payload: { type: "custom_tool_call", name: "exec" } },
      { type: "response_item", timestamp: "t5", payload: { type: "custom_tool_call", name: "exec" } },
      { type: "response_item", timestamp: "t6", payload: { type: "message", role: "assistant", content: [{ text: "Done." }] } },
    ].map((l) => JSON.stringify(l));
    const items = parseCodex(codex);
    expect(items).toEqual([
      { kind: "message", role: "user", text: "Fix the bug", at: "t3" },
      { kind: "work", steps: 2, tools: ["exec"], at: "t4" },
      { kind: "message", role: "assistant", text: "Done.", at: "t6" },
    ]);
    const claude = [
      { type: "user", timestamp: "a", message: { role: "user", content: "Hello" } },
      { type: "assistant", timestamp: "b", message: { content: [{ type: "text", text: "Looking." }, { type: "tool_use", name: "Read" }] } },
      { type: "user", timestamp: "c", message: { content: [{ type: "tool_result", content: "ok" }] } },
      { type: "assistant", isSidechain: true, message: { content: "hidden" } },
    ].map((l) => JSON.stringify(l));
    const out = parseClaude(claude);
    expect(out.map((i) => i.kind)).toEqual(["message", "message", "work"]);
  });
});

describe("named sessions", () => {
  it("lists sessions and refuses one that is not running", async () => {
    const call = await start();
    const list = await (await call("/api/v2/sessions")).json();
    expect(list.sessions).toEqual([{ name: "default", running: true, default: true }]);
    expect((await call("/api/v2/state?session=nope")).status).toBe(404);
    expect((await call("/api/v2/state?session=../etc")).status).toBe(400);
    expect((await call("/api/v2/state?session=default")).status).toBe(200);
  });
});

describe("how text reaches a pane", () => {
  const proc = (argv: string[][], shellPid = 100) => ({ result: { process_info: { shell_pid: shellPid, foreground_processes: argv.map((a, i) => ({ argv: a, name: a[0].split("/").pop(), pid: i === 0 ? 200 : 201 })) } } });

  it("classifies what is running in a pane", async () => {
    const { classifyProcess, checkConsoleLine } = await import("../src/server/process.js");
    expect(classifyProcess(proc([["node", "/home/u/.local/bin/codex", "--no-daemon"], ["/x/bin/codex", "--no-daemon"]])).cls).toBe("agent");
    expect(classifyProcess(proc([["claude"]])).cls).toBe("agent");
    expect(classifyProcess(proc([["python3", "/home/u/.local/bin/custom-console", "--identity", "ada"]])).cls).toBe("console");
    expect(classifyProcess(proc([["-bash"]])).cls).toBe("shell");
    expect(classifyProcess(proc([["/usr/bin/zsh"]])).cls).toBe("shell");
    expect(classifyProcess({ result: { process_info: { shell_pid: 200, foreground_processes: [{ argv: ["sleep", "5"], pid: 200 }] } } }).cls).toBe("shell");
    expect(classifyProcess({}).cls).toBe("unknown");
    expect(checkConsoleLine("status")).toBeNull();
    expect(checkConsoleLine("two\nlines")).not.toBeNull();
    expect(checkConsoleLine("bad\u0003char")).not.toBeNull();
    expect(checkConsoleLine("x".repeat(4001))).not.toBeNull();
    expect(checkConsoleLine("   ")).not.toBeNull();
  });

  async function startWith(classes: Record<string, "agent" | "console" | "shell" | "unknown">) {
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const demo = new DemoLive();
    const calls: string[] = [];
    const source = Object.assign(Object.create(demo), {
      process: async (pane: string) => ({ cls: classes[pane] ?? "agent", command: "x" }),
      prompt: async (_p: string, text: string) => { calls.push(`prompt:${text}`); },
      run: async (_p: string, text: string) => { calls.push(`run:${text}`); },
      keys: async (_p: string, k: string[]) => { calls.push(`keys:${k.join(",")}`); },
    });
    const server = createServer(createApp({ capability, port, production: true }, source));
    servers.push(server);
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${capability}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { post, calls };
  }

  it("never types into a shell or an unidentified pane", async () => {
    const { post, calls } = await startWith({ "d4:p1": "shell", "d3:p1": "unknown" });
    for (const pane of ["d4:p1", "d3:p1"]) {
      expect((await post(`/api/v2/agents/${pane}/prompt`, { text: "ls" })).status).toBe(409);
      expect((await post(`/api/v2/agents/${pane}/keys`, { keys: ["1"] })).status).toBe(409);
    }
    expect(calls).toEqual([]);
  });

  it("types one line into a console with pane run and refuses keys", async () => {
    const { post, calls } = await startWith({ "d4:p1": "console" });
    expect((await post("/api/v2/agents/d4:p1/prompt", { text: "status" })).status).toBe(200);
    expect((await post("/api/v2/agents/d4:p1/prompt", { text: "a\nb" })).status).toBe(400);
    expect((await post("/api/v2/agents/d4:p1/keys", { keys: ["1"] })).status).toBe(409);
    expect(calls).toEqual(["run:status"]);
  });

  it("uses agent prompt and keys for a recognized agent", async () => {
    const { post, calls } = await startWith({});
    expect((await post("/api/v2/agents/d1:p1/prompt", { text: "hi\nthere" })).status).toBe(200);
    expect((await post("/api/v2/agents/d3:p1/keys", { keys: ["1"] })).status).toBe(200);
    expect(calls).toEqual(["prompt:hi\nthere", "keys:1"]);
  });
});

describe("terminal messages", () => {
  it("turns Name: lines into messages and ignores shell noise", async () => {
    const { chatFromTerminal } = await import("../src/client/lib/terminalChat.js");
    const text = "user@box:~$ run\nAda: first thing\nAda · Working\nTerminated\nada: second\nLin: not me\n";
    expect(chatFromTerminal(text, "Ada").map((i) => (i.kind === "message" ? i.text : ""))).toEqual(["first thing", "second"]);
  });
});

describe("board layout", () => {
  it("accepts well-formed groups for the right session and drops junk", async () => {
    const { parseLayout } = await import("../src/server/layout.js");
    const raw = { sessions: {
      default: { groups: [{ title: "A", names: ["x", "y"] }, { title: "", names: ["z"] }, { title: "B", names: [] }, { names: ["q"] }, "bad"] },
      other: { groups: [{ title: "O", names: ["o"] }] },
    } };
    expect(parseLayout(raw, undefined)).toEqual({ groups: [{ title: "A", names: ["x", "y"] }] });
    expect(parseLayout(raw, "other")).toEqual({ groups: [{ title: "O", names: ["o"] }] });
    expect(parseLayout(raw, "missing")).toBeNull();
    expect(parseLayout(null, undefined)).toBeNull();
    expect(parseLayout({ sessions: { default: { groups: "no" } } }, undefined)).toBeNull();
  });

  it("serves the layout from the state folder and nothing when absent", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { loadLayout } = await import("../src/server/layout.js");
    const dir = mkdtempSync(path.join(tmpdir(), "hcc-layout-"));
    expect(loadLayout(undefined, dir)).toBeNull();
    writeFileSync(path.join(dir, "layouts.json"), JSON.stringify({ sessions: { default: { groups: [{ title: "T", names: ["n"] }] } } }));
    expect(loadLayout(undefined, dir)).toEqual({ groups: [{ title: "T", names: ["n"] }] });
    writeFileSync(path.join(dir, "layouts.json"), "{not json");
    expect(loadLayout(undefined, dir)).toBeNull();
  });
});

describe("board grouping", () => {
  it("groups by name ignoring case, orders by attention, and puts the rest in Other", async () => {
    const { groupAgents } = await import("../src/client/pages/Board.js");
    const mk = (paneId: string, name: string, status: "idle" | "blocked" | "done") => ({ paneId, workspaceId: "w", tabId: "t", name, kind: null, status, cwd: null, title: null, ready: true, stateSeq: 0, session: null, lastActiveAt: null });
    const out = groupAgents({ groups: [{ title: "Team", names: ["ada", "LIN"] }, { title: "Empty", names: ["nobody"] }] }, [mk("1", "Ada", "idle"), mk("2", "Lin", "blocked"), mk("3", "Zed", "done")]);
    expect(out.map((g) => g.title)).toEqual(["Team", "Other"]);
    expect(out[0].agents.map((a) => a.name)).toEqual(["Lin", "Ada"]);
    expect(out[1].agents.map((a) => a.name)).toEqual(["Zed"]);
  });
});
