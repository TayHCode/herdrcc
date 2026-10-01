import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { HELP, hostFor, launchdPlist, parseArgs, planServe, readRuntime, readTailnet, systemdUnit, type Options } from "./setup.js";

const SELF = fileURLToPath(import.meta.url);
const SCRIPT = path.resolve(path.dirname(SELF), "../../bin/herdrcc.js");

function sh(file: string, args: string[], timeout = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, out: stdout, err: stderr || (error?.message ?? "") }));
  });
}

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

async function confirm(question: string, o: Options): Promise<boolean> {
  if (o.yes) return true;
  if (!process.stdin.isTTY) fail(`${question}\nRun again with --yes to allow this, or run it in a terminal so it can ask.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

async function checkHerdr(): Promise<void> {
  const cli = process.env.HERDR_CONTROL_CENTER_CLI?.trim() || "herdr";
  const r = await sh(cli, ["--version"], 5000);
  if (!r.ok) fail(`Control Center needs Herdr, and "${cli}" did not run.\nInstall Herdr (https://herdr.dev) and make sure \`herdr\` is on your PATH, or set HERDR_CONTROL_CENTER_CLI.\nTo look around without Herdr, run: herdrcc --demo`);
}

/** Sets up the tailnet-only HTTPS address for this machine and returns its host. */
async function setupRemote(o: Options, localPort: number): Promise<string> {
  const status = await sh("tailscale", ["status", "--json"], 8000);
  if (!status.ok && /ENOENT|not found/iu.test(status.err)) fail("--remote needs Tailscale, and `tailscale` was not found.\nInstall it from https://tailscale.com/download and sign in, then try again.");
  const tailnet = readTailnet(status.out);
  if ("error" in tailnet) fail(tailnet.error);
  const host = hostFor(tailnet.dnsName, o.remotePort);
  const serve = await sh("tailscale", ["serve", "status", "--json"], 8000);
  const plan = planServe(serve.out, host, localPort);
  if (plan.action === "refuse") fail(plan.reason);
  if (plan.action === "create") {
    const ok = await confirm(`Control Center will ask Tailscale to share it at https://${host} (visible only to devices on your tailnet, never the public internet). Continue?`, o);
    if (!ok) fail("Cancelled. Nothing was changed.");
    const r = await sh("tailscale", ["serve", "--bg", `--https=${o.remotePort}`, `http://127.0.0.1:${localPort}`], 20000);
    if (!r.ok) fail(`Tailscale could not set that up:\n${r.err.trim()}\nYou may need to enable HTTPS in the Tailscale admin console (DNS page), or run this with permission to change Serve (sudo tailscale set --operator=$USER).`);
  }
  return host;
}

async function pair(): Promise<void> {
  const runtime = readRuntime();
  if (!runtime) fail("Control Center is not running. Start it first (herdrcc, or install-service to keep it running).");
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${runtime.port}/api/devices/pairing`, { method: "POST", headers: { Authorization: `Bearer ${runtime.capability}`, "Content-Type": "application/json" }, body: "{}" });
  } catch { fail("Could not reach the running Control Center."); }
  const body = (await res.json()) as { url?: string };
  if (!res.ok || !body.url) fail("Control Center refused to make a pairing code.");
  process.stdout.write(`\nOpen this on the device you want to pair (works once, expires in 10 minutes):\n${body.url}\n\n${await QRCode.toString(body.url, { type: "terminal", small: true })}\n`);
  if (!runtime.remoteHost) process.stdout.write("Remote access is off, so this link only works on this computer. Start with --remote to pair other devices.\n");
}

function serviceArgs(o: Options): string[] {
  const args: string[] = [];
  if (o.remote) args.push("--remote", "--yes", "--remote-port", String(o.remotePort));
  if (o.port) args.push("--port", String(o.port));
  return args;
}

async function installService(o: Options): Promise<void> {
  const args = serviceArgs(o);
  const servicePath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  if (o.remote) await setupRemote(o, o.port ?? 4173); // make sure it works before it runs unattended
  if (process.platform === "linux") {
    const dir = path.join(homedir(), ".config", "systemd", "user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "herdrcc.service"), systemdUnit({ node: process.execPath, script: SCRIPT, args, path: servicePath }));
    for (const step of [["daemon-reload"], ["enable", "--now", "herdrcc.service"]]) {
      const r = await sh("systemctl", ["--user", ...step]);
      if (!r.ok) fail(`systemd refused: ${r.err.trim()}`);
    }
    const linger = await sh("loginctl", ["enable-linger", process.env.USER ?? ""]);
    process.stdout.write(`Installed. Control Center now runs in the background and starts at boot${linger.ok ? "" : " after you log in (run `sudo loginctl enable-linger $USER` to start it at boot)"}.\nPair a device with: herdrcc pair\nStop it with: herdrcc uninstall-service\n`);
  } else if (process.platform === "darwin") {
    const label = "dev.herdrcc";
    const plist = path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
    mkdirSync(path.dirname(plist), { recursive: true });
    writeFileSync(plist, launchdPlist({ label, node: process.execPath, script: SCRIPT, args, path: servicePath, log: path.join(homedir(), "Library", "Logs", "herdrcc.log") }));
    const uid = process.getuid?.() ?? 501;
    await sh("launchctl", ["bootout", `gui/${uid}/${label}`]);
    const r = await sh("launchctl", ["bootstrap", `gui/${uid}`, plist]);
    if (!r.ok) fail(`launchd refused: ${r.err.trim()}`);
    process.stdout.write("Installed. Control Center now runs in the background and starts when you log in.\nPair a device with: herdrcc pair\n");
  } else {
    fail("install-service supports Linux (systemd) and macOS (launchd). On this system, run herdrcc under your own process manager.");
  }
}

async function uninstallService(): Promise<void> {
  if (process.platform === "linux") {
    await sh("systemctl", ["--user", "disable", "--now", "herdrcc.service"]);
    rmSync(path.join(homedir(), ".config", "systemd", "user", "herdrcc.service"), { force: true });
    await sh("systemctl", ["--user", "daemon-reload"]);
  } else if (process.platform === "darwin") {
    const label = "dev.herdrcc";
    await sh("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${label}`]);
    rmSync(path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`), { force: true });
  }
  process.stdout.write("Removed. Paired devices are kept; delete ~/.config/herdrcc to forget them.\nIf you shared it with --remote, turn that off with: tailscale serve --https=<port> off\n");
}

const parsed = parseArgs(process.argv.slice(2));
if ("error" in parsed) fail(parsed.error);
const o = parsed;
if (o.command === "help") { process.stdout.write(HELP); process.exit(0); }
if (o.command === "pair") await pair();
else if (o.command === "install-service") await installService(o);
else if (o.command === "uninstall-service") await uninstallService();
else {
  if (!o.demo) await checkHerdr();
  const localPort = o.port ?? (Number(process.env.HERDR_CONTROL_CENTER_PORT) || 4173);
  if (o.port) process.env.HERDR_CONTROL_CENTER_PORT = String(o.port);
  if (o.demo) process.env.HERDR_CONTROL_CENTER_DEMO = "1";
  if (o.remote) process.env.HERDR_CONTROL_CENTER_REMOTE_HOST = await setupRemote(o, localPort);
  await import("./index.js");
}
