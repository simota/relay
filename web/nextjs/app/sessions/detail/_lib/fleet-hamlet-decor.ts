// Hamlet — visual decoration helpers.
//
// Shared, deterministic, side-effect-free utilities that drive the
// cozy-pastel visual layer added on top of the Hamlet views: time-of-day
// sky gradients, mood-driven card backgrounds, agent-kind clothing tints,
// and seeded placement of trees / flowers / birds around houses.
//
// All functions are pure; the same `seed` (typically a hashed session key)
// always produces the same decoration so houses don't "shuffle" on each
// re-render.

import type { MoodKey, SimCardModel } from "./fleet-hamlet";
import { hashStringToInt } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

export type TimeOfDay = "morning" | "noon" | "evening" | "night";

export interface SkyPalette {
  tod: TimeOfDay;
  /** CSS gradient string for the sky band. */
  sky: string;
  /** Hex/HSL string for the ground band. */
  grass: string;
  grassDark: string;
  /** "sun" or "moon" — drives which luminary glyph to render. */
  luminary: "sun" | "moon";
  /** Star count for night-only sparkle layer. */
  stars: number;
  /** Should streetlamps be lit? */
  lampsLit: boolean;
}

export function timeOfDay(date: Date = new Date()): TimeOfDay {
  const h = date.getHours();
  if (h >= 6 && h < 10) return "morning";
  if (h >= 10 && h < 16) return "noon";
  if (h >= 16 && h < 19) return "evening";
  return "night";
}

