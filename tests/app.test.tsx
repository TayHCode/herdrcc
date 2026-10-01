import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/client/App";
import type { LiveState } from "../src/shared/live";

const state: LiveState = {
  source: "demo",
  observedAt: new Date().toISOString(),
  workspaces: [{ id: "w1", label: "Checkout", number: 1, status: "blocked", focused: false, tabCount: 1, paneCount: 2 }],
  tabs: [],
  agents: [
    { paneId: "w1:p1", workspaceId: "w1", tabId: "w1:t1", name: "Mara", kind: "codex", status: "blocked", cwd: "/home/u/code/pipeline", title: null, ready: true, stateSeq: 1, session: null, lastActiveAt: null },
    { paneId: "w1:p2", workspaceId: "w1", tabId: "w1:t1", name: "Noor", kind: "claude", status: "idle", cwd: "/home/u/code/mobile", title: null, ready: true, stateSeq: 1, session: null, lastActiveAt: null },
  ],
};

function mockApi() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/output") ? { paneId: "w1:p1", text: "Allow running migration?", at: "" } : state;
    return { ok: true, status: 200, json: async () => body } as Response;
  }));
}

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

describe("Control Center UI", () => {
  it("sends the session from a /s/<name> address with every request and keeps it in links", async () => {
    mockApi();
    window.history.replaceState(null, "", "/s/demo-session");
    renderApp();
    await waitFor(() => expect(screen.getAllByText("Mara").length).toBeGreaterThan(0));
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("/api/v2/state") && u.includes("session=demo-session"))).toBe(true);
    expect(document.querySelector('a[href="/s/demo-session/workspaces"]')).not.toBeNull();
  });

  it("puts agents that need you ahead of idle agents on the overview", async () => {
    mockApi();
    renderApp();
    expect(await screen.findByText("Needs you", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getAllByText("Mara").length).toBeGreaterThan(0);
    expect(screen.getByText("Idle", { selector: "h2" })).toBeInTheDocument();
  });

  it("offers approve and decline on a blocked agent's page and a message composer", async () => {
    mockApi();
    window.history.replaceState(null, "", "/agents/w1%3Ap1");
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /decline/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Message Mara")).toBeInTheDocument();
  });
});

describe("hide other panes", () => {
  it("removes agents that are not Codex or Claude sessions, but keeps the one you are viewing", async () => {
    const withConsole = { ...state, agents: [...state.agents, { ...state.agents[1], paneId: "w1:p9", name: "Helper", kind: null }] };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/output") ? { paneId: "x", text: "", at: "" } : withConsole;
      return { ok: true, status: 200, json: async () => body } as Response;
    }));
    localStorage.setItem("hcc.hideOtherPanes", "1");
    try {
      renderApp();
      await screen.findByText("Needs you", { selector: "h2" });
      expect(screen.queryByText("Helper")).toBeNull();
    } finally { localStorage.removeItem("hcc.hideOtherPanes"); }
  });
});
