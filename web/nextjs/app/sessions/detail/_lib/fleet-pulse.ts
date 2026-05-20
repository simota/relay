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
