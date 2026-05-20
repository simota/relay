import type { SessionDetail, SessionSummary } from "@/lib/api";

export type CosmosEventKind = "user" | "assistant";

export interface MessagePoint {
  key: string;
  sessionKey: string;
  sessionType: SessionSummary["type"];
  position: [number, number, number];
  ts: number;
  kind: CosmosEventKind;
  summary: string;
  sessionRepo: string | null;
  sessionTitle: string;
  /** HSL hue rotated per session so messages from the same session share
   *  a recognizable header color (the only remaining grouping cue). */
  hue: number;
  /** 0.15 (old) → 1.0 (just-arrived). Applied to all card materials so
   *  fresh activity dominates and the back of the room fades quietly. */
  opacity: number;
  /** True when the message landed within FRESH_MS — the renderer pulses
   *  these cards so the eye finds the freshest activity. */
  isFresh: boolean;
}

export interface CosmosWindow {
  /** Wall-clock now used as the Z=ZMAX anchor (newest message at the front). */
  now: number;
  /** How far back messages reach in time (ms). Older → deeper + fainter. */
  windowMs: number;
}

export interface Cosmos {
  points: MessagePoint[];
  win: CosmosWindow;
  bounds: { x: number; y: number; depth: number };
}

const SPACE_X = 44;
const SPACE_Y = 28;
const Z_FRONT = 18;
const Z_BACK = -44;
const MIN_OPACITY = 0.15;
// Anything within this window from now() pulses to draw the eye to the
// freshest activity. 5 min keeps the "live" badge meaningful — long
// enough to catch a glance, short enough that the cosmos isn't covered
// in blinking lights.
const FRESH_MS = 5 * 60 * 1000;

// Fresh messages start at this fraction of the full spread, then slide
// outward to 1.0 as they age past FRESH_MS. 0.35 keeps the newest card
// well within the camera's default framing so it can't drift off-screen.
const CENTER_BIAS = 0.35;

// Build the cosmos as a single integrated stream — every message gets a
// space-wide deterministic X-Y position (no per-session clusters) so the
// whole room fills evenly. Z still maps to age (front = new, back = old)
// and `opacity` mirrors that age so freshly arrived cards visually
// dominate while history fades into the back wall.
export function buildCosmos(
  sessions: readonly SessionSummary[],
  details: ReadonlyMap<string, SessionDetail>,
  win: CosmosWindow,
): Cosmos {
  const orderedSessions = [...sessions].sort((a, b) =>
    sessionKey(a).localeCompare(sessionKey(b)),
  );
  const hueBySession = new Map<string, number>();
  for (let i = 0; i < orderedSessions.length; i++) {
    const s = orderedSessions[i];
    if (s) hueBySession.set(sessionKey(s), (i * 47.5) % 360);
  }

  const points: MessagePoint[] = [];
  for (const s of sessions) {
    const sKey = sessionKey(s);
    const hue = hueBySession.get(sKey) ?? 0;
    const detail = details.get(sKey);
    if (!detail) continue;

    const stream = collectStream(detail);
    for (const item of stream) {
      const seed = hashSeed(`${sKey}:${item.ts}:${item.kind}`);
      // Fresh messages pull toward the center of the room so they can't
      // land off-screen at the edges where the user might miss them.
      // The spread grows linearly with age until FRESH_MS, then settles
      // at the full uniform spread — so a card slides outward gradually
      // rather than teleporting once it stops being "fresh".
      const ageRatio = Math.min(
        1,
        Math.max(0, (win.now - item.ts) / FRESH_MS),
      );
      const spreadFactor = CENTER_BIAS + (1 - CENTER_BIAS) * ageRatio;
      const x = uniformAxis(seed, SPACE_X * spreadFactor);
      const y = uniformAxis(seed * 31 + 7, SPACE_Y * spreadFactor);
      const z = remapTsToZ(item.ts, win);
      points.push({
        key: `${sKey}::${item.kind}::${item.ts}::${item.summary.length}`,
        sessionKey: sKey,
        sessionType: s.type,
        position: [x, y, z],
        ts: item.ts,
        kind: item.kind,
        summary: item.summary,
        sessionRepo: s.repo,
        sessionTitle: s.title,
        hue,
        opacity: computeOpacity(item.ts, win),
        isFresh: win.now - item.ts <= FRESH_MS,
      });
    }
  }

  return {
    points,
    win,
    bounds: { x: SPACE_X, y: SPACE_Y, depth: Z_FRONT - Z_BACK },
  };
}

interface StreamItem {
  ts: number;
  kind: CosmosEventKind;
  summary: string;
}

function collectStream(detail: SessionDetail): StreamItem[] {
  const out: StreamItem[] = [];
  for (const m of detail.messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const ts = Date.parse(m.timestamp);
    if (!Number.isFinite(ts)) continue;
    out.push({
      ts,
      kind: m.role,
      summary: firstLine(m.text, 200),
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function uniformAxis(seed: number, max: number): number {
  // Deterministic uniform in [-max, +max] from a hashed seed so the same
  // message lands in the same cell across renders.
  return (pseudoRandom(seed * 9301 + 49297) - 0.5) * 2 * max;
}

function remapTsToZ(ts: number, win: CosmosWindow): number {
  const age = Math.max(0, win.now - ts);
  const norm = Math.min(1, age / Math.max(win.windowMs, 1));
  return Z_FRONT - norm * (Z_FRONT - Z_BACK);
}

function computeOpacity(ts: number, win: CosmosWindow): number {
  const age = Math.max(0, win.now - ts);
  const norm = Math.min(1, age / Math.max(win.windowMs, 1));
  return Math.max(MIN_OPACITY, 1 - norm * (1 - MIN_OPACITY));
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100000;
}

function firstLine(s: string, max: number): string {
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }
  return "";
}

export function sessionKey(s: { type: string; id: string }): string {
  return `${s.type}:${s.id}`;
}

export function hslColor(hue: number, sat = 80, light = 65): string {
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

