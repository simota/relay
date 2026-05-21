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
  // ---------------------------------------------------------------------------
  // NEW axes (4-gimmick enhancement)
  // ---------------------------------------------------------------------------
  /**
   * Axis 1 — TODO sticky-note cluster count (0..6).
   * Counts TODO:/FIXME:/XXX:/HACK: tokens in messages from the last 1 h.
   * 0 = nothing to show; 6 = maximum density.
   */
  todoStickyCount: number;
  /**
   * Axis 2 — Monitor live-code lines (0..4 entries, each ≤ 16 chars).
   * Extracted from recent tool_call paths/commands.  Empty array = no PC in room.
   */
  monitorLines: string[];
  /**
   * Axis 3 — Plant growth stage derived from session age.
   * 0 = seedling 🌱, 1 = small 🪴, 2 = grown 🌿, 3 = large 🌳.
   * Overridden by plantsWilted → 🥀 (existing logic).
   */
  plantStage: 0 | 1 | 2 | 3;
  /**
   * Axis 4a — All-nighter flag: session running ≥ 12 h AND no achievement
   * in the last 1 h.  Drives extra late-night mess items.
   */
  allNighter: boolean;
  /**
   * Axis 4b — Recent celebration: a quest/achievement event within the last
   * 10 minutes.  Suppresses the mess layer to show a tidy room.
   */
  recentCelebration: boolean;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const TOOL_WINDOW_MS = 2 * 60 * 1000; // 2 min
