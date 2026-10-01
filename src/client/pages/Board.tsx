import type { BoardLayout, LiveAgent, LiveState } from "../../shared/live";
import { Avatar } from "../components/Avatar";
import { StatusDot } from "../components/Status";
import { useAgentActions } from "../components/AgentActions";
import { Link } from "../lib/router";
import { STATUS_LABEL, STATUS_RANK, agentLabel } from "../lib/status";

/** Puts agents into the user's own groups (matched by name, ignoring case). Anyone left over goes in "Other". */
export function groupAgents(layout: BoardLayout, agents: LiveAgent[]): Array<{ title: string; agents: LiveAgent[] }> {
  const taken = new Set<string>();
  const groups = layout.groups.map((g) => {
    const wanted = new Set(g.names.map((n) => n.toLowerCase()));
    const members = agents.filter((a) => !taken.has(a.paneId) && wanted.has(agentLabel(a).toLowerCase()));
    members.forEach((a) => taken.add(a.paneId));
    return { title: g.title, agents: members.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]) };
  });
  const rest = agents.filter((a) => !taken.has(a.paneId));
  return [...groups, ...(rest.length ? [{ title: "Other", agents: rest }] : [])].filter((g) => g.agents.length > 0);
}

export function Board({ state, layout }: { state: LiveState; layout: BoardLayout }) {
  const { open, isArchived } = useAgentActions();
  const groups = groupAgents(layout, state.agents.filter((a) => !isArchived(a)));
  return (
    <div className="page">
      {groups.map((g) => {
        const needs = g.agents.filter((a) => a.status === "blocked" || a.status === "done").length;
        return (
          <section key={g.title}>
            <h2 className="h2">{g.title} <span className="mono">{g.agents.length}</span>{needs > 0 && <span className="badge blocked" style={{ marginLeft: 6 }}>{needs} to look at</span>}</h2>
            <div className="tiles">
              {g.agents.map((a) => (
                <Link key={a.paneId} to={`/agents/${encodeURIComponent(a.paneId)}`} className={`tile ${a.status}`} onContextMenu={(e) => open(e, a)}>
                  <Avatar name={agentLabel(a)} size={28} />
                  <span className="tile-main">
                    <span className="nm">{agentLabel(a)}</span>
                    <span className="sub"><StatusDot status={a.status} /> {STATUS_LABEL[a.status]}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
