import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { DemoLive } from "./demo.js";
import { HerdrLive } from "./live.js";
import { DeviceStore } from "./devices.js";
import QRCode from "qrcode";
import { clearRuntime, writeRuntime } from "./setup.js";

const serverFile = fileURLToPath(import.meta.url);
const serverDirectory = path.dirname(serverFile);
const production = /[\\/]dist[\\/]server[\\/]/.test(serverFile);
const projectRoot = production ? path.resolve(serverDirectory, "../..") : process.cwd();
const portValue = Number(process.env.HERDR_CONTROL_CENTER_PORT ?? "4173");
const port = Number.isInteger(portValue) && portValue > 0 && portValue < 65_536 ? portValue : 4173;
const remoteHost = process.env.HERDR_CONTROL_CENTER_REMOTE_HOST?.trim().toLowerCase() || undefined;
const capability = randomBytes(32).toString("base64url");
const devices = new DeviceStore(process.argv.includes("--demo") ? null : undefined);
const demo = process.argv.includes("--demo") || process.env.HERDR_CONTROL_CENTER_DEMO === "1";
const app = createApp({ capability, port, production, remoteHost, devices }, demo ? new DemoLive() : new HerdrLive());
const server = createServer(app);

let closeVite: (() => Promise<void>) | undefined;

async function start(): Promise<void> {
  if (production) {
    const clientDirectory = path.resolve(projectRoot, "dist/client");
    app.get("/", async (_req, res, next) => {
      try {
        const shell = await readFile(path.join(clientDirectory, "index.html"), "utf8");
        res.setHeader("Cache-Control", "no-store");
        res.status(200).type("html").send(shell);
      } catch (error) {
        next(error);
      }
    });
    app.use((await import("express")).default.static(clientDirectory, { dotfiles: "deny", index: false }));
    app.use(async (req, res, next) => {
      if (req.method !== "GET" || !req.accepts("html")) return next();
      try {
        res.setHeader("Cache-Control", "no-store");
        res.sendFile(path.join(clientDirectory, "index.html"));
      } catch (error) {
        next(error);
      }
    });
    app.use((_req, res) => {
      res.status(404).json({ error: { code: "not_found", message: "This page is not available." } });
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: path.resolve(projectRoot, "vite.config.ts"),
      root: projectRoot,
      appType: "custom",
      server: {
        middlewareMode: true,
        ws: { server },
      },
    });
    closeVite = () => vite.close();
    app.use(vite.middlewares as never);
    app.use(async (req, res, next) => {
      if (req.method !== "GET" || !req.accepts("html")) return next();
      try {
        const template = await readFile(path.resolve(projectRoot, "index.html"), "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.setHeader("Cache-Control", "no-store");
        res.status(200).type("html").send(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
    app.use((_req, res) => {
      res.status(404).json({ error: { code: "not_found", message: "This page is not available." } });
    });
  }

  server.listen(port, "127.0.0.1", () => {
    if (!demo) writeRuntime({ port, capability, remoteHost: remoteHost ?? null, pid: process.pid });
    process.stdout.write(`Herdr Control Center is ready at http://127.0.0.1:${port}/#launch=${capability}\n`);
    if (remoteHost) {
      const pairUrl = `https://${remoteHost}/#pair=${devices.newPairingCode()}`;
      process.stdout.write(`\nTo use it from another device on your tailnet, open this link there once (valid 10 minutes, works once):\n${pairUrl}\n\n`);
      void QRCode.toString(pairUrl, { type: "terminal", small: true }).then((qr) => process.stdout.write(`${qr}\nThat device stays paired until you revoke it in Settings.\n`));
    }
  });
}

async function shutdown(): Promise<void> {
  clearRuntime();
  await closeVite?.();
  server.close(() => { process.exitCode = 0; });
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

void start().catch(() => {
  process.stderr.write("Herdr Control Center could not start. Check the local configuration and retry.\n");
  process.exitCode = 1;
});
