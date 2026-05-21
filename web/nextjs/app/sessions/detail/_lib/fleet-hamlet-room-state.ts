// Hamlet — Room Scene dynamic state (R1 + R2).
//
// Pure derivers that turn a SessionDetail + SimCardModel + neighborhood
// context into the four dynamic axes the room can reflect:
//
//   A1 Tool Prop      — `toolProp` (book / monitor / magnifier / …) based on
//                       the most recent tool call within a short window.
//   B1 Mess Level     — `messLevel` 0..3 + `plantsWilted` + `errorBoost`
//                       reflecting activity volume + idle / error spikes.
//   B2 Whiteboard     — `whiteboardItems` extracted from the latest
//                       assistant message (TodoWrite-style bullets).
//   D1 Event Decor    — `events` = subset of detectEvents() restricted to
//                       the last hour and capped to 3 by severity.
//
// All shapes are deterministic given (card, detail, allCards, now) so the
// React side never needs to memoize internals — `deriveRoomState` is a
// single O(messages + tool_calls + allCards.filter) pass and safe to call
// per render.

import type { SessionDetail } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";
import {
  detectEvents,
  severityWeight,
  type EventKind,
  type LifeEvent,
} from "./fleet-hamlet-events";
import { extractActionQueue } from "./fleet-hamlet-house";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ToolPropKind =
  | "book"
  | "monitor"
  | "magnifier"
  | "terminal"
  | "telescope"
  | "staff"
  | "pen";

export interface WhiteboardItem {
  text: string;
  done: boolean;
}

