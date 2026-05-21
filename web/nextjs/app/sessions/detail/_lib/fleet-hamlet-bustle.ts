// Hamlet — Bustle helpers.
//
// "Bustle" represents how lively an active house looks based on the number
// of recently-active sub-agent sessions whose `parentSessionId` matches the
// current card's id. The Neighborhood view uses the result to overlay
// multi-window flashes, roof music notes, colored chimney smoke, and an
// optional golden aura — see `_components/fleet-hamlet-bustle.tsx`.
//
// Pure, deterministic, O(n) over `allCards`.

import type { SimCardModel } from "./fleet-hamlet";
import { agentHueShift, hashRepoToHue } from "./fleet-hamlet-layout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BustleIntensity = "quiet" | "lively" | "busy" | "party";

export interface Bustle {
  /** Count of *recently active* direct subagents. */
  subagentCount: number;
  /** Hue per subagent (capped to 6) for window / smoke / note coloring. */
  subagentHues: number[];
  intensity: BustleIntensity;
}

/** A subagent counts as "in the house right now" if it moved within 5m. */
const RECENT_SUBAGENT_MS = 5 * 60 * 1000;

/** Cap how many distinct hues we feed downstream sprites — avoids overdraw. */
const MAX_HUES = 6;

// ---------------------------------------------------------------------------
// Intensity table
// ---------------------------------------------------------------------------

export function intensityFromCount(count: number): BustleIntensity {
  if (count <= 0) return "quiet";
  if (count === 1) return "lively";
  if (count <= 3) return "busy";
  return "party";
}

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------

/**
 * For an *active* card, walk `allCards` once and gather direct children
 * (`parentSessionId === card.sessionId`) that were active within the recent
 * subagent window. Returns a `Bustle` even for quiet houses so callers can
 * key off `intensity === 'quiet'` to skip the overlay.
 */
export function computeBustle(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
  now: number,
): Bustle {
  const hues: number[] = [];
  let count = 0;
  for (const c of allCards) {
    if (c.parentSessionId !== card.sessionId) continue;
    if (c.sessionId === card.sessionId) continue; // safety: skip self
    const silence = Math.max(0, now - c.lastActiveAt);
    if (silence > RECENT_SUBAGENT_MS) continue;
    count += 1;
    if (hues.length < MAX_HUES) {
      // Mix repo hue with the per-agent shift so two subagents on the same
      // repo but different kinds still come out as different hues.
      const baseHue = hashRepoToHue(c.repo);
      const shift = agentHueShift(c.sessionType);
      hues.push((baseHue + shift + 360) % 360);
    }
  }
  return {
    subagentCount: count,
    subagentHues: hues,
    intensity: intensityFromCount(count),
  };
}

// ---------------------------------------------------------------------------
// Helpers consumed by the bustle UI layer
// ---------------------------------------------------------------------------

/** Sprite-count budget per intensity. Keeps the whole page under the SVG cap. */
export function bustleSpriteCount(intensity: BustleIntensity): {
  windows: number;
  notes: number;
  smoke: number;
  aura: boolean;
} {
  switch (intensity) {
    case "lively":
      return { windows: 2, notes: 1, smoke: 1, aura: false };
    case "busy":
      return { windows: 4, notes: 3, smoke: 3, aura: true };
    case "party":
      return { windows: 6, notes: 5, smoke: 4, aura: true };
    case "quiet":
    default:
      return { windows: 0, notes: 0, smoke: 0, aura: false };
  }
}
