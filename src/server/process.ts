/** What is running in the foreground of a pane decides how (and whether) text can safely be sent to it. */
export type PaneClass = "agent" | "console" | "shell" | "unknown";

const SHELLS = new Set(["bash", "zsh", "sh", "dash", "fish", "ksh", "csh", "tcsh", "nu", "pwsh"]);
const AGENT_BINARIES = /(^|\/)(codex|claude)(\.js|\.mjs)?$/u;

interface ForegroundProcess { argv?: unknown; name?: unknown; pid?: unknown }

export function classifyProcess(info: unknown): { cls: PaneClass; command: string | null } {
  const root = (info as { result?: { process_info?: { foreground_processes?: ForegroundProcess[]; shell_pid?: unknown } } } | null)?.result?.process_info;
  const procs = Array.isArray(root?.foreground_processes) ? root.foreground_processes : [];
  if (procs.length === 0) return { cls: "unknown", command: null };
  const words = (p: ForegroundProcess) => (Array.isArray(p.argv) ? p.argv.filter((a): a is string => typeof a === "string") : []);
  const describe = (p: ForegroundProcess) => words(p).slice(0, 3).join(" ").slice(0, 120) || null;
  // A recognized agent CLI anywhere in the foreground group, either as the program or as the script it runs.
  const agent = procs.find((p) => words(p).slice(0, 2).some((w) => AGENT_BINARIES.test(w)) || p.name === "codex");
  if (agent) return { cls: "agent", command: describe(agent) };
  const first = procs[0];
  const program = (words(first)[0]?.split("/").pop() ?? (typeof first.name === "string" ? first.name : "")).replace(/^-/u, "");
  if (SHELLS.has(program) || (root?.shell_pid !== undefined && first.pid === root.shell_pid)) return { cls: "shell", command: describe(first) };
  return { cls: "console", command: describe(first) };
}

/** One line, no control characters, under 4 KB: what a canonical-mode terminal reads reliably. */
export function checkConsoleLine(text: string): string | null {
  if (text.trim().length === 0) return "Message is empty.";
  if (/[\u0000-\u001f\u007f]/u.test(text)) return "Console messages must be a single line with no control characters.";
  if (Buffer.byteLength(text, "utf8") > 4000) return "Console messages must be under 4 KB.";
  return null;
}
