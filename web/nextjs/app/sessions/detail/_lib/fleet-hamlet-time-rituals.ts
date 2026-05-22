// Hamlet — Time-of-day ritual state.
//
// Returns the active ritual for the current time-of-day so the Neighborhood
// can render morning-newspaper delivery, evening church bells, and night
// window-extinguishing without baking the logic into the already-large
// neighborhood component.
//
// Pure function — no React, no side effects.

import type { TimeOfDay } from "./fleet-hamlet-decor";
import type { SimCardModel } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Single active ritual.  null = no ritual for the current tod. */
export type TimeRitual =
  | {
      kind: "newspaper";
      /** Number of visible homes that should show a 📰 icon. */
      paperCount: number;
    }
  | {
      kind: "evening-bell";
      /** true when the bell ripple should animate. */
      ripple: boolean;
      /** Headline text to inject into the news ticker (shown for ~5 min). */
      headline: string;
    }
  | {
      kind: "lights-out";
      /** Keys of sims whose windows should be extinguished (silence > 5 min). */
      darkKeys: ReadonlySet<string>;
    };

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Silence threshold (ms) after which a sim's windows go dark at night. */
const NIGHT_DARK_MS = 5 * 60 * 1000; // 5 min

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the active time ritual.
 *
 * @param tod    Current TimeOfDay (as returned by `timeOfDay()`).
 * @param sims   Current sim roster — used for the lights-out ritual.
 * @param now    Current epoch ms.
 */
export function computeTimeRitual(
  tod: TimeOfDay,
  sims: readonly SimCardModel[],
  now: number,
): TimeRitual | null {
  switch (tod) {
    case "morning": {
      // Newspaper delivery: count of active homes (all visible sims).
      const paperCount = Math.min(sims.length, 12);
      if (paperCount === 0) return null;
      return { kind: "newspaper", paperCount };
    }
    case "evening": {
      return {
        kind: "evening-bell",
        ripple: true,
        headline: "🔔 evening bell — the village quiets for the night",
      };
    }
    case "night": {
      // Extinguish windows for sims silent > 5 min.
      const darkKeys = new Set<string>();
      for (const sim of sims) {
        if (now - sim.lastActiveAt >= NIGHT_DARK_MS) {
          darkKeys.add(sim.key);
        }
      }
      if (darkKeys.size === 0) return null;
      return { kind: "lights-out", darkKeys };
    }
    default:
      return null;
  }
}
