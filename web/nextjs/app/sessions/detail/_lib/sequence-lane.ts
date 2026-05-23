import type {
  SessionMessage,
  SessionSkillUse,
  SessionStatus,
  SessionToolCall,
} from "@/lib/api";
import { messageKey } from "./format";

export type LaneId = "user" | "assistant" | "tool" | "subagent" | "skill";

export interface LaneEvent {
  lane: LaneId;
  ts: number;
  /** Stable identity used for jump-to-message / jump-to-tool. */
  key: string;
  /** Short preview for the SVG <title>. */
  preview: string;
  /** Full one-line preview for hover detail panel. */
  rawPreview: string;
  /** Tool name when lane is `tool`/`subagent`; null otherwise. */
  toolName: string | null;
  /** Tool args summary (full, non-truncated). */
  toolArgs: string | null;
}

export interface LaneArrow {
  from: number;
  to: number;
  /** Milliseconds between the two events; convenience field for label/tooltip. */
  dtMs: number;
}

export interface LaneChain {
  laneStart: number;
  laneEnd: number;
  count: number;
}

export interface LaneBand {
  lane: LaneId;
  start: number;
  end: number;
  count: number;
  /** Index of the band's first event in the source events array. */
  firstIdx: number;
}

export interface WaitingRange {
  start: number;
  end: number;
}

export interface SequenceLaneModel {
  /** Lanes in render order from top to bottom; lanes with no events removed. */
  lanes: LaneId[];
  events: LaneEvent[];
  arrows: LaneArrow[];
  waitingRanges: WaitingRange[];
  start: number;
  end: number;
}

export interface SequenceLaneOptions {
  status?: SessionStatus;
  startedAt?: string;
  lastActive?: string;
  now?: number;
  maxArrows?: number;
  /**
   * Optional skill invocation events to render on the dedicated `skill`
   * lane. When provided, any tool_call that would otherwise land on the
   * `tool` lane but is actually a Skill invocation is also displaced to
   * the skill lane (so it isn't double-counted).
   */
  skillEvents?: ReadonlyArray<{
    ts: string;
    name: string;
    source: "skill_tool" | "slash_command" | "subagent" | "session_meta";
    detail?: string | null;
  }>;
}

const LANE_ORDER: LaneId[] = ["user", "skill", "assistant", "tool", "subagent"];
const DEFAULT_MAX_ARROWS = 200;

function tsMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? undefined : n;
}

function previewText(s: string, max = 100): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

function laneForMessage(role: SessionMessage["role"]): LaneId | null {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "tool") return "tool";
  return null;
}

