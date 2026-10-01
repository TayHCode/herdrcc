import { closeSync, openSync, readSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ChatItem } from "../shared/live.js";

const TAIL_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 80;
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/u;
const pathCache = new Map<string, string>();

function walk(dir: string, depth: number, match: (name: string) => boolean): string | null {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (e.isFile() && match(e.name)) return path.join(dir, e.name);
  }
  if (depth <= 0) return null;
  for (const e of entries.sort((a, b) => b.name.localeCompare(a.name))) {
    if (e.isDirectory()) { const hit = walk(path.join(dir, e.name), depth - 1, match); if (hit) return hit; }
  }
  return null;
}

/** Locates a Codex rollout or Claude Code session log for a Herdr agent session id. */
export function sessionFile(kind: string | null, id: string | null): string | null {
  if (!id || !SESSION_ID.test(id) || (kind !== "codex" && kind !== "claude")) return null;
  const key = `${kind}:${id}`;
  const cached = pathCache.get(key);
  if (cached && existsSync(cached)) return cached;
  const home = homedir();
  const found = kind === "codex"
    ? walk(path.join(home, ".codex", "sessions"), 4, (n) => n.endsWith(`${id}.jsonl`))
    : walk(path.join(home, ".claude", "projects"), 2, (n) => n === `${id}.jsonl`);
  if (found) pathCache.set(key, found);
  return found;
}

export function lastModified(file: string | null): string | null {
  if (!file) return null;
  try { return statSync(file).mtime.toISOString(); } catch { return null; }
}

function tailLines(file: string): string[] {
  const size = statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines.filter(Boolean);
  } finally { closeSync(fd); }
}

const INJECTED = /^\s*(<|# AGENTS\.md|<INSTRUCTIONS>|<environment_context>)/u;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join("\n").trim();
}

class Builder {
  items: ChatItem[] = [];
  message(role: "user" | "assistant", text: string, at: string | null) {
    const clean = text.trim();
    if (!clean || (role === "user" && INJECTED.test(clean))) return;
    this.items.push({ kind: "message", role, text: clean, at });
  }
  work(tool: string | null, at: string | null) {
    const last = this.items.at(-1);
    if (last?.kind === "work") {
      last.steps += 1;
      if (tool && !last.tools.includes(tool) && last.tools.length < 4) last.tools.push(tool);
    } else this.items.push({ kind: "work", steps: 1, tools: tool ? [tool] : [], at });
  }
}

export function parseCodex(lines: string[]): ChatItem[] {
  const b = new Builder();
  for (const line of lines) {
    let d: { timestamp?: string; type?: string; payload?: Record<string, unknown> };
    try { d = JSON.parse(line); } catch { continue; }
    const p = d.payload ?? {};
    const at = d.timestamp ?? null;
    if (d.type !== "response_item") continue;
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) b.message(p.role, textOf(p.content), at);
    else if (p.type === "function_call" || p.type === "custom_tool_call") b.work(typeof p.name === "string" ? p.name : null, at);
  }
  return b.items.slice(-MAX_ITEMS);
}

export function parseClaude(lines: string[]): ChatItem[] {
  const b = new Builder();
  for (const line of lines) {
    let d: { timestamp?: string; type?: string; isSidechain?: boolean; message?: { role?: string; content?: unknown } };
    try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain || (d.type !== "user" && d.type !== "assistant")) continue;
    const at = d.timestamp ?? null;
    const content = d.message?.content;
    if (typeof content === "string") { b.message(d.type, content, at); continue; }
    if (!Array.isArray(content)) continue;
    const text: string[] = [];
    for (const c of content as Array<Record<string, unknown>>) {
      if (c.type === "text" && typeof c.text === "string") text.push(c.text);
      else if (c.type === "tool_use") { if (text.length) { b.message(d.type, text.join("\n"), at); text.length = 0; } b.work(typeof c.name === "string" ? c.name : null, at); }
    }
    if (text.length) b.message(d.type, text.join("\n"), at);
  }
  return b.items.slice(-MAX_ITEMS);
}

export function readChat(kind: string | null, id: string | null): ChatItem[] | null {
  const file = sessionFile(kind, id);
  if (!file) return null;
  try {
    const lines = tailLines(file);
    return kind === "codex" ? parseCodex(lines) : parseClaude(lines);
  } catch { return null; }
}

const lastRequestCache = new Map<string, { mtime: number; request: { text: string; at: string | null } | null }>();

/** The most recent real user request in a session log, cached by file modification time. */
export function lastRequest(kind: string | null, id: string | null): { text: string; at: string | null } | null {
  const file = sessionFile(kind, id);
  if (!file) return null;
  try {
    const mtime = statSync(file).mtimeMs;
    const hit = lastRequestCache.get(file);
    if (hit && hit.mtime === mtime) return hit.request;
    const items = readChat(kind, id) ?? [];
    const last = [...items].reverse().find((i) => i.kind === "message" && i.role === "user");
    const request = last && last.kind === "message" ? { text: last.text, at: last.at } : null;
    lastRequestCache.set(file, { mtime, request });
    return request;
  } catch { return null; }
}
