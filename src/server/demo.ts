import type { AgentStatus, ChatItem, LiveAgent, LiveChat, LiveState, RecentTask } from "../shared/live.js";
import type { LiveSource, SessionInfo } from "./live.js";

interface DemoAgent extends LiveAgent {
  log: string[];
  until?: number;
  after?: AgentStatus;
}

const WORKSPACES = [
  { id: "d1", label: "Checkout rewrite", number: 1 },
  { id: "d2", label: "Docs site", number: 2 },
  { id: "d3", label: "Data pipeline", number: 3 },
  { id: "d4", label: "Mobile app", number: 4 },
];

const SCRIPTS: Record<string, string[]> = {
  working: [
    "● Reading src/checkout/cart.ts",
    "● Reading src/checkout/pricing.ts",
    "● Running npm test -- cart",
    "  PASS  src/checkout/cart.test.ts (14 tests)",
    "  FAIL  src/checkout/pricing.test.ts",
    "    expected 1999, received 2000 (rounding in applyDiscount)",
    "● Editing src/checkout/pricing.ts",
    "    - return Math.round(total * (1 - rate));",
    "    + return Math.floor(total * (1 - rate));",
    "● Running npm test -- pricing",
  ],
  blocked: [
    "● Reading migrations/0042_add_orders_index.sql",
    "● I need to run this migration against the staging database.",
    "",
    "  Allow running `psql $STAGING_URL -f migrations/0042_add_orders_index.sql`?",
    "",
    "  ❯ 1. Yes",
    "    2. Yes, and don't ask again for psql commands",
    "    3. No, and tell me what to do differently",
  ],
  done: [
    "● Updated README quickstart and the three screenshots.",
    "● Ran the link checker: 0 broken links.",
    "",
    "Summary: the install section now matches the 2.0 CLI flags, and the",
    "troubleshooting page covers the new proxy settings.",
  ],
  idle: [
    "● Ready. Waiting for instructions.",
  ],
};

function seed(): DemoAgent[] {
  const rows: Array<[string, string, string, AgentStatus, string, string]> = [
    ["d1:p1", "d1", "Ada", "working", "claude", "~/code/checkout"],
    ["d1:p2", "d1", "Ada-review", "idle", "codex", "~/code/checkout"],
    ["d2:p1", "d2", "Lin", "done", "claude", "~/code/docs"],
    ["d3:p1", "d3", "Mara", "blocked", "codex", "~/code/pipeline"],
    ["d3:p2", "d3", "Mara-tests", "working", "codex", "~/code/pipeline"],
    ["d4:p1", "d4", "Noor", "idle", "claude", "~/code/mobile"],
  ];
  return rows.map(([paneId, workspaceId, name, status, kind, cwd], i) => ({
    paneId, workspaceId, tabId: `${workspaceId}:t1`, name, kind, status, cwd,
    title: `${name} | ${cwd.split("/").pop()}`, ready: status !== "working", stateSeq: 100 + i, session: null, lastActiveAt: new Date(Date.now() - (i * 7 + 2) * 60000).toISOString(),
    log: [...SCRIPTS[status === "unknown" ? "idle" : status]],
  }));
}

export class DemoLive implements LiveSource {
  private agents = seed();
  private started = Date.now();

  private tick(): void {
    const now = Date.now();
    for (const a of this.agents) {
      if (a.until && now >= a.until) {
        a.status = a.after ?? "idle";
        a.ready = a.status !== "working";
        a.until = undefined;
        a.stateSeq += 1;
        if (a.status === "done") a.log.push("", "● Done. Let me know if you want any changes.");
      }
    }
    // The first working agent finishes a pass and starts another every 40s so the demo keeps moving.
    const cycle = Math.floor((now - this.started) / 40000) % 2;
    const ada = this.agents[0];
    if (!ada.until && cycle === 1 && ada.status === "working") {
      ada.status = "done"; ada.ready = true; ada.stateSeq += 1;
      ada.log.push("  PASS  src/checkout/pricing.test.ts (9 tests)", "", "● All 23 tests pass.");
    } else if (cycle === 0 && ada.status === "done") {
      ada.status = "working"; ada.ready = false; ada.stateSeq += 1;
      ada.log.push("● Picking up the next item: shipping estimate edge cases");
    }
  }

