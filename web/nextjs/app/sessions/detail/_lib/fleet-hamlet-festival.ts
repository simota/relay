// Hamlet — Festival detection (軸A).
//
// When multiple residents hit celebratory life-events at the same time the
// whole village erupts into a festival: confetti, lanterns, and a special
// news headline. Pure function — no React, no side effects.

import type { SimCardModel } from "./fleet-hamlet";
import type { LifeEvent } from "./fleet-hamlet-events";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FestivalState {
  /** Festival is currently active. */
  active: true;
  /** Number of recent celebratory events that triggered the festival. */
  intensity: number;
  /** ms — festival ends at this timestamp. */
  until: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Kinds that count as "festive" triggers. */
const FESTIVE_KINDS = new Set(["achievement", "birthday", "baby", "wedding"]);

/** Look-back window for recent events. */
const FESTIVAL_WINDOW_MS = 60 * 60 * 1000; // 1h

/** Minimum number of festive events required. */
const FESTIVAL_MIN_EVENTS = 2;

/** How long a festival lasts after the newest trigger. */
const FESTIVAL_DURATION_MS = 30 * 60 * 1000; // 30min

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a `FestivalState` when there are 2+ recent celebratory events,
 * `null` otherwise.
 *
 * @param sims    Full sim roster (unused for now but reserved for future
 *                sim-side condition checks).
 * @param events  All events for the current snapshot — pass the same array
 *                that `collectAllEvents` returns.
 * @param now     Current epoch ms.
 */
export function detectFestival(
  sims: readonly SimCardModel[],
  events: readonly LifeEvent[],
  now: number,
): FestivalState | null {
  // unused param kept for API symmetry
  void sims;

  const cutoff = now - FESTIVAL_WINDOW_MS;
  const festive = events.filter(
    (e) => FESTIVE_KINDS.has(e.kind) && e.timestamp >= cutoff,
  );

  if (festive.length < FESTIVAL_MIN_EVENTS) return null;

  const newestTs = festive.reduce(
    (max, e) => (e.timestamp > max ? e.timestamp : max),
    0,
  );

  return {
    active: true,
    intensity: festive.length,
    until: newestTs + FESTIVAL_DURATION_MS,
  };
}
