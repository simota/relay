// Hamlet Rooms — Collective Choreography (軸3).
//
// Detects grid-wide synchronized states and returns a ChoreoState that the
// RoomsChoreoOverlay component uses to fire collective visual effects.
// Pure, deterministic — no React, no side effects.

import type { SimCardModel } from "./fleet-hamlet";
import type { LifeEvent } from "./fleet-hamlet-events";
import { computeRoomMotion } from "./fleet-hamlet-outing";
import { detectFestival } from "./fleet-hamlet-festival";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChoreoState {
  /** 3+ sims are in "working" motion — show stretch animation in overlay. */
  workingSync: boolean;
  /** 4+ sims are in "resting" motion — show shared 💤 cloud. */
  restingCloud: boolean;
  /**
   * 3+ sims share the same mood key — rain down their mood emoji.
   * When null, no mood rain. When set, `emoji` is the mood emoji and
   * `count` is how many sims share it.
   */
  moodSync: { emoji: string; key: string; count: number } | null;
  /** detectFestival returned active — show 🎊 confetti overlay. */
  festivalActive: boolean;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const WORKING_SYNC_MIN = 3;
const RESTING_CLOUD_MIN = 4;
const MOOD_SYNC_MIN = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes the current choreography state for the Rooms grid.
 *
 * @param sims   Current frozenSims roster (at least 1; empty returns all-false).
 * @param events All collected events (passed straight through to detectFestival).
 * @param now    Current epoch ms.
 */
export function computeRoomsChoreo(
  sims: readonly SimCardModel[],
  events: readonly LifeEvent[],
  now: number,
): ChoreoState {
  if (sims.length === 0) {
    return {
      workingSync: false,
      restingCloud: false,
      moodSync: null,
      festivalActive: false,
    };
  }

  let workingCount = 0;
  let restingCount = 0;
  const moodCounts = new Map<string, { emoji: string; count: number }>();

  for (const sim of sims) {
    const motion = computeRoomMotion(sim, now);
    if (motion === "working") workingCount++;
    if (motion === "resting") restingCount++;

    const moodKey = sim.mood.key;
    const existing = moodCounts.get(moodKey);
    if (existing) {
      existing.count++;
    } else {
      moodCounts.set(moodKey, { emoji: sim.mood.emoji, count: 1 });
    }
  }

  // Find top mood (if it meets threshold)
  let topMood: { emoji: string; key: string; count: number } | null = null;
  for (const [key, { emoji, count }] of moodCounts) {
    if (count >= MOOD_SYNC_MIN) {
      if (!topMood || count > topMood.count) {
        topMood = { emoji, key, count };
      }
    }
  }

  const festival = detectFestival(sims, events, now);

  return {
    workingSync: workingCount >= WORKING_SYNC_MIN,
    restingCloud: restingCount >= RESTING_CLOUD_MIN,
    moodSync: topMood,
    festivalActive: festival !== null,
  };
}
