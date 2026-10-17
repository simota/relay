"use client";

// Fleet Hamlet — shared 3D avatar face / body primitives (Three.js).
//
// All "person" sprites in Hamlet (Sim Card, Neighborhood, Park, Room,
// Window-through children) compose the Three.js 3D character engine defined
// in `fleet-hamlet-three-character.tsx`.
//
// `HeadFace`, `BodyTorso`, and `HamletAvatar` mount the Three.js `<canvas>`
// inside an SVG `<foreignObject>` when used inside an `<svg>` group, while
// HTML-level callers can also mount `ThreeCharacterView` directly.

import type { ReactNode } from "react";
import type { AvatarParts, SimCardModel } from "../_lib/fleet-hamlet";
import type {
  AvatarExpression,
  AvatarPose,
} from "../_lib/fleet-hamlet-avatar-expression";
import type {
  BeardKind,
  EarringKind,
  GlassesKind,
  MustacheKind,
  ScarfKind,
} from "../_lib/fleet-hamlet-particles";
import {
  ThreeCharacterView,
  type CharacterClothingColors,
  type CharacterStylePreset,
} from "./fleet-hamlet-three-character";

export { ThreeCharacterView } from "./fleet-hamlet-three-character";

// ---------------------------------------------------------------------------
// Shared palette helpers
// ---------------------------------------------------------------------------

export type ClothingColors = CharacterClothingColors;
export type AvatarStylePreset = CharacterStylePreset;

export function clothingForAgent(
  kind: SimCardModel["sessionType"],
): ClothingColors {
  return clothingForStyle(kind, "default");
}

export function clothingForStyle(
  kind: SimCardModel["sessionType"],
  preset: AvatarStylePreset = "default",
): ClothingColors {
  if (preset === "taisho-wagara") {
    return {
      shirt: "hsl(188, 48%, 42%)",
      shirtDark: "hsl(205, 45%, 24%)",
      accent: "hsl(38, 84%, 76%)",
    };
  }
  if (preset === "occult-academy") {
    return {
      shirt: "hsl(248, 26%, 26%)",
      shirtDark: "hsl(252, 32%, 15%)",
      accent: "hsl(274, 68%, 72%)",
    };
  }
  if (kind === "claude")
    return {
      shirt: "hsl(215, 65%, 58%)",
      shirtDark: "hsl(218, 70%, 42%)",
      accent: "hsl(208, 80%, 75%)",
    };
  if (kind === "codex")
    return {
      shirt: "hsl(135, 50%, 48%)",
      shirtDark: "hsl(138, 55%, 32%)",
      accent: "hsl(120, 60%, 75%)",
    };
  if (kind === "antigravity")
    return {
      shirt: "hsl(275, 55%, 58%)",
      shirtDark: "hsl(278, 60%, 40%)",
      accent: "hsl(290, 65%, 78%)",
    };
  return {
    shirt: "hsl(30, 45%, 55%)",
    shirtDark: "hsl(28, 50%, 38%)",
    accent: "hsl(38, 65%, 75%)",
  };
}

export function avatarStyleFromSeed(
  seed: number,
  kind: SimCardModel["sessionType"],
): AvatarStylePreset {
  const bucket = Math.abs(((seed >>> 4) ^ (seed >>> 11) ^ seed) % 5);
  if (bucket === 1 || (kind === "codex" && bucket === 3)) return "taisho-wagara";
  if (bucket === 2 || (kind === "antigravity" && bucket === 4)) return "occult-academy";
  return "default";
}

// ---------------------------------------------------------------------------
// HeadFace — 3D sculpted head with hair / ears / cheeks / 3D eyes / brows.
// Centered on (0, 0) inside a [-radius*1.6, +radius*1.6] box.
// ---------------------------------------------------------------------------

export interface HeadFaceProps {
  parts: AvatarParts;
  expression: AvatarExpression;
  /** Half-width radius of the head in SVG units. Default 12. */
  radius?: number;
  haloColor?: string;
  enableBlink?: boolean;
  enableCheeks?: boolean;
  enableEyeTrack?: boolean;
  glasses?: GlassesKind;
  mustache?: MustacheKind;
  beard?: BeardKind;
  earring?: EarringKind;
}

export function HeadFace({
  parts,
  expression,
  radius = 12,
  haloColor,
  enableBlink = true,
  enableCheeks = true,
  enableEyeTrack = true,
  glasses = "none",
  mustache = "none",
  beard = "none",
  earring = "none",
}: HeadFaceProps) {
  void haloColor;
  const boxSize = Math.max(16, Math.round(radius * 3.1));
  const defaultClothes = clothingForAgent("claude");
  return (
    <g aria-hidden>
      <foreignObject
        x={-boxSize / 2}
        y={-boxSize * 0.54}
        width={boxSize}
        height={boxSize}
        style={{ overflow: "visible" }}
      >
        <ThreeCharacterView
          width={boxSize}
          height={boxSize}
          parts={parts}
          expression={expression}
          clothing={defaultClothes}
          mode="head"
          enableBlink={enableBlink}
          enableCheeks={enableCheeks}
          enableEyeTrack={enableEyeTrack}
          glasses={glasses}
          mustache={mustache}
          beard={beard}
          earring={earring}
          showGroundShadow={false}
        />
      </foreignObject>
    </g>
  );
}

// ---------------------------------------------------------------------------
// BodyTorso — 3D articulated torso, collar, arms, legs, shoes.
// ---------------------------------------------------------------------------

export interface BodyTorsoProps {
  clothing: ClothingColors;
  pose: AvatarPose;
  stylePreset?: AvatarStylePreset;
  height?: number;
  enableRim?: boolean;
  enableLegs?: boolean;
  scarf?: ScarfKind;
}

