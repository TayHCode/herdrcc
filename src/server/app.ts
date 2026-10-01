import { DeviceStore, type DeviceInfo } from "./devices.js";
import QRCode from "qrcode";
import { HerdrLive, createLiveRouter, type LiveSource } from "./live.js";
import { timingSafeEqual } from "node:crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";

export interface AppSecurityOptions {
  capability: string;
  port: number;
  production?: boolean;
  /** "host[:port]" of the tailnet HTTPS address that `tailscale serve` forwards to this process. Never a Funnel address. */
  remoteHost?: string;
  devices?: DeviceStore;
}

function headerValues(req: Request, headerName: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() === headerName.toLowerCase()) {
      values.push(req.rawHeaders[index + 1]);
    }
  }
  return values;
}

function authorized(req: Request, capability: string): boolean {
  const headers = headerValues(req, "authorization");
  if (headers.length !== 1 || !headers[0].startsWith("Bearer ")) return false;
  const supplied = Buffer.from(headers[0].slice(7), "utf8");
  const expected = Buffer.from(capability, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const COOKIE = "hcc_device";

function deviceToken(req: Request): string | null {
  const raw = headerValues(req, "cookie").join("; ");
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=") || null;
  }
  return null;
}

function authenticate(security: AppSecurityOptions, req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  const remote = Boolean(security.remoteHost) && headerValues(req, "host")[0]?.toLowerCase() === security.remoteHost;
  const token = deviceToken(req);
  const device = token && security.devices ? security.devices.verify(token) : null;
  // The launch key is for the person at this machine. Anything arriving over the tailnet must be a paired device.
  const byKey = !remote && authorized(req, security.capability);
  if (!byKey && !device) {
    res.status(401).json({ error: { code: "unauthorized", message: "Open the launch link printed by this Control Center process." } });
    return;
  }
  next();
}

function expectedHosts(port: number): Set<string> {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (port === 80) {
    hosts.add("127.0.0.1");
    hosts.add("localhost");
  }
  return hosts;
}

export function validLocalRequest(req: Request, port: number): boolean {
  const hosts = headerValues(req, "host");
  if (hosts.length !== 1 || !expectedHosts(port).has(hosts[0].toLowerCase())) return false;
  if (headerValues(req, "forwarded").length > 0
    || headerValues(req, "x-forwarded-host").length > 0
    || headerValues(req, "x-forwarded-proto").length > 0) return false;

  const originHeaders = headerValues(req, "origin");
  if (originHeaders.length > 1) return false;
  if (originHeaders.length === 1) {
    const origin = originHeaders[0];
    if (origin === "null") return false;
    try {
      const parsed = new URL(origin);
      const requestHost = hosts[0].toLowerCase().split(":", 1)[0];
      if (parsed.protocol !== "http:" || parsed.username || parsed.password
        || parsed.pathname !== "/" || parsed.search || parsed.hash
        || parsed.hostname.toLowerCase() !== requestHost
        || Number(parsed.port || "80") !== port) return false;
    } catch {
      return false;
    }
  }

  const fetchSiteHeaders = headerValues(req, "sec-fetch-site");
  if (fetchSiteHeaders.length > 1) return false;
  if (fetchSiteHeaders.length === 1
    && fetchSiteHeaders[0] !== "same-origin" && fetchSiteHeaders[0] !== "none") return false;
  return true;
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** A request relayed by the local `tailscale serve` proxy for the configured tailnet host. */
export function validRemoteRequest(req: Request, remoteHost: string): boolean {
  const expected = remoteHost.toLowerCase();
  const hosts = headerValues(req, "host");
  if (hosts.length !== 1 || hosts[0].toLowerCase() !== expected) return false;
  if (!isLoopback(req.socket?.remoteAddress)) return false;
  if (headerValues(req, "forwarded").length > 0) return false;
  const forwardedHost = headerValues(req, "x-forwarded-host");
  if (forwardedHost.length > 1 || (forwardedHost.length === 1 && forwardedHost[0].toLowerCase() !== expected)) return false;
  const proto = headerValues(req, "x-forwarded-proto");
  if (proto.length > 1 || (proto.length === 1 && proto[0] !== "https")) return false;
  const origins = headerValues(req, "origin");
  if (origins.length > 1 || (origins.length === 1 && origins[0].toLowerCase() !== `https://${expected}`)) return false;
  const site = headerValues(req, "sec-fetch-site");
  if (site.length > 1 || (site.length === 1 && site[0] !== "same-origin" && site[0] !== "none")) return false;
  return true;
}

function localRequestOnly(security: AppSecurityOptions, req: Request, res: Response, next: NextFunction): void {
  const port = security.port;
  if (!validLocalRequest(req, port) && !(security.remoteHost && validRemoteRequest(req, security.remoteHost))) {
    res.setHeader("Cache-Control", "no-store");
    res.status(403).json({ error: { code: "local_only", message: "This interface accepts local browser requests only." } });
    return;
  }
  next();
}

export function createApp(security: AppSecurityOptions, live: LiveSource = new HerdrLive()): Express {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(security.capability)
    || !Number.isInteger(security.port) || security.port < 1 || security.port > 65_535) {
    throw new TypeError("A valid launch capability and local port are required.");
  }
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (security.production) {
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    }
    next();
  });

  // Every API, including health and discovery, authenticates before authority checks or reads.
  app.use("/api", (req, res, next) => {
    if (req.method === "POST" && req.path === "/pair") return next();
    authenticate(security, req, res, next);
  });
  app.use((req, res, next) => localRequestOnly(security, req, res, next));
  app.use("/api/pair", express.json({ limit: "4kb" }));
  app.post("/api/pair", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = req.body as { code?: unknown; name?: unknown };
    const result = security.devices && typeof body?.code === "string" && body.code.length < 100
      ? security.devices.pair(body.code, typeof body.name === "string" ? body.name : "") : null;
    if (!result) {
      res.status(401).json({ error: { code: "pairing_failed", message: "That pairing code is wrong, used, or expired. Ask for a new one." } });
      return;
    }
    const secure = Boolean(security.remoteHost) && headerValues(req, "host")[0]?.toLowerCase() === security.remoteHost;
    res.setHeader("Set-Cookie", `${COOKIE}=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure ? "; Secure" : ""}`);
    res.json({ device: result.device });
  });
  app.use("/api/devices", express.json({ limit: "4kb" }));
  app.get("/api/devices", (_req, res) => {
    res.json({ devices: security.devices?.list() ?? [], remote: Boolean(security.remoteHost) });
  });
  app.delete("/api/devices/:id", (req, res) => {
    if (!security.devices?.revoke(String(req.params.id))) { res.status(404).json({ error: { code: "not_found", message: "No such device." } }); return; }
    res.json({ ok: true });
  });
  app.post("/api/devices/pairing", async (_req, res) => {
    if (!security.devices) { res.status(404).json({ error: { code: "not_found", message: "Pairing is not available." } }); return; }
    const base = security.remoteHost ? `https://${security.remoteHost}` : `http://127.0.0.1:${security.port}`;
    const url = `${base}/#pair=${security.devices.newPairingCode()}`;
    res.json({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }), expiresInSeconds: 600, remote: Boolean(security.remoteHost) });
  });
  app.use(createLiveRouter(live));
  app.get("/api/health", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({ status: "ok" }); });
  app.use("/api", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: { code: "not_found", message: "Not found." } });
  });
  return app;
}

export { authorized, expectedHosts };
