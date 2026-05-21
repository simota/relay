// Hamlet — Outing helpers.
//
// Decides whether a resident is currently "at home", "walking the street",
// or "out at the park" based on the silence (`now - lastActiveAt`) of the
// underlying session. The Neighborhood view consumes the result to:
//   - bias the WalkingSimLayer toward non-active residents (gimmick A.1)
//   - paint the park zone with mini-avatars next to the tiny houses,
//     plus a few extra "strollers / chatting" residents (gimmick A.2)
//
// Pure, deterministic, side-effect free.

import type { SimCardModel } from "./fleet-hamlet";
import { hashStringToInt } from "./fleet-hamlet";
import type { WalkingSimSpec } from "./fleet-hamlet-particles";

// ---------------------------------------------------------------------------
// Outing state — derived from silence window
// ---------------------------------------------------------------------------

export type OutingState = "walking" | "park" | "home";

/** Active threshold — residents quieter than this start "going out". */
const WALK_MIN_MS = 5 * 60 * 1000; // 5m
/** Above this, the resident has migrated to the park zone. */
const PARK_MIN_MS = 60 * 60 * 1000; // 1h (matches PARK_SILENCE_MS)
/** Above this they're "back home / sleeping" — likely archived candidate. */
const HOME_AGAIN_MS = 24 * 60 * 60 * 1000; // 24h

export function computeOutingState(card: SimCardModel, now: number): OutingState {
  const silence = Math.max(0, now - card.lastActiveAt);
  if (silence < WALK_MIN_MS) return "home";
  if (silence < PARK_MIN_MS) return "walking";
  if (silence < HOME_AGAIN_MS) return "park";
  return "home";
}

// ---------------------------------------------------------------------------
// Out-of-house signals — coarse "at home" / "out" booleans.
//
// These are the visual gimmick A.3 hooks: the neighborhood reads these per
// active-zone card to decide whether to render a tiny resident in the yard
// (at-home) or hang an "Out" sign by the door (out). They intentionally do
// not overlap with `computeOutingState` so an "out" house can still be in
// either the `walking` or pre-park OutingState bucket — the sign is the
// signal at the **house**, the OutingState is the signal at the **street**.
// ---------------------------------------------------------------------------

/** Silence below which a resident is treated as "in the house right now". */
const AT_HOME_MAX_MS = 5 * 60 * 1000; // 5m — matches WALK_MIN_MS
/** Silence above which a resident is treated as "out for a while". */
const OUT_MIN_MS = 30 * 60 * 1000; // 30m

/**
 * `true` when the card is recent enough that we can plausibly show a
 * resident standing in front of their own house.
 */
export function isAtHome(
  card: SimCardModel,
  now: number,
  thresholdMs: number = AT_HOME_MAX_MS,
): boolean {
  return Math.max(0, now - card.lastActiveAt) < thresholdMs;
}

/**
 * `true` when the card has been silent long enough to warrant an "Out"
 * placard on the door. The default 30m window sits between the walking and
 * park thresholds so a resident heading out shows the sign before they hit
 * the park zone.
 */
export function isOut(
  card: SimCardModel,
  now: number,
  thresholdMs: number = OUT_MIN_MS,
): boolean {
  return Math.max(0, now - card.lastActiveAt) > thresholdMs;
}

// ---------------------------------------------------------------------------
// Room avatar motion — drives the in-room walk gimmick.
//
// The resident standing in the House Room scene used to be glued to one
// spot. Now they pace around the interior when the session goes idle, then
// settle once the silence stretches long enough that they'd plausibly be
// napping. State buckets line up with the existing `isAtHome` / `isOut`
// thresholds so all three motion modes share one mental model:
//
//   silence <  5m → "working"  — at the desk, no extra animation
//   5m–30m         → "walking"  — pacing across the floor
//   silence ≥ 30m → "resting"  — frozen mid-stride (winding down)
// ---------------------------------------------------------------------------

export type RoomAvatarMotion = "working" | "walking" | "resting";

export function computeRoomMotion(
  card: SimCardModel,
  now: number,
): RoomAvatarMotion {
  const silence = Math.max(0, now - card.lastActiveAt);
  if (silence < AT_HOME_MAX_MS) return "working";
  if (silence < OUT_MIN_MS) return "walking";
  return "resting";
}

/**
 * Count cards currently in the "walking" OutingState. Used by the
 * Neighborhood view to scale the street pedestrian count dynamically — the
 * more residents are mid-stride, the busier the street feels.
 */
export function countWalkingState(
  cards: readonly SimCardModel[],
  now: number,
): number {
  let n = 0;
  for (const c of cards) {
    if (computeOutingState(c, now) === "walking") n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Walking sims picker — outing-aware
// ---------------------------------------------------------------------------

/**
 * Prefer residents currently in the "walking" outing state for the street
 * pedestrians. Falls back to recently-active cards when the walking pool is
 * too small so the street never feels empty.
 *
 * Shape-compatible with the original `pickWalkingSims` so the consumer in
 * `fleet-hamlet-neighborhood.tsx` only swaps the import.
 */
export function pickOutingSims(
  cards: readonly SimCardModel[],
  now: number,
  count = 3,
  groundHeight = 120,
): WalkingSimSpec[] {
  if (cards.length === 0) return [];
  const walking: SimCardModel[] = [];
  const others: SimCardModel[] = [];
  for (const c of cards) {
    if (computeOutingState(c, now) === "walking") walking.push(c);
    else others.push(c);
  }
  const stable = (a: SimCardModel, b: SimCardModel) =>
    hashStringToInt(a.key) - hashStringToInt(b.key);
  walking.sort(stable);
  // Fallback ranked by most-recent activity, mirrors original behavior.
  others.sort((a, b) => {
    const da = now - a.lastActiveAt;
    const db = now - b.lastActiveAt;
    if (da !== db) return da - db;
    return stable(a, b);
  });

  const picks: SimCardModel[] = [];
  for (const c of walking) {
    if (picks.length >= count) break;
    picks.push(c);
  }
  for (const c of others) {
    if (picks.length >= count) break;
    picks.push(c);
  }

  return picks.map((sim, i) => {
    const seed = hashStringToInt(sim.key);
    const isOuter = walking.includes(sim);
    return {
      sim,
      startOffset: (seed % 100) / 100,
      // Outing residents take longer strolls — slower, more "leisurely".
      durationMs: (isOuter ? 32_000 : 26_000) + (seed % 14_000),
      topPx: Math.max(
        8,
        groundHeight * 0.35 + ((seed * 7) % Math.max(8, groundHeight * 0.55)),
      ),
      direction: (i % 2 === 0 ? 1 : -1) as 1 | -1,
    };
  });
}