const MESS_WINDOW_MS = 5 * 60 * 1000; // 5 min
// Axis 1 — TODO sticky cluster
const TODO_WINDOW_MS = 60 * 60 * 1000; // 1 h
const TODO_CAP = 6;
const TODO_RE = /\b(TODO|FIXME|XXX|HACK):/g;
// Axis 2 — Monitor live-code
const MONITOR_MAX_LINES = 4;
const MONITOR_MAX_CHARS = 16;
const MONITOR_TOOL_WINDOW_MS = 5 * 60 * 1000; // 5 min
// Axis 3 — plant growth thresholds
const PLANT_STAGE_THRESHOLDS = [
  { hours: 48, stage: 3 as const },
  { hours: 12, stage: 2 as const },
  { hours: 2,  stage: 1 as const },
] satisfies ReadonlyArray<{ hours: number; stage: 0 | 1 | 2 | 3 }>;
// Axis 4 — all-nighter / celebration
const ALL_NIGHTER_MS = 12 * 60 * 60 * 1000; // 12 h
const ACHIEVEMENT_QUIET_MS = 60 * 60 * 1000; // 1 h silence from achievement
const CELEBRATION_WINDOW_MS = 10 * 60 * 1000; // 10 min
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

  // Axis 1 — TODO sticky cluster
  const todoStickyCount = computeTodoStickyCount(detail, now);
  // Axis 2 — Monitor live-code
  const monitorLines = extractMonitorLines(detail, now);
  // Axis 3 — Plant growth stage from session age
  const plantStage = computePlantStage(card, now);
  // Axis 4 — All-nighter + celebration
  const allNighter = computeAllNighter(card, events, now);
  const recentCelebration = computeRecentCelebration(events, now);

  return {
    toolProp,
    messLevel,
    plantsWilted,
    errorBoost,
    events,
    whiteboardItems,
    todoStickyCount,
    monitorLines,
    plantStage,
    allNighter,
    recentCelebration,
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

// ---------------------------------------------------------------------------
// Axis 1 — TODO sticky cluster
// ---------------------------------------------------------------------------

/**
 * Count TODO:/FIXME:/XXX:/HACK: tokens in messages from the last `TODO_WINDOW_MS`.
 * Returns a value capped at `TODO_CAP` (6).
 */
function computeTodoStickyCount(
  detail: SessionDetail | undefined,
  now: number,
): number {
  if (!detail) return 0;
  let count = 0;
  for (const m of detail.messages) {
    const ts = Date.parse(m.timestamp);
    if (!Number.isFinite(ts) || now - ts > TODO_WINDOW_MS) continue;
    const matches = m.text.match(TODO_RE);
    if (matches) count += matches.length;
    if (count >= TODO_CAP) return TODO_CAP;
  }
  return Math.min(count, TODO_CAP);
}

// ---------------------------------------------------------------------------
// Axis 2 — Monitor live-code lines
// ---------------------------------------------------------------------------

const MONITOR_TOOLS = new Set([
  "read", "view", "cat",
  "edit", "multiedit", "write", "create",
  "grep", "glob", "find", "search",
  "bash", "shell", "exec",
]);

/**
 * Extract up to `MONITOR_MAX_LINES` lines from recent tool_calls.
 * Each line is a basename / short command, max `MONITOR_MAX_CHARS` chars.
 * Returns an empty array when no suitable calls were found in the window.
 */
function extractMonitorLines(
  detail: SessionDetail | undefined,
  now: number,
): string[] {
  if (!detail) return [];
  const relevant = detail.tool_calls
    .filter((tc) => {
      const ts = Date.parse(tc.timestamp);
      if (!Number.isFinite(ts) || now - ts > MONITOR_TOOL_WINDOW_MS) return false;
      const lower = tc.name.toLowerCase();
      return (
        MONITOR_TOOLS.has(lower) ||
        lower.includes("edit") ||
        lower.includes("write") ||
        lower.includes("bash")
      );
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const tc of relevant) {
    if (lines.length >= MONITOR_MAX_LINES) break;
    const raw = extractMonitorLabel(tc.name, tc.args_summary, tc.args_json);
    if (!raw) continue;
    const label = raw.slice(0, MONITOR_MAX_CHARS);
    if (seen.has(label)) continue;
    seen.add(label);
    lines.push(label);
  }
  return lines;
}

function extractMonitorLabel(
  toolName: string,
  argsSummary: string | null | undefined,
  argsJson: string | null | undefined,
): string | null {
  // Try structured args first
  if (argsJson) {
    try {
      const parsed = JSON.parse(argsJson) as Record<string, unknown>;
      for (const key of ["path", "file_path", "file", "filename", "pattern", "command"]) {
        const v = parsed[key];
        if (typeof v === "string" && v.length > 0) {
          return basename(v);
        }
      }
    } catch {
      // ignore
    }
  }
  if (argsSummary) {
    const pathMatch = argsSummary.match(/(\/[\w./\-_]+|[\w./\-_]+\/[\w./\-_]+)/);
    if (pathMatch?.[1]) return basename(pathMatch[1]);
    // Use first meaningful word
    const word = argsSummary.trim().split(/\s+/)[0];
    if (word && word.length > 0) return word.slice(0, MONITOR_MAX_CHARS);
  }
  return toolName.slice(0, MONITOR_MAX_CHARS);
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? p).slice(0, MONITOR_MAX_CHARS);
}

// ---------------------------------------------------------------------------
// Axis 3 — Plant growth stage
// ---------------------------------------------------------------------------

/**
 * Derive plant growth stage from session age (card.bornAt → now).
 *  0 = 🌱 seedling  (0–2 h)
 *  1 = 🪴 small     (2–12 h)
 *  2 = 🌿 grown     (12–48 h)
 *  3 = 🌳 large     (48 h+)
 */
export function computePlantStage(
  card: SimCardModel,
  now: number,
): 0 | 1 | 2 | 3 {
  const ageMs = Math.max(0, now - card.bornAt);
  const ageH = ageMs / 3_600_000;
  for (const { hours, stage } of PLANT_STAGE_THRESHOLDS) {
    if (ageH >= hours) return stage;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Axis 4 — All-nighter + recent celebration
// ---------------------------------------------------------------------------

/**
 * Session is considered "all-nighter" when:
 *   - age ≥ 12 h (ALL_NIGHTER_MS), AND
 *   - no achievement/quest event within the last ACHIEVEMENT_QUIET_MS (1 h)
 */
function computeAllNighter(
  card: SimCardModel,
  events: readonly LifeEvent[],
  now: number,
): boolean {
  const ageMs = Math.max(0, now - card.bornAt);
  if (ageMs < ALL_NIGHTER_MS) return false;
  // Suppress if a celebration happened recently
  const recentAchievement = events.some((ev) => {
    const isCelebration = ev.kind === "achievement" || ev.kind === "quest";
    return isCelebration && now - ev.timestamp < ACHIEVEMENT_QUIET_MS;
  });
  return !recentAchievement;
}

/**
 * Returns true when a quest or achievement event occurred within the last
 * CELEBRATION_WINDOW_MS (10 min).  Triggers "tidy room" visual.
 */
function computeRecentCelebration(
  events: readonly LifeEvent[],
  now: number,
): boolean {
  return events.some(
    (ev) =>
      (ev.kind === "achievement" || ev.kind === "quest") &&
      now - ev.timestamp < CELEBRATION_WINDOW_MS,
  );
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
