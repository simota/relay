import type { SessionMessage, SessionStatus, SessionToolCall } from "@/lib/api";

export type RibbonState = "active" | "idle" | "waiting_for_user" | "interrupted" | "ended";

export interface RibbonBucket {
  start: number;
  end: number;
  state: RibbonState;
  /** Number of events (messages + tool_calls) that landed in this bucket. */
  count: number;
}

export interface RibbonOptions {
  bucketCount: number;
  status?: SessionStatus;
  now?: number;
  startedAt?: string;
  lastActive?: string;
}

function tsMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Heuristic timeline of session lifecycle states across `bucketCount`
 * equal-width buckets.
 *
 * Rules (deliberately simple — there is no persisted state history):
 *   - Any bucket containing at least one message or tool call is `active`.
 *   - All other buckets default to `idle`.
 *   - The trailing bucket inherits `options.status` so the ribbon ends on
 *     the live state (waiting / interrupted / ended / active / idle).
 *
 * Returns `[]` when the timeline collapses (start === end) or no events
 * are present at all.
 */
export function computeRibbonBuckets(
  messages: SessionMessage[],
  toolCalls: SessionToolCall[],
  options: RibbonOptions,
): RibbonBucket[] {
  const bucketCount = Math.max(0, Math.floor(options.bucketCount));
  if (bucketCount < 1) return [];

  const stamps: number[] = [];
  for (const m of messages) {
    const t = tsMs(m.timestamp);
    if (t !== undefined) stamps.push(t);
  }
  for (const tc of toolCalls) {
    const t = tsMs(tc.timestamp);
    if (t !== undefined) stamps.push(t);
  }

  let start = tsMs(options.startedAt);
  let end = tsMs(options.lastActive);
  if (start === undefined && stamps.length > 0) start = Math.min(...stamps);
  if (end === undefined) {
    if (stamps.length > 0) end = Math.max(...stamps);
    else end = options.now ?? Date.now();
  }
  if (start === undefined) return [];
  if (end <= start) return [];

  const span = end - start;
  const step = span / bucketCount;
  const buckets: RibbonBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      start: start + step * i,
      end: start + step * (i + 1),
      state: "idle",
      count: 0,
    });
  }

  for (const t of stamps) {
    if (t < start || t > end) continue;
    let idx = Math.floor((t - start) / step);
    if (idx >= bucketCount) idx = bucketCount - 1;
    if (idx < 0) idx = 0;
    const b = buckets[idx];
    if (b) {
      b.count++;
      b.state = "active";
    }
  }

  const last = buckets[buckets.length - 1];
  if (last && options.status) {
    last.state = options.status;
  }

  return buckets;
}
