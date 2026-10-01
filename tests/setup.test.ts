import { describe, expect, it } from "vitest";
import { hostFor, launchdPlist, parseArgs, planServe, readTailnet, systemdUnit } from "../src/server/setup.js";

describe("command line", () => {
  it("parses commands and options", () => {
    expect(parseArgs([])).toMatchObject({ command: "run", remote: false, demo: false, remotePort: 10000 });
    expect(parseArgs(["--remote", "--yes", "--remote-port", "8444", "--port", "4187"])).toMatchObject({ remote: true, yes: true, remotePort: 8444, port: 4187 });
    expect(parseArgs(["pair"])).toMatchObject({ command: "pair" });
    expect(parseArgs(["install-service", "--remote"])).toMatchObject({ command: "install-service", remote: true });
    expect(parseArgs(["--help"])).toMatchObject({ command: "help" });
  });
  it("explains bad input", () => {
    expect(parseArgs(["frobnicate"])).toHaveProperty("error");
    expect(parseArgs(["--port", "99999"])).toHaveProperty("error");
    expect(parseArgs(["--wat"])).toHaveProperty("error");
    expect(parseArgs(["--port", "4190"])).toHaveProperty("error");
  });
});

describe("tailscale checks", () => {
  it("reads the tailnet address and explains a disconnected Tailscale", () => {
    expect(readTailnet(JSON.stringify({ BackendState: "Running", Self: { DNSName: "box.tail1.ts.net." } }))).toEqual({ dnsName: "box.tail1.ts.net" });
    expect(readTailnet(JSON.stringify({ BackendState: "Stopped", Self: {} }))).toHaveProperty("error");
    expect(readTailnet("nope")).toHaveProperty("error");
    expect(hostFor("box.ts.net", 443)).toBe("box.ts.net");
    expect(hostFor("box.ts.net", 10000)).toBe("box.ts.net:10000");
  });

  const status = JSON.stringify({
    Web: {
      "box.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8320" } } },
      "box.ts.net:10000": { Handlers: { "/": { Proxy: "http://127.0.0.1:4190" } } },
    },
    AllowFunnel: { "box.ts.net:443": true },
  });
  it("creates, reuses, or refuses a port", () => {
    expect(planServe(status, "box.ts.net:9000", 4190)).toEqual({ action: "create" });
    expect(planServe(status, "box.ts.net:10000", 4190)).toEqual({ action: "reuse" });
    expect(planServe(status, "box.ts.net:10000", 5555)).toMatchObject({ action: "refuse" });
    expect(planServe(status, "box.ts.net:8443", 4190)).toMatchObject({ action: "refuse" });
    expect(planServe("", "box.ts.net:10000", 4190)).toEqual({ action: "create" });
  });
  it("never shares publicly", () => {
    const plan = planServe(status, "box.ts.net", 4190);
    expect(plan).toMatchObject({ action: "refuse" });
    expect((plan as { reason: string }).reason).toMatch(/Funnel/u);
  });
});

describe("service files", () => {
  it("writes a systemd unit that restarts on failure", () => {
    const unit = systemdUnit({ node: "/usr/bin/node", script: "/opt/hcc/bin/x.js", args: ["--remote", "--yes"], path: "/usr/bin" });
    expect(unit).toContain("ExecStart=/usr/bin/node /opt/hcc/bin/x.js --remote --yes");
    expect(unit).toContain("Restart=on-failure");
    expect(systemdUnit({ node: "/a b/node", script: "/s.js", args: [], path: "/" })).toContain('ExecStart="/a b/node" /s.js');
  });
  it("writes a launchd plist with escaped values", () => {
    const plist = launchdPlist({ label: "dev.x", node: "/n", script: "/s&.js", args: ["--remote"], path: "/bin", log: "/l" });
    expect(plist).toContain("<string>/s&amp;.js</string>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
  });
});
