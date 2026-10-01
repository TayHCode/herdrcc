import { useQuery } from "@tanstack/react-query";
import { fetchSessions } from "../api";
import { useRoute } from "../lib/router";

/** Picks which named Herdr session to show. Hidden when there is only one running session. */
export function SessionSwitcher() {
  const { session, go } = useRoute();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: fetchSessions, refetchInterval: 15000, retry: false });
  const running = (sessions.data?.sessions ?? []).filter((s) => s.running);
  if (running.length < 2) return null;
  const current = session ?? running.find((s) => s.default)?.name ?? "default";
  return (
    <label className="session-switch">
      <span className="section-label" style={{ padding: "0 0 6px" }}>Session</span>
      <select
        className="field"
        value={current}
        aria-label="Herdr session"
        onChange={(e) => {
          const next = running.find((s) => s.name === e.target.value);
          go("/", next?.default ? null : e.target.value);
        }}
      >
        {running.map((s) => <option key={s.name} value={s.name}>{s.default ? `${s.name} (default)` : s.name}</option>)}
      </select>
    </label>
  );
}
