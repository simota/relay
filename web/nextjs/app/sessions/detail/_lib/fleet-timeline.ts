import type { SessionStatus, SessionSummary } from "@/lib/api";

export interface FleetRow {
  session: SessionSummary;
  /** 0 = parent or orphan; 1 = subagent under a visible parent in this view. */
  indent: 0 | 1;
}

// Order sessions so each parent is immediately followed by its visible
// subagents. Orphan subagents (parent not in this snapshot) fall to the end
// at the parent indent so they stay visible rather than vanish.
export function buildFleetRows(sessions: readonly SessionSummary[]): FleetRow[] {
  const byId = new Map<string, SessionSummary>();
  for (const s of sessions) byId.set(`${s.type}:${s.id}`, s);

  const parents: SessionSummary[] = [];
  const childrenOf = new Map<string, SessionSummary[]>();
  const orphans: SessionSummary[] = [];

  for (const s of sessions) {
    if (!s.parent_session_id) {
      parents.push(s);
      continue;
    }
    const parentKey = `${s.type}:${s.parent_session_id}`;
    if (!byId.has(parentKey)) {
      orphans.push(s);
      continue;
    }
    const list = childrenOf.get(parentKey) ?? [];
    list.push(s);
    childrenOf.set(parentKey, list);
  }

  parents.sort((a, b) => Date.parse(b.last_active) - Date.parse(a.last_active));

  const out: FleetRow[] = [];
  for (const p of parents) {
    out.push({ session: p, indent: 0 });
    const children = childrenOf.get(`${p.type}:${p.id}`) ?? [];
    children.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    for (const c of children) out.push({ session: c, indent: 1 });
  }
  for (const o of orphans) out.push({ session: o, indent: 0 });
  return out;
}

export function statusColor(status: SessionStatus | undefined): string {
  switch (status) {
    case "active":
      return "var(--color-accent)";
    case "waiting_for_user":
      return "var(--color-warn, #d97706)";
    case "interrupted":
      return "var(--color-danger, #dc2626)";
    case "ended":
      return "var(--color-fg-muted)";
    default:
      return "var(--color-border)";
  }
}

// log1p so a session with thousands of messages doesn't make 50-message
// sessions visually disappear. Floor at 0.35 so empty rows are still faintly
// readable.
export function intensityForMessageCount(count: number): number {
  if (count <= 0) return 0.35;
  const v = Math.log1p(count) / Math.log1p(1000);
  return Math.min(0.35 + v * 0.65, 1);
}

export function sessionKey(s: { type: string; id: string }): string {
  return `${s.type}:${s.id}`;
}
