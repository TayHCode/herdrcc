import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, Check, CheckCheck, MoreHorizontal, Send, Square, X } from "lucide-react";
import type { LiveAgent, LiveState } from "../../shared/live";
import { fetchChat, fetchOutput, fetchProcess, sendKeys, sendPrompt } from "../api";
import { Avatar } from "../components/Avatar";
import { Markdown } from "../components/Markdown";
import { useAgentActions } from "../components/AgentActions";
import type { ChatItem } from "../../shared/live";
import { StatusBadge } from "../components/Status";
import { Link, useRoute } from "../lib/router";
import { agentLabel, lastActivity, relative, shortPath } from "../lib/status";
import { chatFromTerminal } from "../lib/terminalChat";

function lineClass(line: string): string {
  const t = line.trimStart();
  if (/^(›|>)\s/u.test(t)) return "user";
  if (/^[●•]/u.test(t)) return "bullet";
  if (/\b(PASS|passed|succeeded|✓)\b/u.test(t)) return "ok";
  if (/\b(FAIL|failed|error|Error)\b/u.test(t)) return "bad";
  if (/^[─━│┃╭╮╰╯┌┐└┘├┤\s]+$/u.test(t) || /esc to interrupt|\? for shortcuts/u.test(t)) return "dim";
  return "";
}

function ScrollPane({ watch, className, label, children }: { watch: unknown; className: string; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [watch]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAway(!pinned.current);
  };
  return (
    <div className="convo-body">
      <div className={className} ref={ref} onScroll={onScroll} role="log" aria-live="off" tabIndex={0} aria-label={label}>{children}</div>
      {away && (
        <button className="btn jump" onClick={() => { const el = ref.current; if (el) { el.scrollTop = el.scrollHeight; pinned.current = true; setAway(false); } }}>
          <ArrowDown size={14} />Latest
        </button>
      )}
    </div>
  );
}

function Transcript({ text }: { text: string }) {
  // Drop the agent TUI's own footer (composer box, model/status line) so the transcript ends at the last real output.
  const lines = text.replace(/\s+$/u, "").split("\n");
  const chrome = /^\s*(›\s*Ask |\? for shortcuts|GPT-|⚠ \d+ warning|Tip: |Esc to |.*esc to interrupt|.*Context \d+%)/u;
  while (lines.length > 1 && (chrome.test(lines[lines.length - 1]) || lines[lines.length - 1].trim() === "")) lines.pop();
  return (
    <ScrollPane watch={text} className="transcript" label="Terminal output">
      {lines.map((line, i) => <div key={i} className={`tline ${lineClass(line)}`}>{line || " "}</div>)}
    </ScrollPane>
  );
}

function Chat({ items, agentName, working }: { items: ChatItem[]; agentName: string; working: boolean }) {
  if (items.length === 0) return <div className="chat"><div className="empty">No messages yet. Say something below.</div></div>;
  return (
    <ScrollPane watch={items.length + (working ? 1 : 0)} className="chat" label="Conversation">
      <div className="chat-inner">
        {items.map((item, i) => item.kind === "work" ? (
          <div className="work" key={i}>
            <CheckCheck size={13} /><span>Worked · {item.steps} step{item.steps === 1 ? "" : "s"}</span>
            {item.tools.length > 0 && <span className="work-tools mono">{item.tools.join(", ")}</span>}
          </div>
        ) : (
          <article className={`msg ${item.role}`} key={i}>
            <header>
              {item.role === "assistant" ? <><Avatar name={agentName} size={22} /><strong>{agentName}</strong></> : <strong>You</strong>}
              {item.at && <time className="msg-time">{relative(Date.parse(item.at))}</time>}
            </header>
            {item.role === "assistant" ? <Markdown text={item.text} /> : <div className="msg-user-text">{item.text}</div>}
          </article>
        ))}
        {working && <div className="work live"><span className="sdot working" />{agentName} is working…</div>}
      </div>
    </ScrollPane>
  );
}