export function computeSequenceLane(
  messages: SessionMessage[],
  toolCalls: SessionToolCall[],
  options: SequenceLaneOptions = {},
): SequenceLaneModel {
  const maxArrows = options.maxArrows ?? DEFAULT_MAX_ARROWS;

  const events: LaneEvent[] = [];
  for (const m of messages) {
    const ts = tsMs(m.timestamp);
    if (ts === undefined) continue;
    const lane = laneForMessage(m.role);
    if (!lane) continue;
    const oneLine = m.text.replace(/\s+/g, " ").trim();
    events.push({
      lane,
      ts,
      key: messageKey(m),
      preview: previewText(m.text),
      rawPreview: oneLine,
      toolName: null,
      toolArgs: null,
    });
  }
  // Skill tool calls (Claude `Skill`, Codex `spawn_agent`) are double-counted
  // — once here on the `tool` lane and once below on the `skill` lane — so
  // we collapse them by skipping the tool-lane copy when the same ts/name
  // also appears in `options.skillEvents`. Build the dedup set first.
  const skillTsSet = new Set<string>();
  for (const se of options.skillEvents ?? []) {
    if (se.source === "skill_tool" || se.source === "subagent") {
      skillTsSet.add(`${se.ts}|${se.source === "subagent" ? "Agent" : "Skill"}`);
    }
  }

  for (const tc of toolCalls) {
    const ts = tsMs(tc.timestamp);
    if (ts === undefined) continue;
    // Suppress the tool-lane copy of a Skill / spawn_agent / Agent call when
    // it has been promoted to the skill lane below.
    if (
      (tc.name === "Skill" && skillTsSet.has(`${tc.timestamp}|Skill`)) ||
      ((tc.name === "Agent" || tc.name === "Task" || tc.name === "spawn_agent") &&
        skillTsSet.has(`${tc.timestamp}|Agent`))
    ) {
      continue;
    }
    const lane: LaneId = tc.name === "TaskCreate" ? "subagent" : "tool";
    const argsOneLine = tc.args_summary.replace(/\s+/g, " ").trim();
    events.push({
      lane,
      ts,
      key: `tool|${tc.timestamp}|${tc.name}`,
      preview: `${tc.name} ${previewText(tc.args_summary, 80)}`.trim(),
      rawPreview: `${tc.name} ${argsOneLine}`.trim(),
      toolName: tc.name,
      toolArgs: argsOneLine,
    });
  }

  for (const se of options.skillEvents ?? []) {
    const ts = tsMs(se.ts);
    if (ts === undefined) continue;
    const detail = se.detail ?? "";
    events.push({
      lane: "skill",
      ts,
      key: `skill|${se.ts}|${se.source}|${se.name}`,
      preview: `${se.source}:${se.name}${detail ? ` ${previewText(detail, 60)}` : ""}`,
      rawPreview: `${se.source}:${se.name}${detail ? ` ${detail.replace(/\s+/g, " ").trim()}` : ""}`,
      toolName: se.name,
      toolArgs: detail || null,
    });
  }

  events.sort((a, b) => a.ts - b.ts);

  // Build arrows between adjacent events when the transition is one of the
  // patterns we want to highlight; skip same-lane consecutive events.
  const rawArrows: LaneArrow[] = [];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const cur = events[i];
    if (!prev || !cur) continue;
    if (prev.lane === cur.lane) continue;
    const a = prev.lane;
    const b = cur.lane;
    const keep =
      (a === "assistant" && (b === "tool" || b === "subagent" || b === "skill")) ||
      ((a === "tool" || a === "subagent" || a === "skill") && b === "assistant") ||
      (a === "user" && (b === "assistant" || b === "skill")) ||
      (a === "skill" && (b === "assistant" || b === "tool" || b === "subagent")) ||
      (a === "assistant" && b === "user");
    if (!keep) continue;
    rawArrows.push({ from: i - 1, to: i, dtMs: cur.ts - prev.ts });
  }

  // Decimate arrows when there are too many — equal-spaced sampling.
  let arrows = rawArrows;
  if (rawArrows.length > maxArrows) {
    const step = rawArrows.length / maxArrows;
    const decimated: LaneArrow[] = [];
    for (let i = 0; i < maxArrows; i++) {
      const idx = Math.min(rawArrows.length - 1, Math.floor(i * step));
      const a = rawArrows[idx];
      if (a) decimated.push(a);
    }
    arrows = decimated;
  }

  const present = new Set<LaneId>();
  for (const e of events) present.add(e.lane);
  const lanes = LANE_ORDER.filter((l) => present.has(l));

  let start = tsMs(options.startedAt);
  let end = tsMs(options.lastActive);
  if (start === undefined && events.length > 0) start = events[0]?.ts;
  if (end === undefined) {
    if (events.length > 0) end = events[events.length - 1]?.ts;
    else end = options.now ?? Date.now();
  }
  if (start === undefined) start = options.now ?? Date.now();
  if (end === undefined || end <= start) end = start + 1;

  // Waiting range: from the last user/assistant message to `end` when the
  // session is currently waiting on user input. Mirrors the prior timeline
  // behaviour so the warm overlay carries over.
  const waitingRanges: WaitingRange[] = [];
  if (options.status === "waiting_for_user") {
    let lastMessageTs: number | undefined;
    for (const m of messages) {
      const t = tsMs(m.timestamp);
      if (t !== undefined && (lastMessageTs === undefined || t > lastMessageTs)) {
        lastMessageTs = t;
      }
    }
    if (lastMessageTs !== undefined && end > lastMessageTs) {
      waitingRanges.push({ start: lastMessageTs, end });
    }
  }

  return { lanes, events, arrows, waitingRanges, start, end };
}

