import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
}

interface StoredDevice extends DeviceInfo {
  tokenHash: string;
}

const PAIR_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 60 * 1000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function defaultStateDirectory(): string {
  return process.env.HERDR_CONTROL_CENTER_STATE_DIR?.trim() || path.join(homedir(), ".config", "herdrcc");
}

/**
 * Paired browsers and phones. Only a hash of each device token is stored, in a file readable by the owner alone.
 * Pairing codes live in memory, expire after ten minutes and work once.
 */
export class DeviceStore {
  private devices: StoredDevice[] = [];
  private codes = new Map<string, number>();
  private attempts: number[] = [];
  private readonly file: string | null;

  constructor(directory: string | null = defaultStateDirectory()) {
    this.file = directory ? path.join(directory, "devices.json") : null;
    if (this.file) {
      try { this.devices = JSON.parse(readFileSync(this.file, "utf8")) as StoredDevice[]; } catch { this.devices = []; }
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(this.devices, null, 2), { mode: 0o600 });
      renameSync(temp, this.file);
      chmodSync(this.file, 0o600);
    } catch { /* devices then last only until restart */ }
  }

  newPairingCode(): string {
    const code = randomBytes(16).toString("base64url");
    this.codes.set(hash(code), Date.now() + PAIR_TTL_MS);
    return code;
  }

  /** Exchanges a pairing code for a long-lived device token. Returns null for a bad, used, expired or rate-limited code. */
  pair(code: string, name: string): { token: string; device: DeviceInfo } | null {
    const now = Date.now();
    this.attempts = this.attempts.filter((t) => now - t < ATTEMPT_WINDOW_MS);
    if (this.attempts.length >= MAX_ATTEMPTS) return null;
    this.attempts.push(now);
    for (const [key, expires] of this.codes) if (expires < now) this.codes.delete(key);
    const key = hash(code);
    if (!this.codes.has(key)) return null;
    this.codes.delete(key);
    const token = randomBytes(32).toString("base64url");
    const stamp = new Date(now).toISOString();
    const device: StoredDevice = { id: randomBytes(6).toString("hex"), name: name.slice(0, 60) || "Device", createdAt: stamp, lastSeenAt: stamp, tokenHash: hash(token) };
    this.devices.push(device);
    this.save();
    return { token, device: this.info(device) };
  }

  /** Returns the device a token belongs to and refreshes its last-seen time at most once a minute. */
  verify(token: string): DeviceInfo | null {
    const candidate = Buffer.from(hash(token), "hex");
    for (const device of this.devices) {
      const stored = Buffer.from(device.tokenHash, "hex");
      if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
        const now = Date.now();
        if (now - Date.parse(device.lastSeenAt) > 60_000) { device.lastSeenAt = new Date(now).toISOString(); this.save(); }
        return this.info(device);
      }
    }
    return null;
  }

  list(): DeviceInfo[] {
    return this.devices.map((d) => this.info(d));
  }

  revoke(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) return false;
    this.save();
    return true;
  }

  private info({ id, name, createdAt, lastSeenAt }: StoredDevice): DeviceInfo {
    return { id, name, createdAt, lastSeenAt };
  }
}
