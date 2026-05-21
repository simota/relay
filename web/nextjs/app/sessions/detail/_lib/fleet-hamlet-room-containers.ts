// Hamlet — Room Scene R6 G2: Container Contents.
//
// "What's in the bookshelf / fridge?" derived from a resident's skill XP,
// age, and Hunger need so the wall-mounted containers actually grow with
// the session instead of being static furniture.
//
//   - bookCount: capped at 20; mixes total skill XP with age in days so a
//     fresh-but-busy session and an old-but-quiet one both fill in over time.
//   - bookHues:  small palette of hues, hashed off the top skill icons, so
//     each shelf reads as "this resident's library".
//   - fridgeLevel: 0..3 buckets from Hunger.
//   - fridgeItems: food emoji bound to the bucket — empty bucket leaves the
//     fridge bare instead of just showing fewer items.

import type { SessionDetail } from "@/lib/api";
import { hashStringToInt, type SimCardModel } from "./fleet-hamlet";
import { computeSkills, topSkills, type Skill } from "./fleet-hamlet-skills";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContainerContents {
  /** 0..MAX_BOOKS — how many books the shelf shows. */
  bookCount: number;
  /** HSL hue values (0..360) for the book spines. */
  bookHues: readonly number[];
  /** 0..3 — fullness bucket. */
  fridgeLevel: number;
  /** Emoji shown inside the fridge (length == fridgeLevel for level 1-3). */
  fridgeItems: readonly string[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const MAX_BOOKS = 20;
const XP_PER_BOOK = 30;
const DAY_MS = 86_400_000;

/** Food emoji per fridge level — index = fridgeLevel. Level 0 = empty. */
export const FRIDGE_ITEMS_BY_LEVEL: readonly string[][] = [
  [],
  ["🍎"],
  ["🍎", "🥗"],
  ["🍎", "🥗", "🥖", "🥚", "🍷"],
];

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function deriveContainerContents(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): ContainerContents {
  // Skill-driven book count.
  const skills = computeSkills(card, detail);
  const totalXp = skills.reduce((acc, s) => acc + s.xp, 0);
  const ageDays = Math.max(0, (Date.now() - card.bornAt) / DAY_MS);
  const rawBooks =
    Math.floor(totalXp / XP_PER_BOOK) + Math.floor(ageDays * 2);
  const bookCount = Math.max(0, Math.min(MAX_BOOKS, rawBooks));

  // Hue palette from the top 5 skill icons — hash each icon so the same
  // skill always paints the same spine colour across rooms.
  const top = topSkills(skills, 5);
  const bookHues =
    top.length > 0
      ? top.map((s) => hueFromSkill(s, card.hue))
      : // Fallback to the resident's own hue ramp when no skills exist.
        [card.hue, (card.hue + 40) % 360, (card.hue + 80) % 360];

  // Hunger → fridge bucket.
  const hunger = needValue(card, "hunger");
  const fridgeLevel = hunger >= 80 ? 3 : hunger >= 50 ? 2 : hunger >= 25 ? 1 : 0;
  // Level 3 shows the full set; lower levels show a leading slice so the
  // emoji density visibly drops as the resident "eats" through context.
  const fridgeItems =
    fridgeLevel === 3
      ? FRIDGE_ITEMS_BY_LEVEL[3]!
      : fridgeLevel > 0
        ? FRIDGE_ITEMS_BY_LEVEL[3]!.slice(0, fridgeLevel)
        : [];

  return { bookCount, bookHues, fridgeLevel, fridgeItems };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hueFromSkill(skill: Skill, fallback: number): number {
  // Hash the skill icon string so the palette varies but stays deterministic.
  const h = hashStringToInt(skill.icon || skill.id) % 360;
  if (h < 0) return (h + 360) % 360;
  return h === 0 ? fallback : h;
}

function needValue(
  card: SimCardModel,
  kind: SimCardModel["needs"][number]["key"],
): number {
  const need = card.needs.find((n) => n.key === kind);
  return need ? need.value : 0;
}
