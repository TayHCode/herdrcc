import { useEffect, useState, type ReactNode } from "react";
import { Activity, Bot, LayoutDashboard, LayoutGrid, Moon, Network, Settings as Cog, Sun } from "lucide-react";
import type { LiveState } from "../../shared/live";
import { Link } from "../lib/router";
import { agentLabel, byAttention, relative } from "../lib/status";
import { StatusDot } from "./Status";
import { useAgentActions } from "./AgentActions";
import { SessionSwitcher } from "./SessionSwitcher";

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return localStorage.getItem("hcc.theme") === "light" ? "light" : "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("hcc.theme", theme); } catch { /* optional */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const;
}

export function Shell({ hasBoard, state, updatedAt, offline, title, crumb, children, flush }: {
  hasBoard?: boolean; state: LiveState | undefined; updatedAt: number; offline: boolean; title: string; crumb?: ReactNode; children: ReactNode; flush?: boolean;
}) {
  const [theme, toggle] = useTheme();
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(id); }, []);
  const { open, isArchived } = useAgentActions();
  const agents = [...(state?.agents ?? [])].filter((a) => !isArchived(a)).sort(byAttention);
  const attention = agents.filter((a) => a.status === "blocked" || a.status === "done").length;
  const blocked = agents.filter((a) => a.status === "blocked").length;
  const stale = offline || (updatedAt > 0 && Date.now() - updatedAt > 8000);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">H</span>Control Center</div>
        <div className="session-slot"><SessionSwitcher /></div>
        <nav className="nav" aria-label="Main">
          <Link to="/"><LayoutDashboard size={16} />Overview{attention > 0 && <span className="count">{attention}</span>}</Link>
          {hasBoard && <Link to="/board"><LayoutGrid size={16} />Board</Link>}
          <Link to="/workspaces"><Network size={16} />Workspaces</Link>
          <Link to="/activity"><Activity size={16} />Activity</Link>
          <Link to="/settings"><Cog size={16} />Settings</Link>
        </nav>
        <div className="section-label">Agents</div>
        <nav className="agent-list" aria-label="Agents">
          {agents.map((agent) => (
            <Link key={agent.paneId} className="agent-link" to={`/agents/${encodeURIComponent(agent.paneId)}`} onContextMenu={(e) => open(e, agent)}>
              <StatusDot status={agent.status} /><span className="n">{agentLabel(agent)}</span>
            </Link>
          ))}
          {agents.length === 0 && <div className="agent-link">No agents yet</div>}
        </nav>
        <div className="sidebar-foot">
          <span className="grow">{state?.source === "demo" ? "Demo data" : "Live from Herdr"}</span>
          <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          {crumb}
          <span className="grow" />
          {state?.source === "demo" && <span className="demo-tag">Demo</span>}
          <span className={`fresh${stale ? " stale" : ""}`}>
            <span className={`sdot ${stale ? "blocked" : "working"}`} aria-hidden="true" />
            {offline ? "Disconnected, showing last known" : updatedAt ? `Updated ${relative(updatedAt)}` : "Connecting…"}
          </span>
        </header>
        {offline && <div className="banner">Control Center lost contact with Herdr. What you see is the last known state.</div>}
        <main className={flush ? "" : "content"} style={flush ? { flex: 1, minHeight: 0 } : undefined}>{children}</main>
      </div>
      <nav className="tabbar" aria-label="Main">
        <Link to="/"><LayoutDashboard size={19} />Overview{blocked > 0 && <span className="count">{blocked}</span>}</Link>
        <Link to="/agents"><Bot size={19} />Agents</Link>
        {hasBoard ? <Link to="/board"><LayoutGrid size={19} />Board</Link> : <Link to="/workspaces"><Network size={19} />Spaces</Link>}
        <Link to="/activity"><Activity size={19} />Activity</Link>
        <Link to="/settings"><Cog size={19} />Settings</Link>
      </nav>
    </div>
  );
}
