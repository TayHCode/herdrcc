import type { ChatItem } from "../../shared/live";

/**
 * For panes without a session log (custom consoles), turns terminal lines that start with "<Name>: " into
 * assistant messages. Anything else, such as shell prompts and status lines, is left to the Terminal view.
 */
export function chatFromTerminal(text: string, name: string): ChatItem[] {
  const prefix = `${name.toLowerCase()}: `;
  const items: ChatItem[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.toLowerCase().startsWith(prefix) && line.length > prefix.length) {
      items.push({ kind: "message", role: "assistant", text: line.slice(prefix.length), at: null });
    }
  }
  return items.slice(-60);
}
