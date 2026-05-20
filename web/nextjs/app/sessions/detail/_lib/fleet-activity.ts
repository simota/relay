import type { SessionDetail, SessionStatus, SessionSummary } from "@/lib/api";

export type FleetEventKind =
  | "user"
  | "assistant"
  | "tool"
  | "system"
  | "message"
  | "waiting"
  | "ended"
  | "spawn"
  | "interrupted";

export interface FleetEvent {
  ts: number;
  sessionType: SessionSummary["type"];
  sessionId: string;
  repo: string | null;
  status: SessionStatus | undefined;
  parentSessionId?: string;
  agentId?: string;
  /** Short, human-readable summary line. */
  summary: string;
  /** kind drives the row icon and color accent. */
  kind: FleetEventKind;
}

// Derive a synthetic event stream from the lightweight /api/sessions
// snapshot. We don't have per-message timestamps here, so each session
// contributes one event at `last_active` describing its latest known
// state. Spawn relationships add an extra event under the parent's
// started_at so subagent appearance is visible in the feed.
export function buildActivityEvents(
  sessions: readonly SessionSummary[],
): FleetEvent[] {
  const events: FleetEvent[] = [];

  for (const s of sessions) {
    const ts = Date.parse(s.last_active);
    if (!Number.isFinite(ts)) continue;

    const kind = kindFor(s.status);
    events.push({
      ts,
      sessionType: s.type,
      sessionId: s.id,
      repo: s.repo,
      status: s.status,
      parentSessionId: s.parent_session_id,
      agentId: s.agent_id,
      kind,
      summary: summaryFor(s, kind),
    });

    if (s.parent_session_id && s.agent_id) {
      const spawnTs = Date.parse(s.started_at);
      if (Number.isFinite(spawnTs)) {
        events.push({
          ts: spawnTs,
          sessionType: s.type,
          sessionId: s.id,
          repo: s.repo,
          status: s.status,
          parentSessionId: s.parent_session_id,
          agentId: s.agent_id,
          kind: "spawn",
          summary: `subagent spawned: ${s.agent_id}`,
        });
      }
    }
  }

  events.sort((a, b) => b.ts - a.ts);
  return events;
}

function kindFor(status: SessionStatus | undefined): FleetEvent["kind"] {
  switch (status) {
    case "waiting_for_user":
      return "waiting";
    case "ended":
      return "ended";
    case "interrupted":
      return "interrupted";
    default:
      return "message";
  }
}

function summaryFor(s: SessionSummary, kind: FleetEvent["kind"]): string {
  if (s.last_message && s.last_message.trim().length > 0) return s.last_message;
  switch (kind) {
    case "waiting":
      return "waiting for user input";
    case "ended":
      return "session ended";
    case "interrupted":
      return "session interrupted";
    case "spawn":
      return "subagent spawn";
    default:
      return s.title || "(no prompt)";
  }
}

const PREVIEW_MAX = 400;