export interface RoomState {
  /** Most recent tool category — null when no tool ran in the window. */
  toolProp: ToolPropKind | null;
  /** Activity volume bucket 0..3. */
  messLevel: 0 | 1 | 2 | 3;
  /** When true the existing 🪴 placeholders should render as 🥀. */
  plantsWilted: boolean;
  /** True when the tool-error ratio pushed messLevel up (drives knocked chair). */
  errorBoost: boolean;
  /** Up to 3 events, sorted by severity then recency, all ≤ 1h old. */
  events: LifeEvent[];
  /** Up to 4 whiteboard items, each ≤ 30 chars. Empty when nothing extractable. */
  whiteboardItems: WhiteboardItem[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const TOOL_WINDOW_MS = 2 * 60 * 1000; // 2 min
const MESS_WINDOW_MS = 5 * 60 * 1000; // 5 min
const MESS_PER_MIN_THRESHOLDS: ReadonlyArray<{ rate: number; level: 0 | 1 | 2 | 3 }> = [
  { rate: 5.0, level: 3 },
  { rate: 2.0, level: 2 },
  { rate: 0.5, level: 1 },
];
const PLANT_WILT_MS = 60 * 60 * 1000; // 1h silence → plants wilt
const EVENT_TTL_MS = 60 * 60 * 1000; // events stay decorative for 1h
const ERROR_BOOST_RATIO = 0.3;
const WHITEBOARD_MAX = 4;
const WHITEBOARD_TRUNC = 30;

const TOOL_PROP_PATTERNS: ReadonlyArray<{ re: RegExp; kind: ToolPropKind }> = [
  { re: /^(read|view|cat)\b/i, kind: "book" },
  { re: /^(edit|multiedit|write|notebook)\b/i, kind: "monitor" },
  { re: /^(grep|glob|find|search)\b/i, kind: "magnifier" },
  { re: /^(bash|shell|exec)\b/i, kind: "terminal" },
  { re: /^(web|fetch|curl|http)/i, kind: "telescope" },
  { re: /^(task|agent|spawn)/i, kind: "staff" },
];

const TOOL_ERROR_RE = /\b(error|failed|exception|traceback)\b/i;

// ---------------------------------------------------------------------------
// Public — top-level derivation
// ---------------------------------------------------------------------------

export function deriveRoomState(
  card: SimCardModel,
  detail: SessionDetail | undefined,
  allCards: readonly SimCardModel[],
  now: number,
): RoomState {
  const toolProp = getRecentToolKind(detail, now);
  const messRaw = computeMessLevel(detail, now);
  const errorBoost = recentErrorRatio(detail, now) >= ERROR_BOOST_RATIO;
  const messLevel = clampLevel(
    (messRaw + (errorBoost ? 1 : 0)) as number,
  );
  const silenceMs = Math.max(0, now - card.lastActiveAt);
  const plantsWilted = silenceMs >= PLANT_WILT_MS;
  const events = getActiveRoomEvents(card, detail, allCards, now);
  const whiteboardItems = extractWhiteboardItems(detail);

  return {
    toolProp,
    messLevel,
    plantsWilted,
    errorBoost,
    events,
    whiteboardItems,
  };
}

// ---------------------------------------------------------------------------
// A1 — Tool Prop
// ---------------------------------------------------------------------------

export function getRecentToolKind(
  detail: SessionDetail | undefined,
  now: number,
  windowMs: number = TOOL_WINDOW_MS,
): ToolPropKind | null {
  if (!detail || detail.tool_calls.length === 0) return null;
  let latestTs = -Infinity;
  let latestName: string | null = null;
  for (const tc of detail.tool_calls) {
    const ts = Date.parse(tc.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (now - ts > windowMs) continue;
    if (ts > latestTs) {
      latestTs = ts;
      latestName = tc.name;
    }
  }
  if (!latestName) return null;
  for (const pat of TOOL_PROP_PATTERNS) {
    if (pat.re.test(latestName)) return pat.kind;
  }
  return "pen";
}

// ---------------------------------------------------------------------------
// B1 — Mess Level
// ---------------------------------------------------------------------------

export function computeMessLevel(
  detail: SessionDetail | undefined,
  now: number,
  windowMs: number = MESS_WINDOW_MS,
): 0 | 1 | 2 | 3 {
  if (!detail) return 0;
  const windowMin = windowMs / 60_000;
  let count = 0;
  for (const m of detail.messages) {
    const ts = Date.parse(m.timestamp);
    if (Number.isFinite(ts) && now - ts <= windowMs) count += 1;
  }
  for (const tc of detail.tool_calls) {
    const ts = Date.parse(tc.timestamp);
    if (Number.isFinite(ts) && now - ts <= windowMs) count += 1;
  }
  const rate = count / windowMin;
  for (const t of MESS_PER_MIN_THRESHOLDS) {
    if (rate >= t.rate) return t.level;
  }
  return 0;
}

function recentErrorRatio(
  detail: SessionDetail | undefined,
  now: number,
  windowMs: number = MESS_WINDOW_MS,
): number {
  if (!detail || detail.tool_calls.length === 0) return 0;
  let total = 0;
  let errors = 0;
  for (const tc of detail.tool_calls) {
    const ts = Date.parse(tc.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (now - ts > windowMs) continue;
    total += 1;
    if (tc.args_summary && TOOL_ERROR_RE.test(tc.args_summary)) errors += 1;
  }
  if (total < 3) return 0;
  return errors / total;
}

function clampLevel(n: number): 0 | 1 | 2 | 3 {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// B2 — Whiteboard
// ---------------------------------------------------------------------------

export function extractWhiteboardItems(
  detail: SessionDetail | undefined,
): WhiteboardItem[] {
  if (!detail) return [];
  // Prefer the structured TodoWrite-style extraction so we share semantics
  // with the House Plan action queue. `extractActionQueue` returns the raw
  // text without the [ ] / [x] prefix though, so we need a second pass on
  // the source message to recover the done state.
  const raw = extractActionQueue(detail, WHITEBOARD_MAX);
  if (raw && raw.length > 0) {
    const doneMap = collectDoneFlags(detail);
    return raw.slice(0, WHITEBOARD_MAX).map((text) => ({
      text: truncate(text, WHITEBOARD_TRUNC),
      done: doneMap.get(text.trim()) ?? false,
    }));
  }
  return [];
}

function collectDoneFlags(detail: SessionDetail): Map<string, boolean> {
  const map = new Map<string, boolean>();
  const assistant = [...detail.messages]
    .filter((m) => m.role === "assistant")
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  for (const m of assistant) {
    for (const raw of m.text.split(/\r?\n/)) {
      const line = raw.trim();
      const m1 = line.match(/^[-*]\s+\[\s?([xX ])?\s?\]\s+(.+)$/);
      if (m1) {
        const flag = m1[1];
        const body = m1[2];
        if (body) {
          map.set(body.trim(), flag === "x" || flag === "X");
        }
      }
    }
    if (map.size > 0) return map;
  }
  return map;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

// ---------------------------------------------------------------------------
// D1 — Event Decor
// ---------------------------------------------------------------------------

export function getActiveRoomEvents(
  card: SimCardModel,
  detail: SessionDetail | undefined,
  allCards: readonly SimCardModel[],
  now: number,
  ttlMs: number = EVENT_TTL_MS,
): LifeEvent[] {
  const all = detectEvents(card, detail, allCards, now);
  const fresh = all.filter((ev) => now - ev.timestamp <= ttlMs);
  // Sort by severity (heavier wins) then by recency.
  fresh.sort((a, b) => {
    const w = severityWeight(b.severity) - severityWeight(a.severity);
    if (w !== 0) return w;
    return b.timestamp - a.timestamp;
  });
  const seen = new Set<EventKind>();
  const picked: LifeEvent[] = [];
  for (const ev of fresh) {
    if (seen.has(ev.kind)) continue;
    seen.add(ev.kind);
    picked.push(ev);
    if (picked.length >= 3) break;
  }
  return picked;
}
