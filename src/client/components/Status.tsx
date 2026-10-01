import type { AgentStatus } from "../../shared/live";
import { STATUS_LABEL } from "../lib/status";

export function StatusDot({ status }: { status: AgentStatus }) {
  return <span className={`sdot ${status}`} role="img" aria-label={STATUS_LABEL[status]} />;
}

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span className={`badge ${status}`}>
      <span className={`sdot ${status}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