export function skyPalette(tod: TimeOfDay): SkyPalette {
  switch (tod) {
    case "morning":
      return {
        tod,
        sky: "linear-gradient(to bottom, #FFD9B3 0%, #FFE9C9 35%, #C6E8F7 100%)",
        grass: "#A8D070",
        grassDark: "#7CB342",
        luminary: "sun",
        stars: 0,
        lampsLit: false,
      };
    case "noon":
      return {
        tod,
        sky: "linear-gradient(to bottom, #BEE6FB 0%, #DCEEFC 50%, #F4FAFE 100%)",
        grass: "#9CCB66",
        grassDark: "#6EA844",
        luminary: "sun",
        stars: 0,
        lampsLit: false,
      };
    case "evening":
      return {
        tod,
        sky: "linear-gradient(to bottom, #FFB070 0%, #FF8FA3 45%, #9C6BBA 100%)",
        grass: "#789a4a",
        grassDark: "#4f6a30",
        luminary: "sun",
        stars: 0,
        lampsLit: true,
      };
    case "night":
      return {
        tod,
        sky: "linear-gradient(to bottom, #0D1B3D 0%, #1A2B55 55%, #0A1024 100%)",
        grass: "#384b2a",
        grassDark: "#1f2a16",
        luminary: "moon",
        stars: 16,
        lampsLit: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Mood → card gradient
// ---------------------------------------------------------------------------

export interface MoodGradient {
  /** Linear-gradient string usable as `background`. */
  bg: string;
  /** Optional pulse hint — true for moods that should animate the border. */
  pulse: boolean;
  /** Solid border tint (slightly stronger than the gradient). */
  border: string;
}

export function moodGradient(mood: MoodKey): MoodGradient {
  switch (mood) {
    case "happy":
      return {
        bg: "linear-gradient(135deg, hsla(48, 95%, 88%, 0.55) 0%, hsla(28, 90%, 80%, 0.45) 100%)",
        pulse: false,
        border: "hsla(38, 85%, 60%, 0.55)",
      };
    case "stressed":
      return {
        bg: "linear-gradient(135deg, hsla(0, 80%, 88%, 0.55) 0%, hsla(350, 80%, 78%, 0.5) 100%)",
        pulse: true,
        border: "hsla(355, 75%, 60%, 0.65)",
      };
    case "bored":
      return {
        bg: "linear-gradient(135deg, hsla(210, 20%, 88%, 0.5) 0%, hsla(200, 30%, 82%, 0.45) 100%)",
        pulse: false,
        border: "hsla(210, 20%, 60%, 0.45)",
      };
    case "energized":
      return {
        bg: "linear-gradient(135deg, hsla(85, 80%, 80%, 0.55) 0%, hsla(170, 65%, 72%, 0.5) 100%)",
        pulse: false,
        border: "hsla(150, 65%, 50%, 0.6)",
      };
    case "focused":
      return {
        bg: "linear-gradient(135deg, hsla(260, 60%, 85%, 0.5) 0%, hsla(280, 55%, 78%, 0.45) 100%)",
        pulse: false,
        border: "hsla(270, 50%, 60%, 0.55)",
      };
    case "asleep":
      return {
        bg: "linear-gradient(135deg, hsla(230, 35%, 30%, 0.35) 0%, hsla(245, 40%, 22%, 0.45) 100%)",
        pulse: false,
        border: "hsla(235, 30%, 45%, 0.55)",
      };
  }
}

// ---------------------------------------------------------------------------
// Agent kind → clothing palette
// ---------------------------------------------------------------------------

export interface ClothingColors {
  shirt: string;
  shirtDark: string;
  /** Subtle accent stripe / collar. */
  accent: string;
}

export function clothingForAgent(kind: SimCardModel["sessionType"]): ClothingColors {
  // Hue families: claude=blue, codex=green, antigravity=purple,
  // anything else=warm neutral.
  if (kind === "claude") {
    return {
      shirt: "hsl(215, 65%, 58%)",
      shirtDark: "hsl(218, 70%, 42%)",
      accent: "hsl(208, 80%, 75%)",
    };
  }
  if (kind === "codex") {
    return {
      shirt: "hsl(135, 50%, 48%)",
      shirtDark: "hsl(138, 55%, 32%)",
      accent: "hsl(120, 60%, 75%)",
    };
  }
  if (kind === "antigravity") {
    return {
      shirt: "hsl(275, 55%, 58%)",
      shirtDark: "hsl(278, 60%, 40%)",
      accent: "hsl(290, 65%, 78%)",
    };
  }
  return {
    shirt: "hsl(30, 45%, 55%)",
    shirtDark: "hsl(28, 50%, 38%)",
    accent: "hsl(38, 65%, 75%)",
  };
}

// ---------------------------------------------------------------------------
// Deterministic decor placement
// ---------------------------------------------------------------------------

export type TreeKind = "pine" | "oak" | "bush";

export interface YardDecor {
  trees: { kind: TreeKind; offsetX: number; scale: number }[];
  flowers: { offsetX: number; hue: number }[];
  /** Bird perches on the roof? */
  hasBird: boolean;
  /** Mailbox present? */
  hasMailbox: boolean;
  /** First 3 letters of the repo name, for the nameplate. */
  plate: string;
}

export function yardDecorFor(sim: SimCardModel): YardDecor {
  const seed = hashStringToInt(sim.key);
  const r = mulberry32(seed);
  const treeCount = 1 + Math.floor(r() * 2); // 1-2 trees
  const trees: YardDecor["trees"] = [];
  for (let i = 0; i < treeCount; i++) {
    const kindIdx = Math.floor(r() * 3);
    const kind: TreeKind = kindIdx === 0 ? "pine" : kindIdx === 1 ? "oak" : "bush";
    trees.push({
      kind,
      // Distribute trees on left/right of the house cell (-1..1 fraction).
      offsetX: i === 0 ? -0.5 - r() * 0.25 : 0.55 + r() * 0.2,
      scale: 0.85 + r() * 0.3,
    });
  }
  const flowerCount = 2 + Math.floor(r() * 2); // 2-3 flowers
  const flowers: YardDecor["flowers"] = [];
  for (let i = 0; i < flowerCount; i++) {
    flowers.push({
      offsetX: -0.3 + (i / Math.max(1, flowerCount - 1)) * 0.6,
      hue: Math.floor(r() * 360),
    });
  }
  return {
    trees,
    flowers,
    hasBird: r() > 0.55,
    hasMailbox: r() > 0.35,
    plate: (sim.repo ?? sim.sessionType).slice(0, 3).toUpperCase(),
  };
}

// ---------------------------------------------------------------------------
// Small deterministic RNG (mulberry32 — public domain)
// ---------------------------------------------------------------------------

function mulberry32(a: number): () => number {
  let t = a >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Furniture emoji per room
// ---------------------------------------------------------------------------

export function furnitureForRoom(kind: string): string[] {
  switch (kind) {
    case "living":
      return ["\u{1F6CB}", "\u{1F4FA}", "\u{1FAB4}"]; // sofa, TV, potted plant
    case "workshop":
      return ["\u{1F527}", "\u{1FA9B}", "\u{2699}️"]; // wrench, screwdriver, gear
    case "library":
      return ["\u{1F4DA}", "\u{1FA91}", "\u{1F4A1}"]; // books, chair, bulb
    case "nursery":
      return ["\u{1F9F8}", "\u{1F37C}", "\u{1F6CF}️"]; // teddy, bottle, bed
    case "trophy":
      return ["\u{1F3C6}", "\u{1F947}", "\u{1F396}️"]; // trophy, gold, medal
    case "study":
      return ["\u{1F393}", "\u{1F4D0}", "\u{1F4CA}"]; // grad-cap, ruler, chart
    case "reception":
      return ["\u{1FA91}", "\u{1F339}", "\u{1FAD6}"]; // chair, rose, teapot
    default:
      return [];
  }
}
