import { Link } from "../lib/router";
import type { ActivityEvent } from "../lib/useLive";
import { STATUS_LABEL, relative } from "../lib/status";
import { StatusDot } from "../components/Status";

export function ActivityPage({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="page">
      <section>
        <h2 className="h2">Recent activity</h2>
        <div className="list">
          {events.length === 0 && <div className="empty">Waiting for changes. Status changes and anything you send from here will appear as they happen. This feed lives in the browser and is not stored.</div>}
          {events.map((e) => (
            <Link key={e.id} className="row" to={`/agents/${encodeURIComponent(e.paneId)}`}>
              <StatusDot status={e.to} />
              <span className="nm">{e.agent}</span>
              <span className="sub">{e.from ? `${STATUS_LABEL[e.from]} → ${STATUS_LABEL[e.to]}` : `Appeared as ${STATUS_LABEL[e.to]}`}</span>
              <span />
              <span className="t">{relative(e.at)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
