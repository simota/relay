// Fleet Hamlet — avatar expression mapping.
//
// Pure mapping from a MoodKey to the visual primitives every avatar SVG
// renders (eye shape / mouth shape / eyebrow shape / overall pose).
//
// The avatar components consume this map and switch SVG paths accordingly,
// keeping the renderers free of mood-specific branching beyond a single
// switch per primitive.

import type { MoodKey } from "./fleet-hamlet";

export type EyeShape =
  | "normal" // small black dot + white highlight
  | "smile"  // inverted U (squinty happy)
  | "half"   // short horizontal line (bored, half open)
  | "closed" // closed line + Zzz nearby (asleep)
  | "narrow" // thin horizontal slit (focused)
  | "swirl"; // spiral (stressed / dizzy)

export type MouthShape =
  | "small-smile" // small upward curve
  | "big-smile"   // big U
  | "flat"        // short straight line
  | "frown"       // downward curve
  | "open-yawn";  // small open circle (asleep)

export type BrowShape =
  | "none"
  | "angle-up"    // angled outward, stressed
  | "angle-down"  // angled inward, focused / determined
  | "straight";   // flat focused

export type AvatarPose =
  | "idle"          // default standing
  | "wave"          // right arm raised waving (happy)
  | "crouch"        // forward lean, hand to head (stressed)
  | "sigh"          // slight droop (bored)
  | "cross-arms"   // arms crossed over chest (focused)
  | "step-forward" // one leg forward (energized)
  | "sleeping";    // closed eyes + Zzz (asleep)

export interface AvatarExpression {
  eye: EyeShape;
  mouth: MouthShape;
  brow: BrowShape;
  pose: AvatarPose;
  /** If true, the avatar should render the small sweat-drop overlay. */
  showSweat: boolean;
  /** If true, the avatar should render the Zzz overlay. */
  showZzz: boolean;
  /** Body lean in degrees; positive = back, negative = forward. */
  leanDeg: number;
}

export function getExpressionForMood(mood: MoodKey): AvatarExpression {
  switch (mood) {
    case "happy":
      return {
        eye: "smile",
        mouth: "big-smile",
        brow: "none",
        pose: "wave",
        showSweat: false,
        showZzz: false,
        leanDeg: 0,
      };
    case "stressed":
      return {
        eye: "swirl",
        mouth: "frown",
        brow: "angle-up",
        pose: "crouch",
        showSweat: true,
        showZzz: false,
        leanDeg: -4,
      };
    case "bored":
      return {
        eye: "half",
        mouth: "flat",
        brow: "straight",
        pose: "sigh",
        showSweat: false,
        showZzz: false,
        leanDeg: 2,
      };
    case "focused":
      return {
        eye: "narrow",
        mouth: "flat",
        brow: "angle-down",
        pose: "cross-arms",
        showSweat: false,
        showZzz: false,
        leanDeg: 0,
      };
    case "energized":
      return {
        eye: "normal",
        mouth: "small-smile",
        brow: "straight",
        pose: "step-forward",
        showSweat: false,
        showZzz: false,
        leanDeg: -1,
      };
    case "asleep":
      return {
        eye: "closed",
        mouth: "open-yawn",
        brow: "none",
        pose: "sleeping",
        showSweat: false,
        showZzz: true,
        leanDeg: 0,
      };
  }
}

/**
 * Six-way hair style enum. The avatar renderers must map each to a
 * deterministic SVG shape.
 */
export type HairStyle = "short" | "wavy" | "bob" | "topknot" | "curly" | "bald";

const HAIR_STYLES: readonly HairStyle[] = [
  "short",
  "wavy",
  "bob",
  "topknot",
  "curly",
  "bald",
] as const;

export function hairStyleFromSeed(seed: number): HairStyle {
  const idx = (seed >>> 16) % HAIR_STYLES.length;
  return HAIR_STYLES[idx] ?? "short";
}

/**
 * Which hair styles let the ears show through. Bob / curly cover the ears;
 * topknot / wavy / short / bald all show them.
 */
export function showsEars(style: HairStyle): boolean {
  return style !== "bob" && style !== "curly";
}
