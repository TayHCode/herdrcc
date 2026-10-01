import { useCallback, useState } from "react";
import type { LiveAgent } from "../../shared/live";

const KEY = "hcc.archived";
export const archiveKey = (a: LiveAgent) => a.session ?? `${a.paneId}:${a.name ?? ""}`;

function load(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/** Archiving only hides an agent in this browser. Herdr is not changed. */
export function useArchive() {
  const [set, setSet] = useState<Set<string>>(load);
  const toggle = useCallback((a: LiveAgent) => {
    setSet((prev) => {
      const next = new Set(prev);
      const k = archiveKey(a);
      if (next.has(k)) next.delete(k); else next.add(k);
      try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch { /* optional */ }
      return next;
    });
  }, []);
  return { archived: (a: LiveAgent) => set.has(archiveKey(a)), toggle };
}