// Build the per-message activity feed. When detail is available for a
// session we emit one event per message (user / assistant / tool / system)
// plus one per tool_call so the history reads chronologically. When detail
// has not arrived yet we fall back to the lightweight one-event-per-session
// shape so the feed never blanks during a refetch.
export function buildDetailEvents(
  sessions: readonly SessionSummary[],
  detailByKey: ReadonlyMap<string, SessionDetail>,
): FleetEvent[] {
  const events: FleetEvent[] = [];

  for (const s of sessions) {
    const key = `${s.type}:${s.id}`;
    const detail = detailByKey.get(key);

    if (!detail) {
      const ts = Date.parse(s.last_active);
      if (!Number.isFinite(ts)) continue;
      const kind = kindFor(s.status);
      events.push({
        ts,
        sessionType: s.type,
        sessionId: s.id,
        repo: s.repo,
        status: s.status,
        parentSessionId: s.parent_session_id,
        agentId: s.agent_id,
        kind,
        summary: summaryFor(s, kind),
      });
      continue;
    }

    for (const m of detail.messages) {
      const ts = Date.parse(m.timestamp);
      if (!Number.isFinite(ts)) continue;
      events.push({
        ts,
        sessionType: s.type,
        sessionId: s.id,
        repo: s.repo,
        status: s.status,
        parentSessionId: s.parent_session_id,
        agentId: s.agent_id,
        kind: messageRoleToKind(m.role),
        summary: truncate(firstNonEmptyLine(m.text), PREVIEW_MAX),
      });
    }

    for (const tc of detail.tool_calls) {
      const ts = Date.parse(tc.timestamp);
      if (!Number.isFinite(ts)) continue;
      const argsSummary = tc.args_summary.trim();
      events.push({
        ts,
        sessionType: s.type,
        sessionId: s.id,
        repo: s.repo,
        status: s.status,
        parentSessionId: s.parent_session_id,
        agentId: s.agent_id,
        kind: "tool",
        summary: argsSummary.length > 0 ? `${tc.name} · ${argsSummary}` : tc.name,
      });
    }

    if (s.parent_session_id && s.agent_id) {
      const spawnTs = Date.parse(s.started_at);
      if (Number.isFinite(spawnTs)) {
        events.push({
          ts: spawnTs,
          sessionType: s.type,
          sessionId: s.id,
          repo: s.repo,
          status: s.status,
          parentSessionId: s.parent_session_id,
          agentId: s.agent_id,
          kind: "spawn",
          summary: `subagent spawned: ${s.agent_id}`,
        });
      }
    }
  }

  events.sort((a, b) => b.ts - a.ts);
  return events;
}

function messageRoleToKind(role: string): FleetEventKind {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "tool":
      return "tool";
    case "system":
      return "system";
    default:
      return "message";
  }
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Feed-row helpers (timeline rendering)
// ---------------------------------------------------------------------------

// Two adjacent tool events from the same session collapse into a single
// "burst" group when they land within this gap. 8s captures typical
// Read / Read / Read / Bash bursts that otherwise dominate the feed.
const TOOL_BURST_GAP_MS = 8_000;

export type FeedRow =
  | {
      kind: "event";
      ts: number;
      sessionType: FleetEvent["sessionType"];
      sessionId: string;
      event: FleetEvent;
    }
  | {
      kind: "tool-group";
      ts: number;
      sessionType: FleetEvent["sessionType"];
      sessionId: string;
      repo: string | null;
      status: SessionStatus | undefined;
      agentId?: string;
      tools: FleetEvent[];
      spanMs: number;
    };

export function buildFeedRows(events: readonly FleetEvent[]): FeedRow[] {
  // Group in ascending time then flip back so adjacent events are processed
  // in real chronological order. Cheaper than maintaining two passes.
  const asc = [...events].sort((a, b) => a.ts - b.ts);
  const rows: FeedRow[] = [];

  let i = 0;
  while (i < asc.length) {
    const ev = asc[i];
    if (!ev) {
      i++;
      continue;
    }
    if (ev.kind !== "tool") {
      rows.push({
        kind: "event",
        ts: ev.ts,
        sessionType: ev.sessionType,
        sessionId: ev.sessionId,
        event: ev,
      });
      i++;
      continue;
    }

    const group: FleetEvent[] = [ev];
    let j = i + 1;
    while (j < asc.length) {
      const nx = asc[j];
      if (!nx) break;
      if (nx.kind !== "tool") break;
      if (
        nx.sessionType !== ev.sessionType ||
        nx.sessionId !== ev.sessionId
      ) {
        break;
      }
      const prev = group[group.length - 1];
      if (!prev) break;
      if (nx.ts - prev.ts > TOOL_BURST_GAP_MS) break;
      group.push(nx);
      j++;
    }

    if (group.length === 1) {
      rows.push({
        kind: "event",
        ts: ev.ts,
        sessionType: ev.sessionType,
        sessionId: ev.sessionId,
        event: ev,
      });
    } else {
      const first = group[0];
      const last = group[group.length - 1];
      if (!first || !last) {
        i = j;
        continue;
      }
      rows.push({
        kind: "tool-group",
        ts: last.ts,
        sessionType: ev.sessionType,
        sessionId: ev.sessionId,
        repo: ev.repo,
        status: ev.status,
        agentId: ev.agentId,
        tools: group,
        spanMs: last.ts - first.ts,
      });
    }
    i = j;
  }

  rows.sort((a, b) => b.ts - a.ts);
  return rows;
}

