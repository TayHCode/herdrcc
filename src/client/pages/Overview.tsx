import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { AgentStatus, LiveAgent, LiveState } from "../../shared/live";
import { fetchOutput, fetchRecent } from "../api";
import type { ActivityEvent } from "../lib/useLive";
import { AgentRows } from "../components/AgentRows";
import { StatusBadge, StatusDot } from "../components/Status";
import { Link } from "../lib/router";
import { STATUS_LABEL, agentLabel, byAttention, lastActivity, relative, shortPath } from "../lib/status";
import { useAgentActions } from "../components/AgentActions";
import { SessionSwitcher } from "../components/SessionSwitcher";
import { Avatar } from "../components/Avatar";

function useSummaries(agents: LiveAgent[]): Record<string, string> {
  const live = agents.filter((a) => a.status !== "idle" && a.status !== "unknown").slice(0, 16);
  const results = useQueries({
    queries: live.map((a) => ({
      queryKey: ["summary", a.paneId, a.stateSeq],
      queryFn: () => fetchOutput(a.paneId, 40),
      refetchInterval: a.status === "working" ? 4000 : false,
      staleTime: 3000,
    })),
  });
  const out: Record<string, string> = {};
  live.forEach((a, i) => { const text = results[i]?.data?.text; if (text) out[a.paneId] = lastActivity(text, a.status === "blocked"); });
  return out;
}

function AgentCard({ agent, summary }: { agent: LiveAgent; summary?: string }) {
  const attn = agent.status === "blocked";
  const { open } = useAgentActions();
  return (
    <Link to={`/agents/${encodeURIComponent(agent.paneId)}`} className={`card${attn ? " attn" : ""}`} onContextMenu={(e) => open(e, agent)}>
      <div className="card-head">
        <Avatar name={agentLabel(agent)} size={24} />
        <span className="name">{agentLabel(agent)}</span>
        <span className="grow" />
        <StatusBadge status={agent.status} />
      </div>
      <div className="activity-line">{summary || "No recent output."}</div>
      <div className="card-foot">
        <span className="chip">{agent.kind ?? "agent"}</span>
        <span className="mono">{shortPath(agent.cwd)}</span>
        <span className="grow" />
        <span>{attn ? "Open to answer" : agent.status === "done" ? "Review" : "Open"} <ArrowRight size={11} style={{ verticalAlign: -1 }} /></span>
      </div>
    </Link>
  );
}

function RecentColumns({ state, events }: { state: LiveState; events: ActivityEvent[] }) {
  const recent = useQuery({ queryKey: ["recent"], queryFn: fetchRecent, refetchInterval: 8000 });
  const byPane = new Map(state.agents.map((a) => [a.paneId, a]));
  // Live status changes first, then each agent's last session activity so the column is useful straight after loading.
  const seen = new Set(events.map((e) => e.paneId));
  const feed = [
    ...events.slice(0, 8).map((e) => ({ key: `e${e.id}`, paneId: e.paneId, name: e.agent, status: e.to, text: e.from ? `${STATUS_LABEL[e.from]} → ${STATUS_LABEL[e.to]}` : `Appeared as ${STATUS_LABEL[e.to]}`, at: e.at })),
    ...state.agents.filter((a) => a.lastActiveAt && !seen.has(a.paneId))
      .sort((a, b) => Date.parse(b.lastActiveAt as string) - Date.parse(a.lastActiveAt as string)).slice(0, 8)
      .map((a) => ({ key: `a${a.paneId}`, paneId: a.paneId, name: agentLabel(a), status: a.status, text: `${STATUS_LABEL[a.status]} · last activity`, at: Date.parse(a.lastActiveAt as string) })),
  ].slice(0, 8);
  const tasks = recent.data?.tasks ?? [];
  return (
    <div className="two-col">
      <section>
        <h2 className="h2">Recent activity</h2>
        <div className="list">
          {feed.length === 0 && <div className="empty">Changes show up here as they happen.</div>}
          {feed.map((f) => (
            <Link key={f.key} className="frow" to={`/agents/${encodeURIComponent(f.paneId)}`}>
              <Avatar name={f.name} size={24} />
              <span className="frow-main"><strong>{f.name}</strong> <span className="muted">{f.text}</span></span>
              <span className="t">{relative(f.at)}</span>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="h2">Recent tasks</h2>
        <div className="list">
          {tasks.length === 0 && <div className="empty">{recent.isLoading ? "Loading…" : "Requests you send agents appear here."}</div>}
          {tasks.slice(0, 8).map((t) => {
            const agent = byPane.get(t.paneId);
            if (!agent) return null;
            return (
              <Link key={t.paneId} className="frow task" to={`/agents/${encodeURIComponent(t.paneId)}`}>
                <StatusDot status={agent.status} />
                <span className="frow-main task-text">{t.text}</span>
                <span className="task-agent"><Avatar name={agentLabel(agent)} size={20} /><span>{agentLabel(agent)}</span></span>
                <span className="t">{t.at ? relative(Date.parse(t.at)) : ""}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function Overview({ state, events }: { state: LiveState; events: ActivityEvent[] }) {
  const { isArchived } = useAgentActions();
  const all = state.agents;
  const archivedAgents = all.filter(isArchived);
  const agents = all.filter((a) => !isArchived(a)).sort(byAttention);
  const summaries = useSummaries(agents);
  const count = (s: AgentStatus) => agents.filter((a) => a.status === s).length;
  const queue = agents.filter((a) => a.status === "blocked" || a.status === "done");
  const working = agents.filter((a) => a.status === "working");
  const idle = agents.filter((a) => a.status === "idle" || a.status === "unknown");
  const kpis: Array<[AgentStatus, string, string]> = [["blocked", "Need you", "blocked"], ["done", "Finished, to review", "done"], ["working", "Working now", "working"], ["idle", "Idle", "idle"]];

  return (
    <div className="page">
      <div className="mobile-only"><SessionSwitcher /></div>
      <div className="kpis">
        {kpis.map(([status, label, cls]) => (
          <div key={status} className={`kpi ${cls}${status === "blocked" && count(status) > 0 ? " hot" : ""}`}>
            <div className="num">{count(status)}</div>
            <div className="lab"><StatusDot status={status} />{label}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="h2">Needs you</h2>
        {queue.length === 0
          ? <div className="list"><div className="empty">Nothing is waiting on you. Agents that need a decision or finish a turn show up here first.</div></div>
          : <div className="cards">{queue.map((a) => <AgentCard key={a.paneId} agent={a} summary={summaries[a.paneId]} />)}</div>}
      </section>

      {working.length > 0 && (
        <section>
          <h2 className="h2">Working now</h2>
          <div className="cards">{working.map((a) => <AgentCard key={a.paneId} agent={a} summary={summaries[a.paneId]} />)}</div>
        </section>
      )}

      <RecentColumns state={state} events={events} />

      <section>
        <h2 className="h2">Idle <span className="mono">{idle.length}</span></h2>
        <AgentRows agents={idle} state={state} />
      </section>

      {archivedAgents.length > 0 && (
        <details>
          <summary className="h2" style={{ cursor: "pointer" }}>Archived <span className="mono">{archivedAgents.length}</span></summary>
          <AgentRows agents={archivedAgents} state={state} />
        </details>
      )}
    </div>
  );
}
