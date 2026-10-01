import type { AgentStatus, LiveAgent } from "../../shared/live";

export const STATUS_LABEL: Record<AgentStatus, string> = {
  blocked: "Needs you",
  done: "Finished",
  working: "Working",
  idle: "Idle",
  unknown: "Unknown",
};

/** Attention rank: lower is louder. */
export const STATUS_RANK: Record<AgentStatus, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };

export function byAttention(a: LiveAgent, b: LiveAgent): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.name ?? a.paneId).localeCompare(b.name ?? b.paneId);
}

export function agentLabel(agent: LiveAgent): string {
  return agent.name ?? agent.title ?? agent.paneId;
}

export function shortPath(path: string | null): string {
  if (!path) return "";
  const home = path.replace(/^\/home\/[^/]+/u, "~").replace(/^\/Users\/[^/]+/u, "~");
  const parts = home.split("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : home;
}

export function relative(from: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const NOISE = /^(›|>)\s*Ask |^\? for shortcuts|^GPT-|esc to interrupt|^Tip:|^\+ Show details|^Worked for|^↳ Recap|^Working \(|^Esc to|^⚠|^Context \d+%|^Main \[/u;

/** The most useful line of a transcript for a one-line "what is it doing" summary. */
export function lastActivity(text: string, blocked = false): string {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !/^[─━│┃╭╮╰╯┌┐└┘├┤\s-]+$/u.test(l) && !NOISE.test(l));
  const question = blocked ? [...lines].reverse().find((l) => /\?\s*$|^Allow |approve|permission/iu.test(l)) : undefined;
  const line = question ?? lines.at(-1) ?? "";
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}
