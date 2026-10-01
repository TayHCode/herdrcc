const HUES = [212, 262, 162, 32, 336, 190, 90, 12];

export function initials(name: string): string {
  const parts = name.replace(/[_-]+/gu, " ").trim().split(/\s+/u);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[1][0] : parts[0]?.[1] ?? "")).toUpperCase();
}

export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length];
  return (
    <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 40% 24%)`, color: `hsl(${hue} 70% 80%)` }}>
      {initials(name)}
    </span>
  );
}
