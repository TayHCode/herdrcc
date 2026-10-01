import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, MessageSquare, Pencil, X as XIcon } from "lucide-react";
import type { LiveAgent } from "../../shared/live";
import { closeAgent, renameAgent } from "../api";
import { useArchive } from "../lib/archive";
import { useRoute } from "../lib/router";
import { agentLabel } from "../lib/status";

interface Actions {
  open: (event: MouseEvent, agent: LiveAgent) => void;
  isArchived: (agent: LiveAgent) => boolean;
}
const Ctx = createContext<Actions>({ open: () => undefined, isArchived: () => false });
export const useAgentActions = () => useContext(Ctx);

type Dialog = { type: "rename" | "close"; agent: LiveAgent } | null;

export function AgentActionsProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; agent: LiveAgent } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const { archived, toggle } = useArchive();
  const client = useQueryClient();
  const { go, path } = useRoute();

  const say = useCallback((text: string, bad = false) => { setToast({ text, bad }); setTimeout(() => setToast(null), 3000); }, []);
  const refresh = () => client.invalidateQueries({ queryKey: ["state"] });
  const rename = useMutation({
    mutationFn: ({ agent, name }: { agent: LiveAgent; name: string | null }) => renameAgent(agent.paneId, name),
    onSuccess: () => { setDialog(null); void refresh(); say("Renamed."); },
    onError: (e: Error) => say(e.message, true),
  });
  const close = useMutation({
    mutationFn: (agent: LiveAgent) => closeAgent(agent.paneId),
    onSuccess: (_r, agent) => {
      setDialog(null); void refresh(); say("Pane closed.");
      if (path === `/agents/${encodeURIComponent(agent.paneId)}`) go("/");
    },
    onError: (e: Error) => say(e.message, true),
  });

  const open = useCallback((event: MouseEvent, agent: LiveAgent) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - 220);
    const y = Math.min(event.clientY, window.innerHeight - 230);
    setMenu({ x, y, agent });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("click", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("click", dismiss); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("keydown", key); };
  }, [menu]);

  return (
    <Ctx.Provider value={{ open, isArchived: archived }}>
      {children}
      {menu && (
        <div className="ctx" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-title">{agentLabel(menu.agent)}</div>
          <button role="menuitem" onClick={() => { go(`/agents/${encodeURIComponent(menu.agent.paneId)}`); setMenu(null); }}><MessageSquare size={14} />Open conversation</button>
          <button role="menuitem" onClick={() => { setDialog({ type: "rename", agent: menu.agent }); setMenu(null); }}><Pencil size={14} />Rename…</button>
          <button role="menuitem" onClick={() => { void navigator.clipboard?.writeText(menu.agent.paneId); say("Pane id copied."); setMenu(null); }}><Copy size={14} />Copy pane id</button>
          <div className="ctx-sep" />
          <button role="menuitem" onClick={() => { toggle(menu.agent); say(archived(menu.agent) ? "Restored." : "Archived here. Herdr is unchanged."); setMenu(null); }}>
            {archived(menu.agent) ? <ArchiveRestore size={14} /> : <Archive size={14} />}{archived(menu.agent) ? "Restore" : "Archive"}
          </button>
          <button role="menuitem" className="danger" onClick={() => { setDialog({ type: "close", agent: menu.agent }); setMenu(null); }}><XIcon size={14} />Close pane…</button>
        </div>
      )}
      {dialog?.type === "rename" && <RenameDialog agent={dialog.agent} busy={rename.isPending} onCancel={() => setDialog(null)} onSave={(name) => rename.mutate({ agent: dialog.agent, name })} />}
      {dialog?.type === "close" && (
        <Modal title={`Close ${agentLabel(dialog.agent)}?`} onCancel={() => setDialog(null)}>
          <p className="modal-text">This closes the pane in Herdr and ends the agent running in it. Unsaved work in that terminal is lost. Archive it instead if you only want it out of the way.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
            <button className="btn danger-btn" onClick={() => close.mutate(dialog.agent)} disabled={close.isPending}>Close pane</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast${toast.bad ? " bad" : ""}`} role="status">{toast.text}</div>}
    </Ctx.Provider>
  );
}

function Modal({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onCancel]);
  return (
    <div className="scrim" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function RenameDialog({ agent, busy, onSave, onCancel }: { agent: LiveAgent; busy: boolean; onSave: (name: string | null) => void; onCancel: () => void }) {
  const [value, setValue] = useState(agent.name ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  return (
    <Modal title="Rename agent" onCancel={onCancel}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(value.trim() || null); }}>
        <input ref={input} className="field" value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} aria-label="Agent name" placeholder="Agent name" />
        <p className="modal-text">Renames the agent inside Herdr. Leave it empty to clear the name.</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