export function BodyTorso({
  clothing,
  pose,
  stylePreset = "default",
  height = 32,
  scarf = "none",
}: BodyTorsoProps) {
  const h = Math.max(16, Math.round(height));
  const w = Math.max(16, Math.round(h * 0.85));
  const dummyParts: AvatarParts = {
    skinHue: 28,
    hairHue: 25,
    hairStyle: 0,
    eyeShape: 0,
    hair: "short",
    hasEars: true,
    cheekHue: 355,
    blinkDelay: 0,
    breatheDelay: 0,
    headRatio: 5.5,
  };
  const dummyExpr: AvatarExpression = {
    eye: "normal",
    mouth: "small-smile",
    brow: "none",
    pose,
    showSweat: false,
    showZzz: false,
    leanDeg: 0,
  };
  return (
    <g aria-hidden>
      <foreignObject
        x={-w / 2}
        y={0}
        width={w}
        height={h}
        style={{ overflow: "visible" }}
      >
        <ThreeCharacterView
          width={w}
          height={h}
          parts={dummyParts}
          expression={dummyExpr}
          clothing={clothing}
          stylePreset={stylePreset}
          mode="body"
          scarf={scarf}
          showGroundShadow={false}
        />
      </foreignObject>
    </g>
  );
}

// ---------------------------------------------------------------------------
// HamletAvatar — Full-body 3D articulated character wrapper.
// ---------------------------------------------------------------------------

export interface HamletAvatarProps {
  parts: AvatarParts;
  expression: AvatarExpression;
  clothing: ClothingColors;
  stylePreset?: AvatarStylePreset;
  height: number;
  enableBreathe?: boolean;
  enableBlink?: boolean;
  enableCheeks?: boolean;
  haloColor?: string;
  bodyOnly?: false;
  children?: ReactNode;
  transform?: string;
  glasses?: GlassesKind;
  mustache?: MustacheKind;
  beard?: BeardKind;
  earring?: EarringKind;
  scarf?: ScarfKind;
}

export function HamletAvatar({
  parts,
  expression,
  clothing,
  stylePreset = "default",
  height,
  enableBreathe = true,
  enableBlink = true,
  enableCheeks = true,
  haloColor,
  children,
  transform,
  glasses = "none",
  mustache = "none",
  beard = "none",
  earring = "none",
  scarf = "none",
}: HamletAvatarProps) {
  void haloColor;
  const h = Math.max(24, Math.round(height));
  const w = Math.max(20, Math.round(h * 0.78));
  return (
    <g transform={transform} aria-hidden>
      <foreignObject
        x={-w / 2}
        y={0}
        width={w}
        height={h}
        style={{ overflow: "visible" }}
      >
        <ThreeCharacterView
          width={w}
          height={h}
          parts={parts}
          expression={expression}
          clothing={clothing}
          stylePreset={stylePreset}
          mode="full"
          enableBreathe={enableBreathe}
          enableBlink={enableBlink}
          enableCheeks={enableCheeks}
          glasses={glasses}
          mustache={mustache}
          beard={beard}
          earring={earring}
          scarf={scarf}
          showGroundShadow={false}
        />
      </foreignObject>
      {children}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Shared keyframes — kept for CSS consumers across Hamlet
// ---------------------------------------------------------------------------

export const HAMLET_AVATAR_CSS = `
@keyframes relayHamletIdleBreathe {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1.5px); }
}
@keyframes relayHamletBlink {
  0%, 92%, 100% { transform: scaleY(1); }
  94%, 96%      { transform: scaleY(0.08); }
}
@keyframes relayHamletSweat {
  0%, 70%, 100% { transform: translateY(0); opacity: 0; }
  10%           { transform: translateY(0);   opacity: 1; }
  50%           { transform: translateY(4px); opacity: 0.95; }
}
@keyframes relayHamletSleepZ {
  0%, 100% { transform: translateY(0) scale(1);   opacity: 0.85; }
  50%      { transform: translateY(-3px) scale(1.1); opacity: 1; }
}
@keyframes relayHamletWaveHand {
  0%, 100% { transform: rotate(-12deg); }
  50%      { transform: rotate(18deg); }
}
@keyframes relayHamletWalk4Frame {
  0%   { transform: translateY(0)    rotate(0deg); }
  25%  { transform: translateY(-1.5px) rotate(-2deg); }
  50%  { transform: translateY(0)    rotate(0deg); }
  75%  { transform: translateY(-1.5px) rotate(2deg); }
  100% { transform: translateY(0)    rotate(0deg); }
}
@keyframes relayHamletSquashStretchJump {
  0%   { transform: scale(1, 1)       translateY(0); }
  10%  { transform: scale(1.1, 0.85)  translateY(0); }
  30%  { transform: scale(0.9, 1.15)  translateY(-6px); }
  60%  { transform: scale(1, 1)       translateY(-2px); }
  80%  { transform: scale(1.1, 0.85)  translateY(0); }
  100% { transform: scale(1, 1)       translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  [style*="relayHamletIdleBreathe"],
  [style*="relayHamletBlink"],
  [style*="relayHamletSweat"],
  [style*="relayHamletSleepZ"],
  [style*="relayHamletWaveHand"],
  [style*="relayHamletWalk4Frame"],
  [style*="relayHamletSquashStretchJump"] {
    animation: none !important;
  }
}
@supports (animation-timeline: view()) {
  .relay-hamlet-onscreen-anim {
    animation-timeline: view();
    animation-range: entry 10% exit 90%;
  }
}
`;
