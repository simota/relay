// Hamlet — Room Scene "Accumulated Life" layer (R3: C1 + C2).
//
// Pure derivers that turn the resident's cumulative work + relationships into
// decorative items inside their room:
//
//   C1 Achievement Decor   — top skills with Lv ≥ 3 become framed certificates,
//                            trophies, crowns. The tier escalates with level.
//   C2 Family Photos       — parent / child / best-friend relationships become
//                            silhouette photo frames hung on the wall.
//
// Both shapes are deterministic given (card, detail, allCards, now).

import type { SessionDetail } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";
import {
  computeRelationships,
  type Relationship,
  type RelationshipKind,
} from "./fleet-hamlet-relations";
import {
  computeSkills,
  topSkills,
  type Skill,
} from "./fleet-hamlet-skills";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tier escalation by skill level — controls the decor that gets emitted. */
export type AchievementTier = "basic" | "gold" | "champion" | "master";

export interface Achievement {
  skillId: string;
  label: string;
  icon: string;
  level: number;
  tier: AchievementTier;
  /** Star count to render inside the frame (0..3). */
  stars: number;
}

export interface AchievementBundle {
  /** Wall-mounted frames (always present when there's any Lv ≥ 3 skill). */
  frames: Achievement[];
  /** True when any skill is Lv ≥ 7 — render a small trophy on the desk. */
  hasTrophy: boolean;
  /** True when any skill is Lv ≥ 9 — render a larger trophy + red carpet. */
  hasGrandTrophy: boolean;
  /** True when any skill is Lv = 10 — render the crown display. */
  hasCrown: boolean;
  /** True when any skill is Lv ≥ 9 — render the red carpet. */
  hasCarpet: boolean;
}

/** A wall-mounted photo frame describing one important relationship. */
export interface RelationshipFrame {
  /** Stable identifier (target session key) — used as React key. */
  key: string;
  kind: RelationshipKind;
  /** "Parent" / "Child" / "Best Friend". */
  caption: string;
  /** Avatar hue from the target so each photo looks like a different person. */
  hue: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const ACH_MIN_LEVEL = 3;
const ACH_MAX_FRAMES = 5;
const ACH_MAX_FRAMES_DEFAULT = 3;
const FRAME_MIN_SCORE_FAMILY = 85;
const FRAME_MIN_SCORE_FRIEND = 65;
const FRAME_MAX_DEFAULT = 3;
const FRAME_MAX_RECEPTION = 6;

// ---------------------------------------------------------------------------
// C1 — Achievement decor
// ---------------------------------------------------------------------------

export function tierForLevel(level: number): AchievementTier {
  if (level >= 10) return "master";
  if (level >= 9) return "champion";
  if (level >= 7) return "gold";
  return "basic";
}

function starsForLevel(level: number): number {
  if (level >= 9) return 3;
  if (level >= 7) return 3;
  if (level >= 5) return 1;
  return 0;
}

/**
 * Pick the top 3..5 skills with Lv ≥ 3 from the resident's skill set.
 * `maxFrames` lets reception-style rooms surface more (we still cap at 5).
 */
export function deriveAchievements(
  card: SimCardModel,
  detail: SessionDetail | undefined,
  maxFrames: number = ACH_MAX_FRAMES_DEFAULT,
): AchievementBundle {
  const skills = computeSkills(card, detail);
  const qualifying = skills.filter((s) => s.level >= ACH_MIN_LEVEL);
  if (qualifying.length === 0) {
    return {
      frames: [],
      hasTrophy: false,
      hasGrandTrophy: false,
      hasCrown: false,
      hasCarpet: false,
    };
  }
  const cap = Math.max(1, Math.min(ACH_MAX_FRAMES, maxFrames));
  const top = topSkills(qualifying, cap);
  const frames: Achievement[] = top.map((sk) => skillToAchievement(sk));
  const maxLevel = frames.reduce((m, a) => (a.level > m ? a.level : m), 0);
  return {
    frames,
    hasTrophy: maxLevel >= 7,
    hasGrandTrophy: maxLevel >= 9,
    hasCrown: maxLevel >= 10,
    hasCarpet: maxLevel >= 9,
  };
}

function skillToAchievement(sk: Skill): Achievement {
  return {
    skillId: sk.id,
    label: sk.label,
    icon: sk.icon,
    level: sk.level,
    tier: tierForLevel(sk.level),
    stars: starsForLevel(sk.level),
  };
}

// ---------------------------------------------------------------------------
// C2 — Family / Best Friend photo frames
// ---------------------------------------------------------------------------

/**
 * Extract a small set of photo-worthy relationships:
 *   - up to 1 parent (score ≥ 85)
 *   - up to 1 best-friend cluster (score ≥ 65)
 *   - the rest filled with children (score ≥ 85)
 *
 * Reception rooms can show up to 6 frames; everywhere else caps at 3.
 */
export function deriveFrames(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
  now: number,
  maxFrames: number = FRAME_MAX_DEFAULT,
): RelationshipFrame[] {
  if (allCards.length === 0) return [];
  const rels = computeRelationships(card, allCards, now);
  const cap = Math.max(1, Math.min(FRAME_MAX_RECEPTION, maxFrames));

  const out: RelationshipFrame[] = [];
  const seen = new Set<string>();

  // 1. Parent.
  const parent = rels.find(
    (r) => r.kind === "family-parent" && r.score >= FRAME_MIN_SCORE_FAMILY,
  );
  if (parent) {
    out.push(frameFromRelationship(parent, "Parent"));
    seen.add(parent.target.key);
  }

  // 2. Best friend (highest non-family with score ≥ 65).
  const friend = rels.find(
    (r) =>
      !seen.has(r.target.key) &&
      r.score >= FRAME_MIN_SCORE_FRIEND &&
      r.kind !== "family-parent" &&
      r.kind !== "family-child",
  );
  if (friend) {
    out.push(frameFromRelationship(friend, "Best Friend"));
    seen.add(friend.target.key);
  }

  // 3. Fill remaining slots with children (≥ family score).
  for (const r of rels) {
    if (out.length >= cap) break;
    if (seen.has(r.target.key)) continue;
    if (r.kind === "family-child" && r.score >= FRAME_MIN_SCORE_FAMILY) {
      out.push(frameFromRelationship(r, "Child"));
      seen.add(r.target.key);
    }
  }

  return out.slice(0, cap);
}

/** Reception rooms show more photos — convenience wrapper. */
export function frameMaxForRoom(roomKind: string): number {
  return roomKind === "reception" ? FRAME_MAX_RECEPTION : FRAME_MAX_DEFAULT;
}

function frameFromRelationship(
  rel: Relationship,
  caption: string,
): RelationshipFrame {
  return {
    key: rel.target.key,
    kind: rel.kind,
    caption,
    hue: rel.target.hue,
  };
}
