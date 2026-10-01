import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("`") ? <code key={m.index}>{tok.slice(1, -1)}</code> : <strong key={m.index}>{tok.slice(2, -2)}</strong>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isRow = (l: string) => /^\s*\|.*\|\s*$/u.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/gu, "").split("|").map((c) => c.trim());

/** Small, safe markdown subset for chat messages. Everything renders as React text, never as HTML. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i += 1;
      blocks.push(<pre key={blocks.length}><code>{code.join("\n")}</code></pre>);
    } else if (isRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/u.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div className="md-table" key={blocks.length}><table>
          <thead><tr>{head.map((c, k) => <th key={k}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
    } else if (/^#{1,4}\s/u.test(line)) {
      blocks.push(<h4 key={blocks.length}>{inline(line.replace(/^#{1,4}\s+/u, ""))}</h4>);
      i += 1;
    } else if (/^\s*([-*•]|\d+[.)])\s/u.test(line)) {
      const ordered = /^\s*\d/u.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s/u.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/u, ""));
      const children = items.map((t, k) => <li key={k}>{inline(t)}</li>);
      blocks.push(ordered ? <ol key={blocks.length}>{children}</ol> : <ul key={blocks.length}>{children}</ul>);
    } else if (line.trim() === "") {
      i += 1;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("```") && !/^#{1,4}\s/u.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s/u.test(lines[i]) && !isRow(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={blocks.length}>{para.map((t, k) => <Fragment key={k}>{k > 0 && <br />}{inline(t)}</Fragment>)}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}
