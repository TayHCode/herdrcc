import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultStateDirectory } from "./devices.js";

export interface Options {
  command: "run" | "pair" | "install-service" | "uninstall-service" | "help";
  demo: boolean;
  remote: boolean;
  yes: boolean;
  port: number | null;
  remotePort: number;
}

export const DEFAULT_REMOTE_PORT = 10000;

// Ports that browsers and Node's fetch refuse to connect to (the WHATWG "bad ports" list).
const BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

export function parseArgs(argv: string[]): Options | { error: string } {
  const o: Options = { command: "run", demo: false, remote: false, yes: false, port: null, remotePort: DEFAULT_REMOTE_PORT };
  const args = [...argv];
  const first = args[0];
  if (first && !first.startsWith("-")) {
    if (first === "pair" || first === "install-service" || first === "uninstall-service" || first === "help") o.command = first;
    else return { error: `Unknown command "${first}". Try: herdrcc help` };
    args.shift();
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--demo") o.demo = true;
    else if (a === "--remote") o.remote = true;
    else if (a === "--yes" || a === "-y") o.yes = true;
    else if (a === "--help" || a === "-h") o.command = "help";
    else if (a === "--port" || a === "--remote-port") {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return { error: `${a} needs a port number between 1 and 65535.` };
      if (BLOCKED_PORTS.has(n)) return { error: `Browsers refuse to open port ${n}. Choose another ${a === "--port" ? "local port" : "port"}.` };
      if (a === "--port") o.port = n; else o.remotePort = n;
    } else return { error: `Unknown option "${a}". Try: herdrcc help` };
  }
  return o;
}

export const HELP = `Herdr Control Center

Usage:
  herdrcc [options]        Start Control Center
  herdrcc pair             Print a pairing link and QR code for a new device
  herdrcc install-service  Keep it running in the background and after reboots
  herdrcc uninstall-service

Options:
  --remote             Make it reachable from your other devices over Tailscale (tailnet only, never public)
  --remote-port <n>    HTTPS port on your tailnet address (default ${DEFAULT_REMOTE_PORT})
  --port <n>           Local port (default 4173)
  --yes                Do not ask before changing Tailscale Serve
  --demo               Run with sample data, no Herdr needed
`;

export interface TailnetInfo { dnsName: string }

export function readTailnet(statusJson: string): TailnetInfo | { error: string } {
  let d: { BackendState?: string; Self?: { DNSName?: string } };
  try { d = JSON.parse(statusJson); } catch { return { error: "Tailscale returned something unreadable. Update Tailscale and try again." }; }
  if (d.BackendState !== "Running") return { error: "Tailscale is installed but not connected. Run `tailscale up`, then try again." };
  const dnsName = d.Self?.DNSName?.replace(/\.$/u, "");
  if (!dnsName) return { error: "Tailscale has no address for this machine. Enable MagicDNS and HTTPS in the Tailscale admin console." };
  return { dnsName };
}

export function hostFor(dnsName: string, port: number): string {
  return port === 443 ? dnsName : `${dnsName}:${port}`;
}

export type ServePlan = { action: "create" } | { action: "reuse" } | { action: "refuse"; reason: string };

/** Decides whether Control Center may claim this tailnet HTTPS port. It never takes over another service's port and never allows public Funnel. */
export function planServe(serveStatusJson: string, host: string, localPort: number): ServePlan {
  let d: { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>; AllowFunnel?: Record<string, boolean> };
  try { d = serveStatusJson.trim() ? JSON.parse(serveStatusJson) : {}; } catch { return { action: "refuse", reason: "Could not read the current Tailscale Serve settings." }; }
  const key = host.includes(":") ? host : `${host}:443`;
  if (d.AllowFunnel?.[key]) return { action: "refuse", reason: `Tailscale Funnel is on for ${key}, which would put Control Center on the public internet. Turn Funnel off for that port or choose another with --remote-port.` };
  const web = d.Web?.[key];
  if (!web) return { action: "create" };
  const proxies = Object.values(web.Handlers ?? {}).map((h) => h.Proxy);
  const ours = new Set([`http://127.0.0.1:${localPort}`, `http://localhost:${localPort}`]);
  if (proxies.length === 1 && proxies[0] && ours.has(proxies[0])) return { action: "reuse" };
  return { action: "refuse", reason: `${key} is already used by something else in Tailscale Serve. Choose another port with --remote-port.` };
}

export function runtimeFile(): string {
  return path.join(defaultStateDirectory(), "runtime.json");
}

export interface Runtime { port: number; capability: string; remoteHost: string | null; pid: number }

export function writeRuntime(value: Runtime): void {
  try {
    const file = runtimeFile();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch { /* `pair` will then say Control Center is not running */ }
}

export function clearRuntime(): void {
  try { rmSync(runtimeFile(), { force: true }); } catch { /* nothing to clear */ }
}

export function readRuntime(): Runtime | null {
  try {
    const r = JSON.parse(readFileSync(runtimeFile(), "utf8")) as Runtime;
    if (typeof r.port !== "number" || typeof r.capability !== "string") return null;
    try { process.kill(r.pid, 0); } catch { return null; }
    return r;
  } catch { return null; }
}

export function systemdUnit(o: { node: string; script: string; args: string[]; path: string }): string {
  const q = (v: string) => (/[\s"\\]/u.test(v) ? `"${v.replace(/(["\\])/gu, "\\$1")}"` : v);
  return `[Unit]
Description=Herdr Control Center
After=network-online.target

[Service]
ExecStart=${[o.node, o.script, ...o.args].map(q).join(" ")}
Environment=PATH=${o.path}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export function launchdPlist(o: { label: string; node: string; script: string; args: string[]; path: string; log: string }): string {
  const esc = (v: string) => v.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  const items = [o.node, o.script, ...o.args].map((v) => `    <string>${esc(v)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
${items}
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${esc(o.path)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(o.log)}</string>
  <key>StandardErrorPath</key><string>${esc(o.log)}</string>
</dict>
</plist>
`;
}
