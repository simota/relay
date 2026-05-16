export function formatDuration(startIso: string, endIso: string): string {
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
  const sec = Math.floor((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function formatRelative(t: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function shortTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso || "—";
  const d = new Date(t);
  return d.toLocaleTimeString();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function truncatePath(p: string, max: number): string {
  if (p.length <= max) return p;
  return "…" + p.slice(p.length - max + 1);
}

// Stable identity for a session message across SSE snapshots. timestamp alone
// would collide for tool/assistant turns issued in the same second, so we mix
// in the role and a text-prefix fingerprint. If a row's text mutates (e.g.
// streaming append, ingest replay), the key changes and the row is treated as
// "fresh" — which is the behavior we want for the highlight pass.
export function messageKey(m: { timestamp: string; role: string; text: string }): string {
  return `${m.timestamp}|${m.role}|${m.text.length}|${m.text.slice(0, 64)}`;
}
