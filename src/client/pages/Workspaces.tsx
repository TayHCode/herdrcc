import type { LiveState } from "../../shared/live";
import { AgentRows } from "../components/AgentRows";
import { StatusBadge } from "../components/Status";

export function Workspaces({ state }: { state: LiveState }) {
  return (
    <div className="page">
      {state.workspaces.map((ws) => {
        const agents = state.agents.filter((a) => a.workspaceId === ws.id);
        return (
          <section key={ws.id} className="group">
            <div className="ws-head list" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 0 }}>
              <span>{ws.label ?? ws.id}</span>
              <span className="chip">{ws.paneCount} pane{ws.paneCount === 1 ? "" : "s"}</span>
              <span className="grow" />
              <StatusBadge status={ws.status} />
            </div>
            <AgentRows agents={agents} state={state} />
          </section>
        );
      })}
      {state.workspaces.length === 0 && <div className="list"><div className="empty">No workspaces yet.</div></div>}
    </div>
  );
}
