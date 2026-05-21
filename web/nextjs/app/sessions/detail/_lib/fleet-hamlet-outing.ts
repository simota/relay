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