/** Format a millisecond delta as "<n>s" under a minute, "<n>m" otherwise. */
export function formatDt(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m`;
}

/**
 * Collapse runs of three or more consecutive same-lane events on a given lane
 * into chains, returning both the kept (visible) events and the discovered
 * chains. The first and last event of each chain are preserved so the band's
 * endpoints can still be rendered; intermediates are dropped.
 */
export function decimateSameLaneChains(
  events: LaneEvent[],
  lane: LaneId,
): { visible: LaneEvent[]; chains: LaneChain[] } {
  if (events.length === 0) return { visible: [], chains: [] };
  const drop = new Set<number>();
  const chains: LaneChain[] = [];
  let i = 0;
  while (i < events.length) {
    const cur = events[i];
    if (!cur || cur.lane !== lane) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < events.length && events[j + 1]?.lane === lane) j += 1;
    const runLen = j - i + 1;
    if (runLen >= 3) {
      for (let k = i + 1; k < j; k++) drop.add(k);
      chains.push({ laneStart: i, laneEnd: j, count: runLen });
    }
    i = j + 1;
  }
  const visible: LaneEvent[] = [];
  for (let k = 0; k < events.length; k++) {
    if (!drop.has(k)) {
      const ev = events[k];
      if (ev) visible.push(ev);
    }
  }
  return { visible, chains };
}

export interface BandifyOptions {
  /** Total time span (ms) used to derive the gap threshold. */
  span: number;
}

/**
 * Group lane-local consecutive events into bands. A band ends when the next
 * same-lane event is farther than the threshold (max of 15s or 2% of the
 * total span). Single events stay as zero-width bands (start === end) so the
 * renderer can switch to a square representation.
 */
export function bandify(events: LaneEvent[], opts: BandifyOptions): LaneBand[] {
  if (events.length === 0) return [];
  const threshold = Math.max(15_000, opts.span * 0.02);
  const indexed = events.map((ev, i) => ({ ev, i }));
  const byLane = new Map<LaneId, Array<{ ev: LaneEvent; i: number }>>();
  for (const item of indexed) {
    const arr = byLane.get(item.ev.lane) ?? [];
    arr.push(item);
    byLane.set(item.ev.lane, arr);
  }
  const bands: LaneBand[] = [];
  for (const [lane, arr] of byLane) {
    arr.sort((a, b) => a.ev.ts - b.ev.ts);
    let cur: LaneBand | null = null;
    for (const { ev, i } of arr) {
      if (!cur) {
        cur = { lane, start: ev.ts, end: ev.ts, count: 1, firstIdx: i };
        continue;
      }
      if (ev.ts - cur.end <= threshold) {
        cur.end = ev.ts;
        cur.count += 1;
      } else {
        bands.push(cur);
        cur = { lane, start: ev.ts, end: ev.ts, count: 1, firstIdx: i };
      }
    }
    if (cur) bands.push(cur);
  }
  return bands;
}

export interface GridTick {
  ts: number;
  label: string;
}

export type GridMode = "absolute" | "relative";

function formatHMOnly(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatRelative(deltaMs: number): string {
  if (deltaMs <= 0) return "+0m";
  const totalMin = Math.floor(deltaMs / 60_000);
  if (totalMin < 60) return `+${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  return `+${h}h`;
}

const MIN_TICKS = 5;
const MAX_TICKS = 8;
const ONE_MIN = 60_000;
const ONE_HOUR = 60 * ONE_MIN;

function pickBaseStep(span: number): number {
  if (span < 5 * ONE_MIN) return ONE_MIN;
  if (span < ONE_HOUR) return 5 * ONE_MIN;
  if (span < 6 * ONE_HOUR) return 15 * ONE_MIN;
  return ONE_HOUR;
}

export function computeGridTicks(
  start: number,
  end: number,
  mode: GridMode,
): GridTick[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }
  const span = end - start;
  let step = pickBaseStep(span);
  const count = (s: number) => Math.floor(span / s) + 1;
  if (count(step) > MAX_TICKS) step *= 2;
  else if (count(step) < MIN_TICKS) step = Math.max(ONE_MIN, Math.floor(step / 2));
  const ticks: GridTick[] = [];
  for (let t = start; t <= end + 1; t += step) {
    const label =
      mode === "absolute" ? formatHMOnly(t) : formatRelative(t - start);
    ticks.push({ ts: t, label });
    if (ticks.length > 32) break;
  }
  return ticks;
}
