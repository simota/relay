// Hamlet — Wildlife layer (軸B).
//
// Picks which animals appear in the village given the current
// environmental conditions.  Pure function, no React, no side-effects.

import type { SimCardModel } from "./fleet-hamlet";
import type { TimeOfDay } from "./fleet-hamlet-decor";
import type { Season } from "./fleet-hamlet-particles";
import { hashStringToInt } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WildlifeKind = "owl" | "frog" | "butterfly" | "cat";

export interface WildlifeSpec {
  kind: WildlifeKind;
  /** 0..1 normalised horizontal position. */
  xFrac: number;
  /** 0..1 normalised vertical position (0 = top of scene). */
  yFrac: number;
  /** Deterministic animation delay in seconds. */
  delayS: number;
  /** Emoji glyph to render. */
  glyph: string;
  /** Accessible tooltip. */
  label: string;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Seed channel offsets — keeps animal placement decorrelated. */
const CH_OWL = 10;
const CH_FROG = 20;
const CH_CAT = 30;
const CH_BUTTERFLY = 40;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the list of wildlife that should be visible right now.
 */
export function pickWildlife(
  sims: readonly SimCardModel[],
  weather: "clear" | "partly" | "cloudy" | "stormy",
  season: Season,
  tod: TimeOfDay,
  now: number,
): WildlifeSpec[] {
  void now; // reserved for future time-based conditions
  const out: WildlifeSpec[] = [];

  // Stable seed derived from the whole sim roster so the layout is
  // consistent within a session but shifts naturally as sims join/leave.
  let rosterSeed = 0;
  for (const s of sims) rosterSeed = (rosterSeed + hashStringToInt(s.key)) >>> 0;
  if (rosterSeed === 0) rosterSeed = 1;

  // ------------------------------------------------------------------
  // 🦉 Owl — night only, static on the founder's rooftop.
  if (tod === "night") {
    const seed = mixSeed(rosterSeed, CH_OWL);
    out.push({
      kind: "owl",
      xFrac: 0.2 + ((seed % 40) / 100),   // left-ish area (founder house region)
      yFrac: 0.38 + ((seed % 10) / 100),  // rooftop height
      delayS: 0,
      glyph: "🦉",
      label: "夜の梟",
    });
  }

  // ------------------------------------------------------------------
  // 🐸 Frog — stormy weather, road-side, 1-2 frogs.
  if (weather === "stormy") {
    const count = 1 + (rosterSeed % 2); // 1 or 2
    for (let i = 0; i < count; i++) {
      const seed = mixSeed(rosterSeed, CH_FROG + i);
      out.push({
        kind: "frog",
        xFrac: 0.3 + ((seed % 40) / 100),
        yFrac: 0.72 + ((seed % 8) / 100), // near ground / road
        delayS: i * 0.4,
        glyph: "🐸",
        label: "雨のカエル",
      });
    }
  }

  // ------------------------------------------------------------------
  // 🦋 Butterfly — spring/summer + daytime: 2-3 additional butterflies.
  if ((season === "spring" || season === "summer") && tod !== "night") {
    const count = 2 + (rosterSeed % 2); // 2 or 3
    for (let i = 0; i < count; i++) {
      const seed = mixSeed(rosterSeed, CH_BUTTERFLY + i);
      out.push({
        kind: "butterfly",
        xFrac: 0.1 + ((seed % 80) / 100),
        yFrac: 0.1 + ((seed % 30) / 100),
        delayS: -(i * 1.3 + ((seed % 5) / 10)), // stagger negative → pre-placed
        glyph: "🦋",
        label: "蝶",
      });
    }
  }

  // ------------------------------------------------------------------
  // 🐈 Cat — always present, seed-fixed to one house's window-sill.
  if (sims.length > 0) {
    const seed = mixSeed(rosterSeed, CH_CAT);
    // Pick a house index that is stable as long as roster seed doesn't change.
    out.push({
      kind: "cat",
      xFrac: 0.05 + ((seed % 85) / 100),
      yFrac: 0.52 + ((seed % 12) / 100), // window-sill area
      delayS: 0,
      glyph: "🐈",
      label: "窓辺の猫",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mixSeed(base: number, channel: number): number {
  return ((base ^ (channel * 0x9E3779B1)) * 2654435761) >>> 0;
}
