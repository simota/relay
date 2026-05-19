import type { SessionMessage, SessionStatus } from "@/lib/api";

export interface CadenceBucket {
  /** Bucket start (epoch ms). */
  start: number;
  /** Bucket end exclusive (epoch ms). */
  end: number;
  /** Number of messages whose timestamp falls in [start, end). */
  count: number;
  /**
   * True only for the final bucket when the session is currently waiting
   * for user — used by the heatmap to recolor that cell as a "waiting"
   * marker instead of a plain activity cell.
   */
  isWaiting: boolean;
}

export interface CadenceOptions {
  bucketCount: number;
  status?: SessionStatus;
  /** Override "now" for tests; defaults to Date.now(). */
  now?: number;
  /** Session started_at ISO; falls back to the earliest message timestamp. */
  startedAt?: string;
  /** Session last_active ISO; falls back to `now` or latest message. */
  lastActive?: string;
}

// Parse an ISO timestamp into ms, returning NaN-safe undefined.
function tsMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Bucket messages by timestamp across the session timeline.
 *
 * The timeline runs from `startedAt` (or the earliest message timestamp)
 * to `lastActive` (or the latest message / `now`), split into
 * `bucketCount` equal-width buckets. Each bucket records the count of
 * messages whose timestamp lies in `[start, end)`; the final bucket also
 * receives `[end, end]` to include the boundary value.
 *
 * Returns `[]` when the timeline collapses to zero width (start === end)
 * or when bucketCount < 1.
 */
export function computeCadenceBuckets(
  messages: SessionMessage[],
  options: CadenceOptions,
): CadenceBucket[] {
  const bucketCount = Math.max(0, Math.floor(options.bucketCount));
  if (bucketCount < 1) return [];

  // Collect parsed message timestamps once so we can both derive a range
  // and count without re-parsing inside the bucket loop.
  const stamps: number[] = [];
  for (const m of messages) {
    const t = tsMs(m.timestamp);
    if (t !== undefined) stamps.push(t);
  }

  let start = tsMs(options.startedAt);
  let end = tsMs(options.lastActive);
  if (start === undefined && stamps.length > 0) {
    start = Math.min(...stamps);
  }
  if (end === undefined) {
    if (stamps.length > 0) end = Math.max(...stamps);
    else end = options.now ?? Date.now();
  }
  if (start === undefined) return [];
  if (end <= start) return [];

  const span = end - start;
  const step = span / bucketCount;
  const buckets: CadenceBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      start: start + step * i,
      end: start + step * (i + 1),
      count: 0,
      isWaiting: false,
    });
  }

  for (const t of stamps) {
    if (t < start || t > end) continue;
    let idx = Math.floor((t - start) / step);
    if (idx >= bucketCount) idx = bucketCount - 1;
    if (idx < 0) idx = 0;
    const b = buckets[idx];
    if (b) b.count++;
  }

  if (options.status === "waiting_for_user") {
    const last = buckets[buckets.length - 1];
    if (last) last.isWaiting = true;
  }

  return buckets;
}
