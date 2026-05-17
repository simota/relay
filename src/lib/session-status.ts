// Heuristic session-status detector for Claude Code JSONL transcripts.
//
// Claude does not write an explicit "waiting for user" flag — the signal must
// be reconstructed from the tail of the JSONL: an assistant `tool_use` block
// whose matching `tool_result` never arrives means the CLI has paused on a
// permission prompt or AskUserQuestion. We deliberately keep the detector
// pure (text in, status out) so it can run both in the sync adapter (DB
// upsert path) and in the live SSE detail reader (real-time UI updates).

import type { SessionStatus } from "../types.js";

interface DetectOptions {
  /**
   * Wall-clock time used to compare against the last event's timestamp.
   * Defaults to Date.now(). Injected for tests and for callers that already
   * have a `now` reference (the API layer reuses one across requests).
   */
  now?: number;
  /**
   * Number of milliseconds an open tool_use must remain unanswered before
   * we classify the session as `waiting_for_user`. Below this threshold the
   * session is considered `active` (the CLI is probably mid-execution and
   * the tool_result has simply not been written yet). 5 s is the default —
   * Bash tool calls under that bound are still "in flight"; permission
   * prompts almost always stall well past 5 s because they wait on a human.
   */
  idleMs?: number;
}

const DEFAULT_IDLE_MS = 5_000;

// Marker text Claude writes into a `user`-typed entry when the operator
// interrupts a tool call (Ctrl-C during permission prompt, etc). Matching
// is anchored on the leading bracket so we do not mistake user-authored
// text containing the same phrase for a real interruption marker.
const INTERRUPTED_MARKER = /^\[Request interrupted by user/;

/**
 * Classify a Claude session JSONL transcript into a lifecycle status.
 *
 * Returns one of:
 *   - `waiting_for_user`: the tail assistant event opened one or more
 *     foreground tool_use blocks with no matching tool_result, and the
 *     session has been quiet for at least `idleMs`. This is the state the
 *     UI surfaces with a blinking attention indicator.
 *   - `interrupted`: a `[Request interrupted by user...]` marker appears
 *     after the last assistant turn. Distinct from waiting_for_user because
 *     the operator already responded — they cancelled rather than approved.
 *   - `active`: a tool_use is in flight but still within the idle window,
 *     OR the last event is recent and the turn has not ended. The CLI is
 *     plausibly still working; do not pester the user.
 *   - `ended`: the last assistant turn finished with `stop_reason: end_turn`
 *     and no further events followed. The conversation is paused on the
 *     user's side (free to send a new prompt). Distinct from `idle`, which
 *     means "no signal at all" — `ended` means "we know it stopped cleanly".
 *   - `idle`: nothing pending and no clean turn-end marker. Either the file
 *     is empty / opaque, or activity exists but does not match any other
 *     state. Default fallback so we never advertise a state we have not
 *     observed.
 *
 * Background tool calls (`run_in_background: true`) are excluded from the
 * "unanswered tool_use" check because their tool_result legitimately lags.
 */
export function detectClaudeSessionStatus(text: string, opts: DetectOptions = {}): SessionStatus {
  if (!text) return "idle";

  const now = opts.now ?? Date.now();
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;

  const lines = text.split("\n");
  // Walk from the end to find the most recent assistant turn. We need the
  // tool_use blocks AND the stop_reason from the same assistant message —
  // both feed the classification.
  let lastAssistantToolUses: { id: string; background: boolean }[] = [];
  let lastAssistantStopReason: string | null = null;
  let lastAssistantTsMs: number | null = null;
  let lastAssistantIndex = -1;
  let lastTimestampMs: number | null = null;
  let interruptedAfterAssistant = false;
  const toolResultsAfterAssistant = new Set<string>();

  // First pass: find lastAssistantIndex + last timestamp anywhere.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    const obj = safeParseLine(line);
    if (!obj) continue;
    const ts = parseTimestamp(obj);
    if (ts !== null && lastTimestampMs === null) lastTimestampMs = ts;

    const role = extractRole(obj);
    if (role === "assistant") {
      lastAssistantToolUses = extractToolUses(obj);
      lastAssistantStopReason = extractStopReason(obj);
      lastAssistantTsMs = ts;
      lastAssistantIndex = i;
      break;
    }
  }

  // No assistant at all → fall back to recency-based active/idle.
  if (lastAssistantIndex < 0) {
    return classifyByRecency(lastTimestampMs, now, idleMs);
  }

  // Second pass: walk forward from the assistant event to collect every
  // tool_result_id that arrived and detect the interruption marker. The
  // `user` role carries both tool_results (structured content blocks) and
  // free-text interruption markers, so we have to inspect both shapes.
  // We also track whether any event with a real timestamp appeared after
  // the assistant — this distinguishes "AI turn ended, session quiet"
  // from "AI turn ended, user just sent a new prompt".
  let eventsAfterAssistant = false;
  for (let i = lastAssistantIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const obj = safeParseLine(line);
    if (!obj) continue;
    if (parseTimestamp(obj) !== null) eventsAfterAssistant = true;
    if (extractRole(obj) !== "user") continue;

    for (const id of extractToolResultIds(obj)) toolResultsAfterAssistant.add(id);

    // The interruption marker only appears in plain-text user content; we
    // only need to scan strings here, not structured tool_result blocks.
    for (const t of extractUserTexts(obj)) {
      if (INTERRUPTED_MARKER.test(t)) {
        interruptedAfterAssistant = true;
        break;
      }
    }
  }

  if (interruptedAfterAssistant) return "interrupted";

  // Foreground tool_uses (excluding background) that never got a result.
  const pendingForeground = lastAssistantToolUses.filter(
    (tu) => !tu.background && !toolResultsAfterAssistant.has(tu.id),
  );

  if (pendingForeground.length > 0) {
    // Pending foreground tool_use(s). If the tail is recent, the CLI is
    // probably still running the tool — wait before declaring "user input
    // needed". Past the idle window, we declare waiting_for_user.
    if (lastTimestampMs !== null && now - lastTimestampMs < idleMs) return "active";
    return "waiting_for_user";
  }

  // Every foreground tool_use was answered (or there were none). Three
  // sub-cases ordered from most specific to most general:
  //
  // 1. The freshest event in the file IS the last assistant AND that
  //    assistant message ended with `stop_reason: end_turn` → `ended`.
  //    The conversation is paused on the user's side.
  // 2. Events appeared after the last assistant (user typed a new prompt,
  //    sent a tool_result, etc) → fall back to recency. Recent activity
  //    is `active`; stale is `idle`.
  // 3. No `end_turn` and no trailing activity → fall back to recency.
  //    This is the "stop_reason: max_tokens" / unknown / pre-end-turn
  //    streaming case where we cannot definitively claim the turn ended.
  if (!eventsAfterAssistant && lastAssistantStopReason === "end_turn") {
    return "ended";
  }
  // If the last assistant itself is the freshest signal and it ended
  // cleanly OR if the assistant is still recent in its own right, classify
  // by the freshest available timestamp.
  const freshestTs = lastTimestampMs ?? lastAssistantTsMs;
  return classifyByRecency(freshestTs, now, idleMs);
}