// Hue rotation shared between Feed and Cosmos so the same session lights up
// with the same color across views (mnemonic continuity).
const HUE_STEP = 47.5;

export function buildHueMap(
  sessions: readonly SessionSummary[],
): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = [...sessions].sort((a, b) =>
    `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`),
  );
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (!s) continue;
    out.set(`${s.type}:${s.id}`, (i * HUE_STEP) % 360);
  }
  return out;
}

export function hueForSession(
  hueMap: ReadonlyMap<string, number>,
  sessionType: string,
  sessionId: string,
): number {
  return hueMap.get(`${sessionType}:${sessionId}`) ?? 0;
}

export function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 45_000) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

// ---------------------------------------------------------------------------
// Sonar — per-session silence detection
// ---------------------------------------------------------------------------

export interface SonarEntry {
  key: string;
  sessionType: FleetEvent["sessionType"];
  sessionId: string;
  repo: string | null;
  agentId?: string;
  status: SessionStatus | undefined;
  /** ms since the most recent event for this session. */
  silenceMs: number;
  /** "ended" sessions are excluded from the stalled check by callers. */
  isEnded: boolean;
}

// Pull the latest event timestamp per session from the merged feed. Used by
// the Sonar strip to render a silence bar per session without re-scanning
// SessionDetail. `events` is expected to be the same merged stream the feed
// renders (newest-first).
export function buildSonarEntries(
  events: readonly FleetEvent[],
  now: number,
): SonarEntry[] {
  const latestByKey = new Map<string, FleetEvent>();
  for (const e of events) {
    const key = `${e.sessionType}:${e.sessionId}`;
    const existing = latestByKey.get(key);
    if (!existing || e.ts > existing.ts) latestByKey.set(key, e);
  }
  const out: SonarEntry[] = [];
  for (const [key, e] of latestByKey) {
    out.push({
      key,
      sessionType: e.sessionType,
      sessionId: e.sessionId,
      repo: e.repo,
      agentId: e.agentId,
      status: e.status,
      silenceMs: Math.max(0, now - e.ts),
      isEnded: e.status === "ended",
    });
  }
  // Longest silence first so the eye lands on the most-stalled session.
  out.sort((a, b) => b.silenceMs - a.silenceMs);
  return out;
}

// Median of active (non-ended) silences. We use median × 3 as the stalled
// threshold so a single quiet artifact doesn't drag the cutoff up. Returns
// 0 when no active sessions are eligible.
export function silenceMedian(entries: readonly SonarEntry[]): number {
  const active = entries.filter((e) => !e.isEnded).map((e) => e.silenceMs);
  if (active.length === 0) return 0;
  active.sort((a, b) => a - b);
  const mid = Math.floor(active.length / 2);
  if (active.length % 2 === 1) return active[mid] ?? 0;
  return ((active[mid - 1] ?? 0) + (active[mid] ?? 0)) / 2;
}

export function formatSilence(ms: number): string {
  if (ms < 1000) return "0s";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return s > 0 && m < 10 ? `${m}m${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m > 0 && h < 10 ? `${h}h${m}m` : `${h}h`;
}

// Calendar-day bucket key (YYYY-MM-DD in local time). Used to insert
// day-separator headers in the feed.
export function dateBucketKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function dateBucketLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const startOfDay = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const eventDay = startOfDay(ts);
  if (eventDay === today) return "Today";
  if (eventDay === yesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
