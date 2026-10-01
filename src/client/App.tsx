import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RouterProvider, useRoute } from "./lib/router";
import { useLive } from "./lib/useLive";
import { Shell } from "./components/Shell";
import { Overview } from "./pages/Overview";
import { AgentPage } from "./pages/AgentPage";
import { Workspaces } from "./pages/Workspaces";
import { ActivityPage } from "./pages/Activity";
import { Settings } from "./pages/Settings";
import { Board } from "./pages/Board";
import { useQuery } from "@tanstack/react-query";
import { fetchLayout } from "./api";
import { ApiError, pairingResult } from "./api";
import { AgentRows } from "./components/AgentRows";
import { agentLabel } from "./lib/status";
import { useHideOtherPanes } from "./lib/prefs";
import { AgentActionsProvider } from "./components/AgentActions";

function Routes() {
  const { path, session } = useRoute();
  const client = useQueryClient();
  const shown = useRef(session);
  useEffect(() => {
    // Back/forward or a switch to another Herdr session must not briefly show the previous session's agents.
    if (shown.current !== session) {
      shown.current = session;
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== "sessions" });
    }
  }, [session, client]);
  const live = useLive();
  const { events, error, updatedAt, loading } = live;
  const [hideOthers] = useHideOtherPanes();
  const layoutQuery = useQuery({ queryKey: ["layout", session], queryFn: fetchLayout, staleTime: 60000, retry: false });
  const layout = layoutQuery.data?.layout ?? null;
  const offline = !!error;
  const openPane = /^\/agents\/(.+)$/u.exec(path)?.[1];
  // The pane you are looking at stays visible even when "hide other panes" is on, so direct links keep working.
  const state = live.state && hideOthers
    ? { ...live.state, agents: live.state.agents.filter((a) => a.kind !== null || encodeURIComponent(a.paneId) === openPane || a.paneId === openPane) }
    : live.state;
  const agentMatch = /^\/agents\/(.+)$/u.exec(path);
  const paneId = agentMatch ? decodeURIComponent(agentMatch[1]) : null;
  const agent = paneId ? state?.agents.find((a) => a.paneId === paneId) : undefined;

  let title = "Overview";
  let body;
  let flush = false;
  if (!state && error instanceof ApiError && error.status === 401) {
    title = "Not paired";
    body = (
      <div className="page" style={{ maxWidth: 560 }}>
        <div className="card" style={{ gap: 10 }}>
          <strong style={{ fontSize: "var(--text-lg)" }}>{pairingResult === "failed" ? "That pairing link did not work" : "This device is not paired yet"}</strong>
          <p className="modal-text" style={{ margin: 0 }}>
            {pairingResult === "failed" ? "The code was already used or has expired. " : ""}
            On the computer running Herdr, open Control Center, go to Settings, choose Create pairing code, then scan the QR code or open the link on this device.
            If you just restarted the server, use the new link it printed.
          </p>
        </div>
      </div>
    );
  } else if (!state) {
    body = <div className="page"><div className="list"><div className="empty">{loading ? "Connecting to Herdr…" : "Could not reach Herdr. Is it running, and is the launch link current?"}</div></div></div>;
  } else if (paneId) {
    title = "Agent"; flush = true;
    body = <AgentPage state={state} paneId={paneId} />;
  } else if (path === "/agents") {
    title = "Agents"; body = <div className="page"><AgentRows agents={state.agents} state={state} /></div>;
  } else if (path === "/board" && layout) {
    title = "Board"; body = <Board state={state} layout={layout} />;
  } else if (path === "/settings") {
    title = "Settings"; body = <Settings />;
  } else if (path === "/workspaces") {
    title = "Workspaces"; body = <Workspaces state={state} />;
  } else if (path === "/activity") {
    title = "Activity"; body = <ActivityPage events={events} />;
  } else {
    body = <Overview state={state} events={events} />;
  }
  return (
    <Shell hasBoard={layout !== null} state={state} updatedAt={updatedAt} offline={offline && !!state} title={agent ? agentLabel(agent) : title} flush={flush}>
      {body}
    </Shell>
  );
}

export function App() {
  return <RouterProvider><AgentActionsProvider><Routes /></AgentActionsProvider></RouterProvider>;
}
