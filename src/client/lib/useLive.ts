import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentStatus, LiveAgent, LiveState } from "../../shared/live";
import { fetchState } from "../api";
import { agentLabel } from "./status";

export interface ActivityEvent {
  id: number;
  at: number;
  paneId: string;
  agent: string;
  from: AgentStatus | null;
  to: AgentStatus;
}

export function useLive() {
  const query = useQuery({ queryKey: ["state"], queryFn: fetchState, refetchInterval: 2000, retry: 1 });
  const previous = useRef<Map<string, LiveAgent>>(new Map());
  const counter = useRef(0);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const state: LiveState | undefined = query.data;

  useEffect(() => {
    if (!state) return;
    const fresh: ActivityEvent[] = [];
    const first = previous.current.size === 0;
    for (const agent of state.agents) {
      const before = previous.current.get(agent.paneId);
      if (!first && before?.status !== agent.status) {
        fresh.push({ id: ++counter.current, at: Date.now(), paneId: agent.paneId, agent: agentLabel(agent), from: before?.status ?? null, to: agent.status });
      }
    }
    previous.current = new Map(state.agents.map((a) => [a.paneId, a]));
    if (fresh.length) setEvents((list) => [...fresh.reverse(), ...list].slice(0, 200));
  }, [state]);

  return { state, events, error: query.error, updatedAt: query.dataUpdatedAt, loading: query.isLoading };
}