// Words that make a custom console act (pause work, cancel tasks, switch display mode) rather than chat.
const CONTROL_WORDS = new Set(["pause", "resume", "cancel", "stop", "retry", "event", "feedback", "accept", "raw", "human", "exit", "quit"]);

function Composer({ agent, console: isConsole, onSent, onError }: { agent: LiveAgent; console: boolean; onSent: () => void; onError: (m: string) => void }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const mutation = useMutation({
    mutationFn: (value: string) => sendPrompt(agent.paneId, value),
    onSuccess: () => { setText(""); onSent(); },
    onError: (e: Error) => onError(e.message),
  });
  useEffect(() => {
    const el = box.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }
  }, [text]);
  const submit = () => {
    const value = text.trim();
    if (!value || mutation.isPending) return;
    if (isConsole) {
      if (/[\r\n]/u.test(text.trim())) { onError("Console messages must be a single line."); return; }
      const word = value.split(/\s+/u)[0].toLowerCase();
      if (CONTROL_WORDS.has(word) && !window.confirm(`"${word}" is a control command for this console, not a chat message. Send it?`)) return;
    }
    mutation.mutate(value);
  };
  const working = agent.status === "working";
  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={box} rows={1} value={text} aria-label={`Message ${agentLabel(agent)}`}
          placeholder={working ? `${agentLabel(agent)} is working. Your message will be queued.` : `Message ${agentLabel(agent)}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (isConsole || !e.shiftKey) && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
        />
        <button className="btn primary" onClick={submit} disabled={!text.trim() || mutation.isPending}>
          <Send size={14} />Send
        </button>
      </div>
      <div className="hint">{isConsole ? <span>Sent as one typed line, like the terminal. Control commands ask first.</span> : <><span>Enter to send</span><span>Shift+Enter for a new line</span></>}</div>
    </div>
  );
}

export function AgentPage({ state, paneId }: { state: LiveState; paneId: string }) {
  const agent = state.agents.find((a) => a.paneId === paneId);
  const client = useQueryClient();
  const { go } = useRoute();
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const output = useQuery({
    queryKey: ["output", paneId],
    queryFn: () => fetchOutput(paneId, 200),
    refetchInterval: agent?.status === "working" ? 1200 : 2500,
    enabled: !!agent,
  });
  const chat = useQuery({
    queryKey: ["chat", paneId],
    queryFn: () => fetchChat(paneId),
    refetchInterval: agent?.status === "working" ? 1500 : 3000,
    enabled: !!agent,
  });
  const [tab, setTab] = useState<"chat" | "terminal" | null>(null);
  // What is really running in the pane decides whether typing is safe and how it is delivered.
  const { open } = useAgentActions();
  const proc = useQuery({ queryKey: ["process", paneId], queryFn: () => fetchProcess(paneId), refetchInterval: 15000, enabled: !!agent });
  const say = (text: string, bad = false) => { setToast({ text, bad }); setTimeout(() => setToast(null), 3000); };
  const refreshSoon = () => { void client.invalidateQueries({ queryKey: ["output", paneId] }); void client.invalidateQueries({ queryKey: ["chat", paneId] }); void client.invalidateQueries({ queryKey: ["state"] }); };
  const keys = useMutation({
    mutationFn: (k: string[]) => sendKeys(paneId, k),
    onSuccess: refreshSoon,
    onError: (e: Error) => say(e.message, true),
  });

  if (!agent) {
    return (
      <div className="page" style={{ padding: 24 }}>
        <div className="list"><div className="empty">This agent is no longer in Herdr. <Link to="/" style={{ color: "var(--accent)" }}>Back to overview</Link></div></div>
      </div>
    );
  }
  const ws = state.workspaces.find((w) => w.id === agent.workspaceId);
  const blocked = agent.status === "blocked";
  const cls = proc.data?.cls ?? (agent.kind ? "agent" : "unknown");
  const isConsole = cls === "console";
  const canType = cls === "agent" || isConsole;
  const canKey = cls === "agent";
  // A console has no session log worth showing, so its chat is read from its terminal lines.
  const termChat = isConsole || (cls === "unknown" && agent.kind === null) ? chatFromTerminal(output.data?.text ?? "", agentLabel(agent)) : [];
  const logChat = !isConsole && chat.data?.available === true;
  const chatReady = logChat || termChat.length > 0;
  const chatItems = logChat ? (chat.data?.items ?? []) : termChat;
  const view = tab ?? (chatReady && !blocked ? "chat" : "terminal");
  const question = blocked && output.data?.text ? lastActivity(output.data.text, true) : "";

  return (
    <div className="agent-page">
      <div className="convo">
        <div className="convo-head">
          <button className="icon-btn back" onClick={() => go("/")} aria-label="Back"><ArrowLeft size={18} /></button>
          <h2>{agentLabel(agent)}</h2>
          <StatusBadge status={agent.status} />
          <span className="grow" />
          {chatReady && (
            <div className="seg" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === "chat"} onClick={() => setTab("chat")}>Chat</button>
              <button role="tab" aria-selected={view === "terminal"} onClick={() => setTab("terminal")}>Terminal</button>
            </div>
          )}
          {agent.status === "working" && canKey && (
            <button className="btn" onClick={() => keys.mutate(["esc"])} disabled={keys.isPending} title="Send Escape to the agent">
              <Square size={12} />Interrupt
            </button>
          )}
          <button className="icon-btn" aria-label="Agent actions" onClick={(e) => open(e, agent)}><MoreHorizontal size={18} /></button>
        </div>
        {blocked && (
          <div className="attention-bar" role="alert">
            <span className="msg">{question ? `${agentLabel(agent)} asks: ${question}` : `${agentLabel(agent)} is waiting for your decision.`}</span>
            {canKey && <button className="btn warn" onClick={() => keys.mutate(["1"])} disabled={keys.isPending}><Check size={14} />Approve</button>}
            {canKey && <button className="btn" onClick={() => keys.mutate(["3"])} disabled={keys.isPending}><X size={14} />Decline</button>}
          </div>
        )}
        {view === "chat" && chatReady
          ? <Chat items={chatItems} agentName={agentLabel(agent)} working={agent.status === "working"} />
          : <Transcript text={output.data?.text ?? (output.isLoading ? "Loading…" : "No output yet.")} />}
        {canType
          ? <Composer agent={agent} console={isConsole} onSent={refreshSoon} onError={(m) => say(m, true)} />
          : (
            <div className="composer">
              <div className="notice">
                <span>
                  <strong>Read only.</strong> {cls === "shell"
                    ? `${agentLabel(agent)} is at a shell prompt, so anything typed here would run as a command.`
                    : proc.isLoading ? "Checking what is running in this pane…" : `Control Center can't tell what is running in ${agentLabel(agent)}, so it won't type into it.`}
                </span>
              </div>
            </div>
          )}
      </div>
      <aside className="props" aria-label="Properties">
        <h3>Properties</h3>
        <dl>
          <div className="prop"><dt>Status</dt><dd><StatusBadge status={agent.status} /></dd></div>
          <div className="prop"><dt>Workspace</dt><dd>{ws?.label ?? agent.workspaceId}</dd></div>
          <div className="prop"><dt>Agent</dt><dd><span className="chip">{agent.kind ?? "unknown"}</span></dd></div>
          <div className="prop"><dt>Directory</dt><dd className="mono" title={agent.cwd ?? ""}>{shortPath(agent.cwd) || "—"}</dd></div>
          <div className="prop"><dt>Pane</dt><dd className="mono">{agent.paneId}</dd></div>
          <div className="prop"><dt>Ready</dt><dd>{agent.ready ? "Accepting input" : "Busy"}</dd></div>
          {agent.title && <div className="prop"><dt>Title</dt><dd>{agent.title}</dd></div>}
        </dl>
      </aside>
      {toast && <div className={`toast${toast.bad ? " bad" : ""}`} role="status">{toast.text}</div>}
    </div>
  );
}
