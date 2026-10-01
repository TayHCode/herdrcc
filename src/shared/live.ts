export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface LiveWorkspace {
  id: string;
  label: string | null;
  number: number;
  status: AgentStatus;
  focused: boolean;
  tabCount: number;
  paneCount: number;
}

export interface LiveTab {
  id: string;
  workspaceId: string;
  label: string | null;
  status: AgentStatus;
}

export interface LiveAgent {
  paneId: string;
  workspaceId: string;
  tabId: string;
  name: string | null;
  kind: string | null;
  status: AgentStatus;
  cwd: string | null;
  title: string | null;
  ready: boolean;
  stateSeq: number;
  session: string | null;
  /** Last time the agent's session log changed (ISO), when a session log is available. */
  lastActiveAt: string | null;
}

export interface LiveState {
  source: "herdr" | "demo";
  observedAt: string;
  workspaces: LiveWorkspace[];
  tabs: LiveTab[];
  agents: LiveAgent[];
}

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface PairingInfo {
  url: string;
  qr: string;
  expiresInSeconds: number;
  remote: boolean;
}

export interface LiveOutput {
  paneId: string;
  text: string;
  at: string;
}

export type ChatItem =
  | { kind: "message"; role: "user" | "assistant"; text: string; at: string | null }
  | { kind: "work"; steps: number; tools: string[]; at: string | null };

export interface LiveChat {
  paneId: string;
  available: boolean;
  items: ChatItem[];
  at: string;
}

export interface RecentTask {
  paneId: string;
  text: string;
  at: string | null;
}

export interface SessionSummary {
  name: string;
  running: boolean;
  default: boolean;
}

export interface BoardLayout {
  groups: Array<{ title: string; names: string[] }>;
}
