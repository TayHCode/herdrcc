import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode, Smartphone, Trash2 } from "lucide-react";
import { createPairing, fetchDevices, revokeDevice } from "../api";
import { relative } from "../lib/status";
import { useHideOtherPanes } from "../lib/prefs";

export function Settings() {
  const client = useQueryClient();
  const devices = useQuery({ queryKey: ["devices"], queryFn: fetchDevices });
  const [error, setError] = useState<string | null>(null);
  const pairing = useMutation({ mutationFn: createPairing, onError: (e: Error) => setError(e.message) });
  const revoke = useMutation({
    mutationFn: revokeDevice,
    onSuccess: () => client.invalidateQueries({ queryKey: ["devices"] }),
    onError: (e: Error) => setError(e.message),
  });
  const remote = devices.data?.remote ?? false;
  const [hideOthers, setHideOthers] = useHideOtherPanes();

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <section>
        <h2 className="h2">Display</h2>
        <label className="card" style={{ gridTemplateColumns: "auto 1fr", alignItems: "start", cursor: "pointer" }}>
          <input type="checkbox" checked={hideOthers} onChange={(e) => setHideOthers(e.target.checked)} style={{ marginTop: 4 }} />
          <span>
            <strong>Hide panes that aren’t Codex or Claude agents</strong>
            <span className="modal-text" style={{ display: "block", marginTop: 4 }}>
              Custom consoles and plain shells disappear from the lists and counts. This only changes this browser; Herdr is untouched.
            </span>
          </span>
        </label>
      </section>
      <section>
        <h2 className="h2">Pair another device</h2>
        <div className="card" style={{ gap: 14 }}>
          {!remote && !pairing.data && (
            <p className="modal-text" style={{ margin: 0 }}>
              Remote access is off. Start Control Center with <span className="mono">HERDR_CONTROL_CENTER_REMOTE_HOST</span> set to the Tailscale address
              from <span className="mono">tailscale serve</span> and a pairing QR code will appear in the terminal and here.
            </p>
          )}
          {pairing.data ? (
            <div className="pair">
              <img src={pairing.data.qr} width={200} height={200} alt="Pairing QR code" />
              <div>
                <p style={{ margin: "0 0 8px" }}>Scan with the device’s camera, or open this link on it. It works once and expires in 10 minutes.</p>
                <input className="field mono" readOnly value={pairing.data.url} onFocus={(e) => e.currentTarget.select()} aria-label="Pairing link" />
                {!pairing.data.remote && <p className="modal-text">This link only works on this computer because remote access is off.</p>}
              </div>
            </div>
          ) : (
            <div><button className="btn primary" onClick={() => { setError(null); pairing.mutate(); }} disabled={pairing.isPending}><QrCode size={14} />Create pairing code</button></div>
          )}
          {error && <p className="modal-text" style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}
        </div>
      </section>
      <section>
        <h2 className="h2">Paired devices</h2>
        <div className="list">
          {(devices.data?.devices ?? []).length === 0 && <div className="empty">{devices.isLoading ? "Loading…" : "No paired devices. This computer uses its launch link."}</div>}
          {(devices.data?.devices ?? []).map((d) => (
            <div className="arow" key={d.id} style={{ gridTemplateColumns: "32px minmax(0,1fr) 110px 40px" }}>
              <Smartphone size={18} />
              <span className="arow-main"><span className="nm">{d.name}</span><span className="sub">Paired {relative(Date.parse(d.createdAt))}</span></span>
              <span className="t">Seen {relative(Date.parse(d.lastSeenAt))}</span>
              <button className="icon-btn" aria-label={`Revoke ${d.name}`} onClick={() => { if (window.confirm(`Revoke ${d.name}? It will need to pair again.`)) revoke.mutate(d.id); }}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
