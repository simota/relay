// Hamlet — Room Scene "Time / Season Variety" layer (R4: E1 + E2).
//
// Pure derivers that map the real-world local date into seasonal furniture
// and food on the table:
//
//   E1 Seasonal Decor — spring=cherry blossoms, summer=fan + watermelon,
//                        autumn=pumpkin + maple, winter=kotatsu + Christmas
//                        tree (December only) + fireplace flame.
//   E2 Meal Table     — morning=coffee+bread, noon=lunch plate,
//                        afternoon=tea, evening=PJs, late-night=dango.
//
// Deterministic given `now`; no resident state required.

import { currentSeason, type Season } from "./fleet-hamlet-particles";
import { timeOfDay, type TimeOfDay } from "./fleet-hamlet-decor";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SeasonalKind =
  | "spring-blossom"
  | "summer-fan"
  | "autumn-pumpkin"
  | "winter-kotatsu";

export type MealKind =
  | "breakfast"
  | "lunch"
  | "tea"
  | "sleepwear"
  | "night-snack";

export interface SeasonalDecor {
  /** Primary visual placed on the floor / corner. */
  kind: SeasonalKind;
  /** Display label — used in aria-label / debug. */
  label: string;
  /** Primary emoji shown above the SVG props. */
  emoji: string;
  /** Secondary accent emoji (small companion glyph). */
  accentEmoji?: string;
}

export interface MealItem {
  kind: MealKind;
  label: string;
  /** Two emoji glyphs (food + drink/companion). */
  primary: string;
  secondary?: string;
}

export interface TemporalDecor {
  season: Season;
  tod: TimeOfDay;
  /** December = christmas tree extra. */
  isChristmas: boolean;
  seasonal: SeasonalDecor;
  meal: MealItem;
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

const SEASONAL_BY_SEASON: Record<Season, SeasonalDecor> = {
  spring: {
    kind: "spring-blossom",
    label: "Cherry blossom vase",
    emoji: "🌸",
    accentEmoji: "🌷",
  },
  summer: {
    kind: "summer-fan",
    label: "Electric fan",
    emoji: "🍉",
    accentEmoji: "🌻",
  },
  autumn: {
    kind: "autumn-pumpkin",
    label: "Pumpkin and maple",
    emoji: "🎃",
    accentEmoji: "🍁",
  },
  winter: {
    kind: "winter-kotatsu",
    label: "Kotatsu",
    emoji: "🧣",
    accentEmoji: "❄️",
  },
};

const MEAL_LABELS: Record<MealKind, MealItem> = {
  breakfast: {
    kind: "breakfast",
    label: "Morning coffee + bread",
    primary: "☕",
    secondary: "🥖",
  },
  lunch: {
    kind: "lunch",
    label: "Lunch plate",
    primary: "🍱",
  },
  tea: {
    kind: "tea",
    label: "Afternoon tea",
    primary: "🫖",
    secondary: "🍪",
  },
  sleepwear: {
    kind: "sleepwear",
    label: "Pyjamas",
    primary: "🛌",
    secondary: "🧦",
  },
  "night-snack": {
    kind: "night-snack",
    label: "Moon-viewing dango",
    primary: "🍡",
    secondary: "🌕",
  },
};

// ---------------------------------------------------------------------------
// Public — top-level derivation
// ---------------------------------------------------------------------------

export function deriveTemporal(now: number): TemporalDecor {
  const date = new Date(now);
  const season = currentSeason(date);
  const tod = timeOfDay(date);
  const isChristmas = date.getMonth() === 11; // December
  const seasonal = SEASONAL_BY_SEASON[season];
  const meal = MEAL_LABELS[mealForHour(date.getHours())];
  return { season, tod, isChristmas, seasonal, meal };
}

/** Map local hour to a meal kind — matches the recipe spec. */
export function mealForHour(hour: number): MealKind {
  if (hour >= 5 && hour < 10) return "breakfast";
  if (hour >= 10 && hour < 14) return "lunch";
  if (hour >= 14 && hour < 17) return "tea";
  if (hour >= 17 && hour < 22) return "sleepwear";
  return "night-snack";
}