function classifyByRecency(lastTimestampMs: number | null, now: number, idleMs: number): SessionStatus {
  if (lastTimestampMs === null) return "idle";
  return now - lastTimestampMs < idleMs ? "active" : "idle";
}

function safeParseLine(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseTimestamp(obj: Record<string, unknown>): number | null {
  const ts = obj.timestamp;
  if (typeof ts !== "string") return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function extractRole(obj: Record<string, unknown>): "user" | "assistant" | "system" | null {
  const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
  const role = (wrapper as Record<string, unknown>).role;
  if (role === "user" || role === "assistant" || role === "system") return role;
  return null;
}

function extractStopReason(obj: Record<string, unknown>): string | null {
  // Claude session entries nest the assistant message under `.message`. The
  // stop_reason sits at that level (alongside role / content). Possible
  // values: end_turn | tool_use | max_tokens | stop_sequence | null.
  const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
  const sr = (wrapper as Record<string, unknown>).stop_reason;
  return typeof sr === "string" ? sr : null;
}

function extractToolUses(obj: Record<string, unknown>): { id: string; background: boolean }[] {
  const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
  const blocks = (wrapper as Record<string, unknown>).content;
  if (!Array.isArray(blocks)) return [];
  const out: { id: string; background: boolean }[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const block = b as Record<string, unknown>;
    if (block.type !== "tool_use") continue;
    const id = typeof block.id === "string" ? block.id : null;
    if (!id) continue;
    const input = (block.input as Record<string, unknown> | undefined) ?? {};
    // Bash tool exposes `run_in_background: true` for backgrounded shells;
    // their tool_result legitimately arrives much later, so treat them as
    // "fire and forget" for status detection. Same applies to any future
    // tool that opts into the same convention.
    const background = input.run_in_background === true;
    out.push({ id, background });
  }
  return out;
}

function extractToolResultIds(obj: Record<string, unknown>): string[] {
  const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
  const blocks = (wrapper as Record<string, unknown>).content;
  if (!Array.isArray(blocks)) return [];
  const out: string[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const block = b as Record<string, unknown>;
    if (block.type !== "tool_result") continue;
    const id = block.tool_use_id;
    if (typeof id === "string") out.push(id);
  }
  return out;
}

function extractUserTexts(obj: Record<string, unknown>): string[] {
  const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
  const content = (wrapper as Record<string, unknown>).content;
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const block = b as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") out.push(block.text);
  }
  return out;
}
