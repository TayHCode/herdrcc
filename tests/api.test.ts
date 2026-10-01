import { describe, expect, it, vi } from "vitest";
import { consumeLaunchCapability, fetchState, sendPrompt } from "../src/client/api";

describe("browser launch capability handoff", () => {
  it("consumes the fragment and sends it only as a same-origin authorization header", async () => {
    const capability = "a".repeat(43);
    window.history.replaceState(null, "", `/?x=1#launch=${capability}`);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true, status: 200, json: async () => ({ ok: true }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    consumeLaunchCapability();
    await fetchState();
    await sendPrompt("w1:p1", "hello");

    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/v2/state");
    expect(String(url)).not.toContain(capability);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${capability}`);
    expect(init).toMatchObject({ cache: "no-store", mode: "same-origin", redirect: "error", referrerPolicy: "no-referrer" });
    const [promptUrl, promptInit] = fetchMock.mock.calls[1];
    expect(String(promptUrl)).toBe("/api/v2/agents/w1%3Ap1/prompt");
    expect(promptInit?.method).toBe("POST");
    expect(JSON.parse(String(promptInit?.body))).toEqual({ text: "hello" });
    expect(document.documentElement.innerHTML).not.toContain(capability);
  });
});
