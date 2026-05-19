import type { SessionStatus, SessionSummary } from "@/lib/api";

// Buckets we display in the donut/KPI band. "unknown" catches sessions whose
// adapter (currently codex/gemini) doesn't compute a status yet.
export type FlockStatusBucket =
  | "active"
  | "waiting_for_user"
  | "idle"
  | "interrupted"
  | "ended"
  | "unknown";

export const FLOCK_BUCKET_ORDER: FlockStatusBucket[] = [
  "active",
  "waiting_for_user",
  "idle",
  "interrupted",
  "ended",
  "unknown",
];

export interface FlockSummary {
  total: number;
  active: number;
  waiting: number;
  stale: number;
  byStatus: Record<FlockStatusBucket, number>;
}

function bucketFor(status: SessionStatus | undefined): FlockStatusBucket {
  if (!status) return "unknown";
  return status as FlockStatusBucket;
}

function parseMs(iso: string | undefined): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Stale = `last_active` older than `now - thresholdMs`, excluding sessions
 * that have already reached a terminal state (ended/interrupted) — those are
 * "done", not "stuck".
 */
export function isStale(
  child: SessionSummary,
  thresholdMs: number,
  now: number,
): boolean {
  if (child.status === "ended" || child.status === "interrupted") return false;
  const last = parseMs(child.last_active);
  if (last <= 0) return false;
  return now - last >= thresholdMs;
}

export function computeFlockSummary(
  children: SessionSummary[],
  thresholdMs: number,
  now: number,
): FlockSummary {
  const byStatus: Record<FlockStatusBucket, number> = {
    active: 0,
    waiting_for_user: 0,
    idle: 0,
    interrupted: 0,
    ended: 0,
    unknown: 0,
  };
  let stale = 0;
  for (const c of children) {
    byStatus[bucketFor(c.status)] += 1;
    if (isStale(c, thresholdMs, now)) stale += 1;
  }
  return {
    total: children.length,
    active: byStatus.active,
    waiting: byStatus.waiting_for_user,
    stale,
    byStatus,
  };
}

export function computeStaleSubagents(
  children: SessionSummary[],
  thresholdMs: number,
  now: number,
): SessionSummary[] {
  const out: SessionSummary[] = [];
  for (const c of children) if (isStale(c, thresholdMs, now)) out.push(c);
  out.sort((a, b) => parseMs(a.last_active) - parseMs(b.last_active));
  return out;
}

export interface FlockTimeRange {
  startMs: number;
  endMs: number;
}

/** Earliest started_at / latest last_active across the flock. */
export function computeFlockTimeRange(
  children: SessionSummary[],
): FlockTimeRange | null {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const c of children) {
    const s = parseMs(c.started_at);
    const e = parseMs(c.last_active);
    if (s > 0 && s < start) start = s;
    if (e > end) end = e;
    if (s > end) end = s;
  }
  if (!Number.isFinite(start) || end <= 0) return null;
  if (end <= start) end = start + 1;
  return { startMs: start, endMs: end };
}

export interface FlockLane {
  child: SessionSummary;
  startMs: number;
  endMs: number;
  /** Normalized 0..1 horizontal placement of the bar. */
  x0: number;
  x1: number;
}

/** Build per-child Gantt lanes, sorted by started_at ascending. */
export function computeFlockLanes(
  children: SessionSummary[],
  range: FlockTimeRange,
): FlockLane[] {
  const span = Math.max(1, range.endMs - range.startMs);
  const lanes: FlockLane[] = children.map((child) => {
    const s = parseMs(child.started_at);
    const e = parseMs(child.last_active);
    const startMs = s > 0 ? s : range.startMs;
    const endMs = e >= startMs ? e : startMs;
    return {
      child,
      startMs,
      endMs,
      x0: (startMs - range.startMs) / span,
      x1: Math.max((startMs - range.startMs) / span, (endMs - range.startMs) / span),
    };
  });
  lanes.sort((a, b) => a.startMs - b.startMs);
  return lanes;
}

export const STALE_THRESHOLD_OPTIONS: { label: string; ms: number }[] = [
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 5 * 60_000 },
  { label: "15m", ms: 15 * 60_000 },
  { label: "30m", ms: 30 * 60_000 },
];

export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
