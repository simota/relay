import type { SessionMessage } from "@/lib/api";

export type PulseRange = "1h" | "24h" | "7d";

interface RangeConfig {
  windowMs: number;
  bucketMs: number;
}

const RANGES: Record<PulseRange, RangeConfig> = {
  "1h": { windowMs: 60 * 60 * 1000, bucketMs: 60 * 1000 },
  "24h": { windowMs: 24 * 60 * 60 * 1000, bucketMs: 30 * 60 * 1000 },
  "7d": { windowMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 3 * 60 * 60 * 1000 },
};

export interface PulseWindow {
  start: number;
  end: number;
  bucketMs: number;
  bucketCount: number;
}

export function pulseWindowFor(range: PulseRange, now: number): PulseWindow {
  const cfg = RANGES[range];
  const start = now - cfg.windowMs;
  const bucketCount = Math.ceil(cfg.windowMs / cfg.bucketMs);
  return { start, end: now, bucketMs: cfg.bucketMs, bucketCount };
}

// Bucket message timestamps into a fixed-width array sized for the view
// window. Each cell counts messages that fell within [start + i*bucketMs,
// start + (i+1)*bucketMs). Messages outside the window are dropped so
// downstream normalization isn't dragged down by historical bursts.
export function bucketizeMessages(
  messages: readonly SessionMessage[],
  win: PulseWindow,
): number[] {
  const out = new Array(win.bucketCount).fill(0);
  for (const m of messages) {
    const ts = Date.parse(m.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (ts < win.start || ts >= win.end) continue;
    const idx = Math.floor((ts - win.start) / win.bucketMs);
    if (idx >= 0 && idx < out.length) out[idx] += 1;
  }
  return out;
}

// Normalize against a shared cap so visually comparing sessions is honest:
// a session with 100 msgs in a bucket should look 10x taller than one
// with 10. Returns 0..1 per bucket.
export function normalizeBuckets(buckets: number[], sharedMax: number): number[] {
  if (sharedMax <= 0) return buckets.map(() => 0);
  return buckets.map((v) => Math.min(v / sharedMax, 1));
}

export function maxBucket(allBuckets: readonly number[][]): number {
  let m = 0;
  for (const row of allBuckets) {
    for (const v of row) {
      if (v > m) m = v;
    }
  }
  return m;
}

export interface PulseTick {
  position: number;
  label: string;
}

export function pulseTicks(win: PulseWindow, count = 6): PulseTick[] {
  const span = win.end - win.start;
  if (span <= 0) return [];
  const out: PulseTick[] = [];
  for (let i = 0; i <= count; i++) {
    const t = win.start + (span * i) / count;
    out.push({ position: (i / count) * 100, label: formatTick(t, span) });
  }
  return out;
}

function formatTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs <= 2 * 24 * 60 * 60 * 1000) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ---------------------------------------------------------------------------
// Tide chart — per-session user→assistant latency histogram
// ---------------------------------------------------------------------------

// Five buckets in increasing think-time order. Anything ≥ 10min is the last
// stack — long enough that further granularity is just noise.
export const LATENCY_BUCKETS = [
  { key: "<10s", maxMs: 10_000 },
  { key: "<30s", maxMs: 30_000 },
  { key: "<2m", maxMs: 120_000 },
  { key: "<10m", maxMs: 600_000 },
  { key: "≥10m", maxMs: Number.POSITIVE_INFINITY },
] as const;

export type LatencyBucketIndex = 0 | 1 | 2 | 3 | 4;

// Color ramp: green (snappy) → red (deep think). Matched to the bucket
// order so the stack reads left=snappy / right=slow.
export const LATENCY_COLORS = [
  "hsl(140, 55%, 50%)",
  "hsl(85, 60%, 50%)",
  "hsl(45, 70%, 52%)",
  "hsl(20, 75%, 55%)",
  "hsl(0, 70%, 55%)",
] as const;

// Walk messages chronologically and pair each user message with the next
// assistant message. Gap = assistant.ts − user.ts. Pairs whose user message
// pre-dates the window or whose pair is missing are skipped. We only score
// the *response* latency, not assistant→user pauses (those are think-time
// on the human side, not the LLM).
export function bucketizeLatencies(
  messages: readonly SessionMessage[],
  win: PulseWindow,
): number[] {
  const out = new Array(LATENCY_BUCKETS.length).fill(0);
  // Make sure we walk in chronological order regardless of how the source
  // arranged the array.
  const sorted = [...messages].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
  let pendingUserTs: number | null = null;
  for (const m of sorted) {
    const ts = Date.parse(m.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (m.role === "user") {
      pendingUserTs = ts;
      continue;
    }
    if (m.role === "assistant" && pendingUserTs !== null) {
      // Score the pair against the window using the user-side timestamp.
      // Otherwise a multi-minute think on a window edge would jump in/out.
      if (pendingUserTs >= win.start && pendingUserTs < win.end) {
        const gap = Math.max(0, ts - pendingUserTs);
        const idx = latencyBucketIndex(gap);
        out[idx] = (out[idx] ?? 0) + 1;
      }
      pendingUserTs = null;
    }
  }
  return out;
}

export function latencyBucketIndex(gapMs: number): LatencyBucketIndex {
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    const b = LATENCY_BUCKETS[i];
    if (b && gapMs < b.maxMs) return i as LatencyBucketIndex;
  }
  return 4;
}

export function latencyTotal(stack: readonly number[]): number {
  let total = 0;
  for (const v of stack) total += v;
  return total;
}
