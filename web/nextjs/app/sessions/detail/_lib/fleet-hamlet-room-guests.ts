// Fleet Hamlet — Room Scene "Guests" derivation.
//
// When sub-agents (or other recently active local agents whose
// `parentSessionId === card.sessionId`) are alive, they "drop by" the
// resident's room. This module turns the existing Bustle signal into a
// concrete roster of guest avatars with stage positions on the floor.
//
// Pure / deterministic. The component layer is in
// `_components/fleet-hamlet-room-scene.tsx`.

import type { SimCardModel } from "./fleet-hamlet";
import { hashStringToInt } from "./fleet-hamlet";
import type { Bustle } from "./fleet-hamlet-bustle";
import { agentHueShift, hashRepoToHue } from "./fleet-hamlet-layout";

export interface RoomGuest {
  /** Stable key for React reconciliation. */
  key: string;
  /** Scene x in SVG units (viewBox 0..360). */
  cx: number;
  /** Ground y in SVG units. Used to place the standing avatar's feet. */
  groundY: number;
  /** Total avatar height in scene units (head + body). */
  height: number;
  /** Avatar seed derived from session id so each guest looks distinct. */
  seed: number;
  /** Drives clothing color via `clothingForAgent`. */
  sessionType: SimCardModel["sessionType"];
  /** Hue (0..360) — used by the overhead accent halo. */
  hue: number;
  /** Per-guest animation phase so bobbing/sparkles desync naturally. */
  phase: number;
}

const SCENE_W = 360;

// Guests stand in the mid-back band of the floor — far enough from the
// resident (front-right) and the visitor (front-left) that they don't
// collide visually but close enough that they read as "in the same room".
const BACK_GROUND_Y = 178;
const MID_GROUND_Y = 188;
const GUEST_HEIGHT_BACK = 46;
const GUEST_HEIGHT_MID = 52;

/**
 * Lay out up to `max` guests across the back of the room. Caller is
 * responsible for picking the right `bustle` (must come from
 * `computeBustle(card, allCards, now)`).
 *
 * Visual budget — keep the page-wide SVG node count reasonable:
 *  quiet  → 0 guests
 *  lively → 1 guest  (back center)
 *  busy   → 2-3 guests (back row)
 *  party  → 4 guests  (back row + 1 mid-front offset)
 */
export function deriveRoomGuests(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
  bustle: Bustle,
  options: { visitorPresent?: boolean; max?: number } = {},
): RoomGuest[] {
  if (bustle.subagentCount <= 0) return [];
  const max = options.max ?? 4;

  // Resolve the actual subagent cards in a deterministic order (most
  // recently active first) so positions stay stable across renders for the
  // same data.
  const subs: SimCardModel[] = [];
  for (const c of allCards) {
    if (c.parentSessionId !== card.sessionId) continue;
    if (c.sessionId === card.sessionId) continue;
    subs.push(c);
  }
  subs.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const roster = subs.slice(0, Math.min(max, subs.length));
  if (roster.length === 0) return [];

  // Anchor points (cx percentages of SCENE_W) selected per-count so the
  // arrangement looks "blocked" rather than randomly scattered.
  const anchors = layoutAnchors(roster.length, options.visitorPresent ?? false);

  return roster.map((sub, i) => {
    const a = anchors[i] ?? anchors[anchors.length - 1]!;
    const baseHue = hashRepoToHue(sub.repo);
    const shift = agentHueShift(sub.sessionType);
    const hue = (baseHue + shift + 360) % 360;
    return {
      key: `guest-${sub.sessionId}`,
      cx: a.cxRatio * SCENE_W,
      groundY: a.row === "mid" ? MID_GROUND_Y : BACK_GROUND_Y,
      height: a.row === "mid" ? GUEST_HEIGHT_MID : GUEST_HEIGHT_BACK,
      seed: hashStringToInt(`${sub.sessionType}:${sub.sessionId}`),
      sessionType: sub.sessionType,
      hue,
      phase: i * 0.42,
    };
  });
}

interface Anchor {
  cxRatio: number;
  row: "back" | "mid";
}

function layoutAnchors(count: number, visitorPresent: boolean): Anchor[] {
  // When the user-visitor is in the room (front-left), bias the guest
  // anchors slightly toward the right so they don't crowd the visitor.
  const leftBias = visitorPresent ? 0.06 : 0;
  switch (count) {
    case 1:
      return [{ cxRatio: 0.48 + leftBias, row: "back" }];
    case 2:
      return [
        { cxRatio: 0.38 + leftBias, row: "back" },
        { cxRatio: 0.58 + leftBias, row: "back" },
      ];
    case 3:
      return [
        { cxRatio: 0.32 + leftBias, row: "back" },
        { cxRatio: 0.48 + leftBias, row: "back" },
        { cxRatio: 0.64 + leftBias, row: "back" },
      ];
    case 4:
    default:
      return [
        { cxRatio: 0.28 + leftBias, row: "back" },
        { cxRatio: 0.44 + leftBias, row: "back" },
        { cxRatio: 0.6 + leftBias, row: "back" },
        { cxRatio: 0.4 + leftBias, row: "mid" },
      ];
  }
}
