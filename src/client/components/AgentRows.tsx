import { MoreHorizontal } from "lucide-react";
import { Link } from "../lib/router";
import type { LiveAgent, LiveState } from "../../shared/live";
import { STATUS_LABEL, agentLabel, byAttention, relative, shortPath } from "../lib/status";
import { useAgentActions } from "./AgentActions";
import { Avatar } from "./Avatar";
import { StatusDot } from "./Status";

export function AgentRows({ agents, state, summaries }: { agents: LiveAgent[]; state?: LiveState; summaries?: Record<string, string> }) {
  const { open } = useAgentActions();
  if (agents.length === 0) return <div className="empty">No agents here yet. Start one in Herdr and it will appear.</div>;
  return (
    <div className="list">
      {[...agents].sort(byAttention).map((agent) => {
        const ws = state?.workspaces.find((w) => w.id === agent.workspaceId);
        const when = agent.lastActiveAt ? relative(Date.parse(agent.lastActiveAt)) : STATUS_LABEL[agent.status];
        return (
          <Link key={agent.paneId} className="arow" to={`/agents/${encodeURIComponent(agent.paneId)}`} onContextMenu={(e) => open(e, agent)}>
            <span className="avatar-wrap"><Avatar name={agentLabel(agent)} /><span className="avatar-status"><StatusDot status={agent.status} /></span></span>
            <span className="arow-main">
              <span className="nm">{agentLabel(agent)}</span>
              <span className="sub">{summaries?.[agent.paneId] || (ws?.label && ws.label !== agentLabel(agent) ? `${ws.label} · ` : "") + shortPath(agent.cwd)}</span>
            </span>
            <span className="chip">{agent.kind ?? "agent"}</span>
            <span className="t">{when}</span>
            <button className="icon-btn more" aria-label={`Actions for ${agentLabel(agent)}`} onClick={(e) => open(e, agent)}><MoreHorizontal size={16} /></button>
          </Link>
        );
      })}
    </div>
  );
}
