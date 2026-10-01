import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { DemoLive } from "../src/server/demo.js";
import { DeviceStore } from "../src/server/devices.js";

const capability = "C".repeat(43);
const REMOTE = "box.example.ts.net:10000";
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))); });

async function start(devices: DeviceStore) {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const app = createApp({ capability, port, production: true, remoteHost: REMOTE, devices }, new DemoLive());
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  /** Calls the server as `Host`, the way the Tailscale proxy or the local browser would. */
  return (host: string, method: string, url: string, headers: Record<string, string> = {}, body?: unknown) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; json: any }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: "127.0.0.1", port, method, path: url, headers: { host, ...(payload ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => { let json: unknown = null; try { json = JSON.parse(data); } catch { /* none */ } resolve({ status: res.statusCode ?? 0, headers: res.headers, json }); });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("device pairing", () => {
  it("pairs once, then the cookie works remotely while the launch key does not", async () => {
    const store = new DeviceStore(null);
    const call = await start(store);
    const local = `127.0.0.1:${(servers[0].address() as { port: number }).port}`;
    const auth = { authorization: `Bearer ${capability}` };

    // Remote without a pairing is refused, even with the launch key.
    expect((await call(REMOTE, "GET", "/api/v2/state", auth)).status).toBe(401);

    const made = await call(local, "POST", "/api/devices/pairing", auth, {});
    expect(made.status).toBe(200);
    expect(made.json.url).toMatch(/^https:\/\/box\.example\.ts\.net:10000\/#pair=/u);
    expect(made.json.qr).toMatch(/^data:image\/png/u);
    const code = made.json.url.split("#pair=")[1];

    const paired = await call(REMOTE, "POST", "/api/pair", { origin: `https://${REMOTE}` }, { code, name: "iPhone · Safari" });
    expect(paired.status).toBe(200);
    const cookie = String(([] as string[]).concat(paired.headers["set-cookie"] ?? [])[0]);
    expect(cookie).toMatch(/HttpOnly/u);
    expect(cookie).toMatch(/SameSite=Strict/u);
    expect(cookie).toMatch(/Secure/u);
    const pair = cookie.split(";")[0];

    expect((await call(REMOTE, "GET", "/api/v2/state", { cookie: pair })).status).toBe(200);
    // The same code cannot be used twice.
    expect((await call(REMOTE, "POST", "/api/pair", {}, { code, name: "again" })).status).toBe(401);
    // A bad cookie is refused.
    expect((await call(REMOTE, "GET", "/api/v2/state", { cookie: "hcc_device=nope" })).status).toBe(401);

    const list = await call(REMOTE, "GET", "/api/devices", { cookie: pair });
    expect(list.json.devices).toHaveLength(1);
    expect(list.json.devices[0].name).toBe("iPhone · Safari");
    expect(JSON.stringify(list.json)).not.toContain("tokenHash");

    // Revoking cuts that device off immediately.
    expect((await call(REMOTE, "DELETE", `/api/devices/${list.json.devices[0].id}`, { cookie: pair })).status).toBe(200);
    expect((await call(REMOTE, "GET", "/api/v2/state", { cookie: pair })).status).toBe(401);
  });
});

describe("device store", () => {
  it("expires codes, rate limits guesses, and stores only token hashes with private permissions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hcc-"));
    const store = new DeviceStore(dir);
    const result = store.pair(store.newPairingCode(), "Mac");
    expect(result).not.toBeNull();
    const file = path.join(dir, "devices.json");
    expect(readFileSync(file, "utf8")).not.toContain(result!.token);
    expect(statSync(file).mode & 0o077).toBe(0);
    expect(new DeviceStore(dir).verify(result!.token)?.name).toBe("Mac");

    const limited = new DeviceStore(null);
    for (let i = 0; i < 10; i += 1) expect(limited.pair(`guess-${i}`, "x")).toBeNull();
    expect(limited.pair(limited.newPairingCode(), "x")).toBeNull();
  });
});
