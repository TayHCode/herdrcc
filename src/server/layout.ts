import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defaultStateDirectory } from "./devices.js";
import type { BoardLayout } from "../shared/live.js";

const MAX_BYTES = 64 * 1024;

/**
 * Optional, local-only grouping for the Board view. It lives in layouts.json beside the paired-device list:
 *   { "sessions": { "<session name or default>": { "groups": [ { "title": "Builders", "names": ["Ada", "Lin"] } ] } } }
 * Nothing about it is stored in, or shipped with, the app.
 */
export function parseLayout(raw: unknown, session: string | undefined): BoardLayout | null {
  const sessions = (raw as { sessions?: Record<string, { groups?: unknown }> } | null)?.sessions;
  const entry = sessions && typeof sessions === "object" ? sessions[session ?? "default"] : undefined;
  if (!entry || !Array.isArray(entry.groups)) return null;
  const groups = entry.groups.slice(0, 40).flatMap((g): BoardLayout["groups"] => {
    const title = (g as { title?: unknown })?.title;
    const names = (g as { names?: unknown })?.names;
    if (typeof title !== "string" || !title.trim() || !Array.isArray(names)) return [];
    const clean = names.filter((n): n is string => typeof n === "string" && n.length > 0 && n.length <= 80).slice(0, 80);
    return clean.length ? [{ title: title.trim().slice(0, 60), names: clean }] : [];
  });
  return groups.length ? { groups } : null;
}

export function loadLayout(session: string | undefined, directory = defaultStateDirectory()): BoardLayout | null {
  try {
    const file = path.join(directory, "layouts.json");
    if (statSync(file).size > MAX_BYTES) return null;
    return parseLayout(JSON.parse(readFileSync(file, "utf8")), session);
  } catch { return null; }
}