  async sessions(): Promise<SessionInfo[]> {
    return [{ name: "default", running: true, default: true }];
  }

  async state(): Promise<LiveState> {
    this.tick();
    return {
      source: "demo",
      observedAt: new Date().toISOString(),
      workspaces: WORKSPACES.map((w) => {
        const members = this.agents.filter((a) => a.workspaceId === w.id);
        const order: AgentStatus[] = ["blocked", "done", "working", "idle", "unknown"];
        const status = order.find((s) => members.some((m) => m.status === s)) ?? "unknown";
        return { ...w, status, focused: false, tabCount: 1, paneCount: members.length };
      }),
      tabs: WORKSPACES.map((w) => ({ id: `${w.id}:t1`, workspaceId: w.id, label: "main", status: "idle" as AgentStatus })),
      agents: this.agents.map(({ log: _log, until: _until, after: _after, ...rest }) => rest),
    };
  }

  private find(paneId: string): DemoAgent {
    const agent = this.agents.find((a) => a.paneId === paneId);
    if (!agent) throw new Error("not found");
    return agent;
  }

  async output(paneId: string, lines: number): Promise<string> {
    this.tick();
    return this.find(paneId).log.slice(-lines).join("\n");
  }

  async prompt(paneId: string, text: string): Promise<void> {
    const a = this.find(paneId);
    a.log.push("", `› ${text}`, "", "● On it. Reading the relevant files first.");
    a.status = "working"; a.ready = false; a.stateSeq += 1;
    a.until = Date.now() + 7000; a.after = "done";
  }

  async chat(paneId: string): Promise<LiveChat> {
    const a = this.find(paneId);
    const items: ChatItem[] = [];
    let buf: string[] = [];
    const flush = () => { if (buf.join("").trim()) items.push({ kind: "message", role: "assistant", text: buf.join("\n").trim(), at: null }); buf = []; };
    for (const line of a.log) {
      if (line.startsWith("› ")) { flush(); items.push({ kind: "message", role: "user", text: line.slice(2), at: null }); }
      else if (/^● (Reading|Running|Editing)/u.test(line)) { flush(); const last = items.at(-1); if (last?.kind === "work") last.steps += 1; else items.push({ kind: "work", steps: 1, tools: [line.split(" ")[1]], at: null }); }
      else buf.push(line.replace(/^● /u, ""));
    }
    flush();
    return { paneId, available: true, items, at: new Date().toISOString() };
  }

  async recent(): Promise<RecentTask[]> {
    const asks = ["Fix the rounding bug in applyDiscount", "Update the README quickstart for the 2.0 CLI", "Run the staging migration for orders index", "Add tests for the nightly export job", "Summarize open TODOs in the mobile app"];
    return this.agents.slice(0, 5).map((a, i) => ({ paneId: a.paneId, text: asks[i], at: new Date(Date.now() - (i * 11 + 3) * 60000).toISOString() }));
  }

  async process(): Promise<{ cls: "agent"; command: string }> {
    return { cls: "agent", command: "demo" };
  }

  async run(paneId: string, line: string): Promise<void> {
    return this.prompt(paneId, line);
  }

  async rename(paneId: string, name: string | null): Promise<void> {
    this.find(paneId).name = name ?? paneId;
  }

  async close(paneId: string): Promise<void> {
    this.agents = this.agents.filter((a) => a.paneId !== paneId);
  }

  async keys(paneId: string, keys: string[]): Promise<void> {
    const a = this.find(paneId);
    if (a.status === "blocked" && keys.some((k) => ["1", "2", "y", "enter"].includes(k))) {
      a.log.push("", "› Yes", "● Migration applied. Index created in 1.2s.");
      a.status = "working"; a.ready = false; a.stateSeq += 1;
      a.until = Date.now() + 5000; a.after = "done";
    } else if (a.status === "blocked" && keys.some((k) => ["3", "n", "esc", "escape"].includes(k))) {
      a.log.push("", "› No", "● Understood. I will prepare a dry-run script instead.");
      a.status = "idle"; a.ready = true; a.stateSeq += 1;
    } else if (keys.includes("esc") || keys.includes("escape") || keys.includes("ctrl-c")) {
      a.log.push("", "● Interrupted.");
      a.status = "idle"; a.ready = true; a.until = undefined; a.stateSeq += 1;
    }
  }
}
