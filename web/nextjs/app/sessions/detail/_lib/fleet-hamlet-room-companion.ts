// Hamlet — Room Scene "Companion / Emotion" layer (R5: F1 + G1).
//
// Pure derivers for:
//
//   F1 Pet            — `pets` array (kind + state + count) based on the
//                       resident's age and recent silence. Spawn-heavy
//                       parents get a second pet.
//   G1 Mood Wallpaper — mood-coloured wall palette + optional dimmed lamp.

import type { SimCardModel, MoodKey } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PetKind = "cat" | "dog" | "bird" | "hamster";
export type PetState = "awake" | "asleep";

export interface Pet {
  kind: PetKind;
  state: PetState;
  /** 1..2 — when a parent has many subagents we render two of them. */
  index: number;
}

export interface PetBundle {
  /** 0..2 pets. Empty when the resident is too young (< 1 day). */
  pets: Pet[];
}

export interface MoodPalette {
  /** Wall hue (0..360). */
  wallH: number;
  /** Wall saturation 0..100. */
  wallS: number;
  /** Wall lightness 0..100. */
  wallL: number;
  /** Slight darker variant for the wall bottom band. */
  wallBottomL: number;
  /** Optional warm overlay — used by Asleep to dim the room. */
  dimOverlay: boolean;
  /** Used by lamp glow for moods that want warmer light. */
  warmLamp: boolean;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const PET_MIN_AGE_MS = 24 * 60 * 60 * 1000; // 1 day
const PET_SLEEP_SILENCE_MS = 30 * 60 * 1000; // 30 min
const PET_DOUBLE_SPAWN_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// F1 — Pet derivation
// ---------------------------------------------------------------------------

export function petKindForAgent(
  sessionType: SimCardModel["sessionType"],
): PetKind {
  if (sessionType === "claude") return "cat";
  if (sessionType === "codex") return "dog";
  if (sessionType === "antigravity") return "bird";
  return "hamster";
}

/**
 * Decide pet roster for a resident.
 *
 * `subagentCount` = number of children for this card in the neighborhood
 * (filled in by the caller — defaults to 0 when unknown).
 */
export function derivePets(
  card: SimCardModel,
  now: number,
  subagentCount: number = 0,
): PetBundle {
  const ageMs = Math.max(0, now - card.bornAt);
  if (ageMs < PET_MIN_AGE_MS) return { pets: [] };

  const silenceMs = Math.max(0, now - card.lastActiveAt);
  const state: PetState = silenceMs >= PET_SLEEP_SILENCE_MS ? "asleep" : "awake";
  const kind = petKindForAgent(card.sessionType);

  const pets: Pet[] = [{ kind, state, index: 0 }];
  if (subagentCount >= PET_DOUBLE_SPAWN_THRESHOLD) {
    pets.push({ kind, state, index: 1 });
  }
  return { pets };
}

/**
 * Count the immediate children of `card` inside `allCards`. Used by
 * `derivePets` to decide whether a second pet should appear.
 */
export function countSubagents(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
): number {
  let count = 0;
  for (const c of allCards) {
    if (c.key === card.key) continue;
    if (c.parentSessionId && c.parentSessionId === card.sessionId) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// G1 — Mood palette
// ---------------------------------------------------------------------------

const MOOD_PALETTES: Record<MoodKey, MoodPalette> = {
  happy: {
    wallH: 40,
    wallS: 50,
    wallL: 88,
    wallBottomL: 80,
    dimOverlay: false,
    warmLamp: true,
  },
  stressed: {
    wallH: 10,
    wallS: 45,
    wallL: 86,
    wallBottomL: 78,
    dimOverlay: false,
    warmLamp: false,
  },
  bored: {
    wallH: 220,
    wallS: 8,
    wallL: 84,
    wallBottomL: 76,
    dimOverlay: false,
    warmLamp: false,
  },
  energized: {
    wallH: 95,
    wallS: 40,
    wallL: 87,
    wallBottomL: 79,
    dimOverlay: false,
    warmLamp: false,
  },
  focused: {
    wallH: 220,
    wallS: 25,
    wallL: 82,
    wallBottomL: 74,
    dimOverlay: false,
    warmLamp: false,
  },
  asleep: {
    wallH: 225,
    wallS: 30,
    wallL: 35,
    wallBottomL: 28,
    dimOverlay: true,
    warmLamp: true,
  },
};

export function deriveMoodPalette(mood: MoodKey): MoodPalette {
  return MOOD_PALETTES[mood];
}
