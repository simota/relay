// Fleet Hamlet — Last Message extraction for Neighborhood chat bubbles.
//
// Given the per-key SessionDetail map fetched by `useSessionDetails`, picks
// the most recent user/assistant message per house and surfaces it as a
// small overhead chat bubble. Only messages newer than `maxAgeMs` are
// returned so silent residents stay quiet; we cap the simultaneously-
// displayed bubble count to keep the village readable.

import type { SessionDetail } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";

// Default freshness window — bubbles fade out across this window and
// disappear past it.
export const HOUSE_BUBBLE_MAX_AGE_MS = 60_000;

export interface LastMessage {
  role: "user" | "assistant";
  text: string;
  /** Epoch ms parsed from the SessionMessage timestamp string. */
  timestamp: number;
  /** Age relative to the caller's `now` snapshot — drives opacity. */
  ageMs: number;
}

const TRUNCATE_AT = 120;

/**
 * Returns the most recent user/assistant message for this session if it
 * landed within `maxAgeMs`. tool/system messages are skipped (the chat
 * bubble metaphor is for human-readable text). Returns null when there's
 * nothing fresh enough to surface.
 */
export function getLastMessage(
  detail: SessionDetail | undefined,
  now: number,
  maxAgeMs: number = HOUSE_BUBBLE_MAX_AGE_MS,
): LastMessage | null {
  if (!detail) return null;
  if (!Array.isArray(detail.messages) || detail.messages.length === 0)
    return null;

  // Walk newest-first so we stop at the first chat-style message.
  // SessionDetail messages aren't guaranteed to be sorted, so we scan all
  // and pick by max(ts).
  let bestTs = -Infinity;
  let bestRole: "user" | "assistant" | null = null;
  let bestText = "";
  for (const m of detail.messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const ts = Date.parse(m.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (ts > bestTs) {
      bestTs = ts;
      bestRole = m.role;
      bestText = m.text ?? "";
    }
  }
  if (bestRole === null) return null;

  const ageMs = now - bestTs;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) return null;

  const text = truncate(bestText, TRUNCATE_AT);
  if (!text) return null;
  return { role: bestRole, text, timestamp: bestTs, ageMs };
}

/**
 * For all `cards`, compute the freshest LastMessage (if any) and return the
 * top `max` by ageMs (newest first). Selected house is forced into the
 * result when present so the user can always see its bubble. Used by the
 * Neighborhood layer to bound simultaneous bubbles and avoid clutter.
 */
export function pickHousesWithBubbles(
  cards: readonly SimCardModel[],
  detailByKey: ReadonlyMap<string, SessionDetail> | undefined,
  now: number,
  max: number = 8,
  options: { selectedKey?: string | null; maxAgeMs?: number } = {},
): Map<string, LastMessage> {
  const out = new Map<string, LastMessage>();
  if (!detailByKey || detailByKey.size === 0) return out;
  const maxAgeMs = options.maxAgeMs ?? HOUSE_BUBBLE_MAX_AGE_MS;

  // Score every card's last message, then keep the freshest `max`. We do a
  // single linear pass + sort which is fine for the active-zone bound
  // (max ~12 houses per the caller spec).
  type Scored = { key: string; msg: LastMessage };
  const scored: Scored[] = [];
  for (const sim of cards) {
    const detail = detailByKey.get(sim.key);
    const msg = getLastMessage(detail, now, maxAgeMs);
    if (msg) scored.push({ key: sim.key, msg });
  }
  scored.sort((a, b) => a.msg.ageMs - b.msg.ageMs);

  // Ensure the selected house's bubble shows when it has one, even if
  // outranked by other newer bubbles.
  const { selectedKey } = options;
  if (selectedKey) {
    const idx = scored.findIndex((s) => s.key === selectedKey);
    if (idx > 0) {
      const [hit] = scored.splice(idx, 1);
      if (hit) scored.unshift(hit);
    }
  }

  for (const s of scored.slice(0, max)) out.set(s.key, s.msg);
  return out;
}

/** Map ageMs → CSS opacity (0..1). Linear fade across four bands. */
export function bubbleOpacity(ageMs: number, maxAgeMs: number = HOUSE_BUBBLE_MAX_AGE_MS): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1;
  if (ageMs >= maxAgeMs) return 0;
  const t = ageMs / maxAgeMs;
  if (t < 0.25) return 1.0;
  if (t < 0.5) return 0.8;
  if (t < 0.75) return 0.6;
  return 0.3;
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  const norm = text.replace(/\s+/g, " ").trim();
  if (norm.length === 0) return "";
  if (norm.length <= max) return norm;
  return `${norm.slice(0, max - 1).trimEnd()}…`;
}
