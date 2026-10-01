import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, validLocalRequest } from "../src/server/app.js";
import { DemoLive } from "../src/server/demo.js";

const capability = "A".repeat(43);
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))); });

async function start() {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const server = createServer(createApp({ capability, port, production: true }, new DemoLive()));
  servers.push(server);
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return { port, origin: `http://127.0.0.1:${port}`, headers: { Authorization: `Bearer ${capability}` } };
}

const req = (values: Record<string, string>) => ({ rawHeaders: Object.entries(values).flatMap(([k, v]) => [k, v]) }) as never;

describe("local request boundary", () => {
  it("refuses to build an app without a per-launch capability", () => {
    expect(() => createApp({ capability: "short", port: 4000 })).toThrow();
  });

  it("requires the capability for every API path, including health and unknown paths", async () => {
    const { origin } = await start();
    for (const path of ["/api/health", "/api/v2/state", "/api/nope", "/api/devices"]) {
      expect((await fetch(origin + path)).status).toBe(401);
    }
  });

  it("serves authenticated callers with no-store and hardening headers", async () => {
    const { origin, headers } = await start();
    const res = await fetch(`${origin}/api/health`, { headers: { ...headers, Origin: origin, "Sec-Fetch-Site": "same-origin" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await fetch(`${origin}/api/nope`, { headers })).status).toBe(404);
  });

  it("rejects foreign Host, Origin and fetch metadata", async () => {
    const { port, origin, headers } = await start();
    const bad: Array<Record<string, string>> = [
      { host: `127.0.0.1.evil.example:${port}` },
      { host: `127.0.0.1:${port}`, "x-forwarded-host": "attacker.example" },
      { host: `127.0.0.1:${port}`, forwarded: "host=attacker.example" },
      { host: `127.0.0.1:${port}`, origin: "https://other.example" },
      { host: `127.0.0.1:${port}`, origin: "null" },
      { host: `127.0.0.1:${port}`, origin: `http://user@127.0.0.1:${port}` },
      { host: `127.0.0.1:${port}`, origin, "sec-fetch-site": "same-site" },
      { host: `127.0.0.1:${port}`, origin: "https://other.example", "sec-fetch-site": "cross-site" },
    ];
    for (const values of bad) expect(validLocalRequest(req(values), port)).toBe(false);
    expect(validLocalRequest({ rawHeaders: ["Host", `127.0.0.1:${port}`, "host", `127.0.0.1:${port}`] } as never, port)).toBe(false);
    expect(validLocalRequest(req({ host: `127.0.0.1:${port}`, origin }), port)).toBe(true);
    const metadata: Array<Record<string, string>> = [{ Origin: "https://other.example" }, { Origin: "null" }, { Origin: origin, "Sec-Fetch-Site": "cross-site" }];
    for (const h of metadata) {
      expect((await fetch(`${origin}/api/v2/state`, { headers: { ...headers, ...h } })).status).toBe(403);
    }
  });
});
