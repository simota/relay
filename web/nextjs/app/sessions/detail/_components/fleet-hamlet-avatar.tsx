"use client";

// Fleet Hamlet — shared avatar face / body primitives.
//
// All "person" sprites in Hamlet (Sim Card, Neighborhood, Park, Room,
// Window-through children) compose the same face & body building blocks
// defined here so the village reads as a single character family rather
// than a patchwork of unrelated little people.
//
// The renderers are pure SVG groups (no HTML wrapper) — callers position
// them via the parent SVG transform / outer DOM and pick the size that
// fits their layout. The face/body do NOT include ground shadow — that's
// the caller's responsibility because the shadow geometry depends on the
// scene (ellipse on grass, dropped on bench, sitting on chair, etc.).
//
// Naming: `HeadFace` = circle/oval face + hair + eyes + mouth + cheeks
//                      + ears + brows.
//          `BodyTorso` = barrel torso + collar + arms + legs + shoes,
//                        with a `pose` prop that translates to limb angle.

import type { ReactNode } from "react";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import type { AvatarParts } from "../_lib/fleet-hamlet";
import {
  type AvatarExpression,
  type BrowShape,
  type EyeShape,
  type MouthShape,
  type AvatarPose,
} from "../_lib/fleet-hamlet-avatar-expression";
import type {
  BeardKind,
  EarringKind,
  GlassesKind,
  MustacheKind,
  ScarfKind,
} from "../_lib/fleet-hamlet-particles";
import {
  BeardSvg,
  EarringSvg,
  GlassesSvg,
  MustacheSvg,
  ScarfSvg,
} from "./fleet-hamlet-avatar-accessories";

// ---------------------------------------------------------------------------
// Shared palette helpers
// ---------------------------------------------------------------------------

export interface ClothingColors {
  shirt: string;
  shirtDark: string;
  accent: string;
}

export function clothingForAgent(
  kind: SimCardModel["sessionType"],
): ClothingColors {
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

// ---------------------------------------------------------------------------
// HeadFace — egg-shaped face with hair / ears / cheeks / eyes / mouth / brows.
//
// All coordinates are inside a [-headR, +headR] x [-headR, +headR] frame
// centered on the head's geometric middle. Callers translate this group
// into the right scene position.
// ---------------------------------------------------------------------------

export interface HeadFaceProps {
  parts: AvatarParts;
  expression: AvatarExpression;
  /** Half-width radius of the head in SVG units. Default 12. */
  radius?: number;
  /** Optional mood halo stroke. Pass undefined to suppress. */
  haloColor?: string;
  /** Per-instance animation delays — default to parts.* but overridable for
   *  tiny micro-avatars where the blink overlay would be illegible. */
  enableBlink?: boolean;
  /** Skip the cheek blush (used at very small sizes where 2 px blobs blur into the face). */
  enableCheeks?: boolean;
  /** Open-Peeps-inspired accessories — all optional, default "none". */
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
  glasses = "none",
  mustache = "none",
  beard = "none",
  earring = "none",
}: HeadFaceProps) {
  const skin = `hsl(${parts.skinHue}, 45%, 72%)`;
  const skinShadow = `hsl(${parts.skinHue}, 50%, 58%)`;
  const hair = `hsl(${parts.hairHue}, 50%, 30%)`;
  const hairHi = `hsl(${parts.hairHue}, 55%, 42%)`;
  const cheek = `hsl(${parts.cheekHue}, 75%, 75%)`;
  // Slight egg shape — taller than wide so the face reads as a face not a coin.
  const rx = radius;
  const ry = radius * 1.08;
  // Note: haloColor is accepted for back-compat but no longer renders a halo
  // ring — mood is conveyed via expression (eyes/mouth/brow) instead.
  void haloColor;
  return (
    <g aria-hidden>
      {/* Ears — render behind the face oval so the hair / face front
          covers them when hair style hides them. */}
      {parts.hasEars && (
        <>
          <ellipse cx={-rx * 0.95} cy={ry * 0.05} rx={rx * 0.18} ry={ry * 0.22} fill={skin} />
          <ellipse cx={-rx * 0.95} cy={ry * 0.08} rx={rx * 0.1} ry={ry * 0.13} fill={skinShadow} opacity={0.65} />
          <ellipse cx={rx * 0.95} cy={ry * 0.05} rx={rx * 0.18} ry={ry * 0.22} fill={skin} />
          <ellipse cx={rx * 0.95} cy={ry * 0.08} rx={rx * 0.1} ry={ry * 0.13} fill={skinShadow} opacity={0.65} />
        </>
      )}
      {/* Earring — sits below the ear, drawn in front so it isn't masked
          by the face oval. */}
      {parts.hasEars && earring !== "none" && <EarringSvg side={earring} radius={radius} />}
      {/* Face oval (egg shape) */}
      <ellipse cx={0} cy={0} rx={rx} ry={ry} fill={skin} />
      {/* Jaw shadow — subtle, lower-right */}
      <ellipse
        cx={rx * 0.15}
        cy={ry * 0.55}
        rx={rx * 0.7}
        ry={ry * 0.32}
        fill={skinShadow}
        opacity={0.28}
      />
      {/* Forehead highlight (upper-left) */}
      <ellipse
        cx={-rx * 0.35}
        cy={-ry * 0.45}
        rx={rx * 0.45}
        ry={ry * 0.28}
        fill="rgba(255, 250, 240, 0.40)"
      />
      {/* Cheek blush */}
      {enableCheeks && (
        <>
          <ellipse cx={-rx * 0.5} cy={ry * 0.22} rx={rx * 0.22} ry={ry * 0.13} fill={cheek} opacity={0.45} />
          <ellipse cx={rx * 0.5} cy={ry * 0.22} rx={rx * 0.22} ry={ry * 0.13} fill={cheek} opacity={0.45} />
        </>
      )}
      {/* Beard — wraps the jaw; drawn before hair so the hair fringe still
          covers any beard escaping toward the temple. */}
      {beard !== "none" && <BeardSvg kind={beard} radius={radius} />}
      {/* Hair — drawn after face so it sits in front of the forehead */}
      <HairShape parts={parts} radius={radius} hair={hair} hairHi={hairHi} />
      {/* Brows */}
      <Brows brow={expression.brow} radius={radius} />
      {/* Eyes — wrapped in a blink group so the keyframe can collapse them */}
      <g
        style={
          enableBlink && expression.eye !== "closed"
            ? {
                animation: `relayHamletBlink 8s ease-in-out ${parts.blinkDelay}s infinite`,
                transformOrigin: "center",
              }
            : undefined
        }
      >
        <Eyes eye={expression.eye} radius={radius} />
      </g>
      {/* Mouth */}
      <Mouth mouth={expression.mouth} radius={radius} />
      {/* Mustache — under nose, above mouth */}
      {mustache !== "none" && <MustacheSvg kind={mustache} radius={radius} />}
      {/* Glasses — on top of eyes & brows */}
      {glasses !== "none" && <GlassesSvg kind={glasses} radius={radius} />}
      {/* Sweat drop overlay (Stressed) */}
      {expression.showSweat && (
        <g
          style={{
            animation: "relayHamletSweat 1.6s ease-in-out infinite",
            transformOrigin: `${rx * 0.6}px ${-ry * 0.5}px`,
          }}
        >
          <ellipse
            cx={rx * 0.65}
            cy={-ry * 0.35}
            rx={radius * 0.12}
            ry={radius * 0.2}
            fill="#7DD5F0"
            opacity={0.95}
          />
          <ellipse
            cx={rx * 0.6}
            cy={-ry * 0.45}
            rx={radius * 0.05}
            ry={radius * 0.08}
            fill="rgba(255,255,255,0.85)"
          />
        </g>
      )}
      {/* Zzz overlay (Asleep) */}
      {expression.showZzz && (
        <g
          style={{
            animation: "relayHamletSleepZ 3s ease-in-out infinite",
            transformOrigin: `${rx * 0.7}px ${-ry * 0.8}px`,
          }}
        >
          <text
            x={rx * 0.85}
            y={-ry * 0.7}
            fontSize={radius * 0.9}
            textAnchor="start"
            fill="#5C7CA8"
            fontFamily="ui-monospace, monospace"
            fontWeight="600"
          >
            z
          </text>
          <text
            x={rx * 1.15}
            y={-ry * 1.05}
            fontSize={radius * 0.6}
            textAnchor="start"
            fill="#7C9CC8"
            fontFamily="ui-monospace, monospace"
            fontWeight="600"
            opacity={0.85}
          >
            z
          </text>
        </g>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Hair / Eye / Mouth / Brow primitives
// ---------------------------------------------------------------------------

function HairShape({
  parts,
  radius,
  hair,
  hairHi,
}: {
  parts: AvatarParts;
  radius: number;
  hair: string;
  hairHi: string;
}) {
  const r = radius;
  switch (parts.hair) {
    case "bald":
      return null;
    case "short":
      return (
        <g>
          <path
            d={`M ${-r * 0.95} ${-r * 0.1} Q ${-r * 0.9} ${-r * 1.05} 0 ${-r * 1.05} Q ${r * 0.9} ${-r * 1.05} ${r * 0.95} ${-r * 0.1} L ${r * 0.85} ${-r * 0.55} L ${r * 0.4} ${-r * 0.75} L 0 ${-r * 0.6} L ${-r * 0.4} ${-r * 0.75} L ${-r * 0.85} ${-r * 0.55} Z`}
            fill={hair}
          />
          <path
            d={`M ${-r * 0.7} ${-r * 0.9} Q ${-r * 0.3} ${-r * 1.05} ${r * 0.1} ${-r * 0.95}`}
            stroke={hairHi}
            strokeWidth={r * 0.08}
            fill="none"
            opacity={0.7}
            strokeLinecap="round"
          />
        </g>
      );
    case "wavy":
      return (
        <g>
          <path
            d={`M ${-r * 1.0} ${-r * 0.15} Q ${-r * 1.1} ${-r * 1.1} 0 ${-r * 1.15} Q ${r * 1.1} ${-r * 1.1} ${r * 1.0} ${-r * 0.15} L ${r * 0.95} ${r * 0.05} Q ${r * 0.85} ${-r * 0.1} ${r * 0.7} ${0} Q ${r * 0.55} ${-r * 0.15} ${r * 0.35} ${0} Q ${r * 0.15} ${-r * 0.15} 0 ${0} Q ${-r * 0.15} ${-r * 0.15} ${-r * 0.35} ${0} Q ${-r * 0.55} ${-r * 0.1} ${-r * 0.7} ${0} Q ${-r * 0.85} ${-r * 0.1} ${-r * 0.95} ${r * 0.05} Z`}
            fill={hair}
          />
          <path
            d={`M ${-r * 0.7} ${-r * 0.95} Q 0 ${-r * 1.1} ${r * 0.6} ${-r * 0.95}`}
            stroke={hairHi}
            strokeWidth={r * 0.1}
            fill="none"
            opacity={0.65}
            strokeLinecap="round"
          />
        </g>
      );
    case "bob":
      // Bob covers the ears and frames the jaw.
      return (
        <g>
          <path
            d={`M ${-r * 1.1} ${-r * 0.1} Q ${-r * 1.1} ${-r * 1.1} 0 ${-r * 1.15} Q ${r * 1.1} ${-r * 1.1} ${r * 1.1} ${-r * 0.1} L ${r * 1.05} ${r * 0.6} Q ${r * 0.6} ${r * 0.7} ${r * 0.55} ${r * 0.5} L ${r * 0.55} ${-r * 0.05} Q ${r * 0.4} ${r * 0.05} ${r * 0.3} ${0} L ${-r * 0.55} ${-r * 0.05} Q ${-r * 0.6} ${r * 0.55} ${-r * 1.05} ${r * 0.6} Z`}
            fill={hair}
          />
          <path
            d={`M ${-r * 0.95} ${-r * 0.4} Q 0 ${-r * 1.05} ${r * 0.95} ${-r * 0.4}`}
            stroke={hairHi}
            strokeWidth={r * 0.07}
            fill="none"
            opacity={0.7}
          />
        </g>
      );
    case "topknot":
      return (
        <g>
          <ellipse cx={0} cy={-r * 1.3} rx={r * 0.42} ry={r * 0.35} fill={hair} />
          <ellipse cx={-r * 0.1} cy={-r * 1.35} rx={r * 0.15} ry={r * 0.12} fill={hairHi} opacity={0.7} />
          <rect x={-r * 0.1} y={-r * 1.15} width={r * 0.2} height={r * 0.18} fill={hair} />
          <path
            d={`M ${-r * 0.9} ${-r * 0.2} Q ${-r * 0.95} ${-r * 0.95} 0 ${-r * 1.0} Q ${r * 0.95} ${-r * 0.95} ${r * 0.9} ${-r * 0.2} L ${r * 0.85} ${-r * 0.55} L 0 ${-r * 0.7} L ${-r * 0.85} ${-r * 0.55} Z`}
            fill={hair}
          />
        </g>
      );
    case "curly":
      // Curly is a cluster of small blobs.
      return (
        <g>
          {[
            { cx: -r * 0.85, cy: -r * 0.5, rx: r * 0.32 },
            { cx: -r * 0.55, cy: -r * 0.95, rx: r * 0.36 },
            { cx: 0, cy: -r * 1.05, rx: r * 0.4 },
            { cx: r * 0.55, cy: -r * 0.95, rx: r * 0.36 },
            { cx: r * 0.85, cy: -r * 0.5, rx: r * 0.32 },
            { cx: -r * 0.95, cy: r * 0.1, rx: r * 0.22 },
            { cx: r * 0.95, cy: r * 0.1, rx: r * 0.22 },
          ].map((b, i) => (
            <circle key={i} cx={b.cx} cy={b.cy} r={b.rx} fill={hair} />
          ))}
          {/* Highlight blob on the lit side */}
          <circle cx={-r * 0.55} cy={-r * 1.0} r={r * 0.14} fill={hairHi} opacity={0.7} />
        </g>
      );
    default:
      return null;
  }
}

function Eyes({ eye, radius }: { eye: EyeShape; radius: number }) {
  const r = radius;
  const ex = r * 0.4; // eye horizontal offset from center
  const ey = -r * 0.05; // eye vertical position
  switch (eye) {
    case "normal":
      return (
        <g>
          <circle cx={-ex} cy={ey} r={r * 0.13} fill="#1a1a1a" />
          <circle cx={ex} cy={ey} r={r * 0.13} fill="#1a1a1a" />
          {/* white catchlights */}
          <circle cx={-ex + r * 0.05} cy={ey - r * 0.04} r={r * 0.04} fill="#FFFFFF" />
          <circle cx={ex + r * 0.05} cy={ey - r * 0.04} r={r * 0.04} fill="#FFFFFF" />
        </g>
      );
    case "smile":
      // Inverted U
      return (
        <g stroke="#1a1a1a" strokeWidth={Math.max(0.8, r * 0.12)} fill="none" strokeLinecap="round">
          <path d={`M ${-ex - r * 0.18} ${ey + r * 0.05} Q ${-ex} ${ey - r * 0.18} ${-ex + r * 0.18} ${ey + r * 0.05}`} />
          <path d={`M ${ex - r * 0.18} ${ey + r * 0.05} Q ${ex} ${ey - r * 0.18} ${ex + r * 0.18} ${ey + r * 0.05}`} />
        </g>
      );
    case "half":
      return (
        <g fill="#1a1a1a">
          <rect x={-ex - r * 0.18} y={ey - r * 0.04} width={r * 0.36} height={r * 0.08} rx={r * 0.04} />
          <rect x={ex - r * 0.18} y={ey - r * 0.04} width={r * 0.36} height={r * 0.08} rx={r * 0.04} />
        </g>
      );
    case "closed":
      return (
        <g stroke="#1a1a1a" strokeWidth={Math.max(0.8, r * 0.1)} fill="none" strokeLinecap="round">
          <path d={`M ${-ex - r * 0.2} ${ey} Q ${-ex} ${ey + r * 0.1} ${-ex + r * 0.2} ${ey}`} />
          <path d={`M ${ex - r * 0.2} ${ey} Q ${ex} ${ey + r * 0.1} ${ex + r * 0.2} ${ey}`} />
        </g>
      );
    case "narrow":
      return (
        <g fill="#1a1a1a">
          <rect x={-ex - r * 0.18} y={ey - r * 0.02} width={r * 0.36} height={r * 0.05} rx={r * 0.02} />
          <rect x={ex - r * 0.18} y={ey - r * 0.02} width={r * 0.36} height={r * 0.05} rx={r * 0.02} />
        </g>
      );
    case "swirl":
      return (
        <g stroke="#1a1a1a" strokeWidth={Math.max(0.7, r * 0.08)} fill="none">
          <path d={`M ${-ex} ${ey} m ${-r * 0.16} 0 a ${r * 0.16} ${r * 0.16} 0 1 1 ${r * 0.32} 0 a ${r * 0.1} ${r * 0.1} 0 1 0 -${r * 0.2} 0`} />
          <path d={`M ${ex} ${ey} m ${-r * 0.16} 0 a ${r * 0.16} ${r * 0.16} 0 1 1 ${r * 0.32} 0 a ${r * 0.1} ${r * 0.1} 0 1 0 -${r * 0.2} 0`} />
        </g>
      );
  }
}

function Mouth({ mouth, radius }: { mouth: MouthShape; radius: number }) {
  const r = radius;
  const my = r * 0.45;
  switch (mouth) {
    case "small-smile":
      return (
        <path
          d={`M ${-r * 0.18} ${my} Q 0 ${my + r * 0.12} ${r * 0.18} ${my}`}
          stroke="#5A2D1F"
          strokeWidth={Math.max(0.8, r * 0.09)}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "big-smile":
      return (
        <g>
          <path
            d={`M ${-r * 0.3} ${my - r * 0.04} Q 0 ${my + r * 0.32} ${r * 0.3} ${my - r * 0.04} Z`}
            fill="#5A2D1F"
          />
          {/* tongue / lip highlight */}
          <path
            d={`M ${-r * 0.18} ${my + r * 0.12} Q 0 ${my + r * 0.22} ${r * 0.18} ${my + r * 0.12}`}
            fill="#D6705C"
            opacity={0.85}
          />
        </g>
      );
    case "flat":
      return (
        <line
          x1={-r * 0.2}
          y1={my}
          x2={r * 0.2}
          y2={my}
          stroke="#5A2D1F"
          strokeWidth={Math.max(0.8, r * 0.1)}
          strokeLinecap="round"
        />
      );
    case "frown":
      return (
        <path
          d={`M ${-r * 0.22} ${my + r * 0.08} Q 0 ${my - r * 0.08} ${r * 0.22} ${my + r * 0.08}`}
          stroke="#5A2D1F"
          strokeWidth={Math.max(0.8, r * 0.1)}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "open-yawn":
      return (
        <ellipse
          cx={0}
          cy={my + r * 0.05}
          rx={r * 0.12}
          ry={r * 0.16}
          fill="#3A2A1F"
        />
      );
  }
}

function Brows({ brow, radius }: { brow: BrowShape; radius: number }) {
  if (brow === "none") return null;
  const r = radius;
  const ex = r * 0.4;
  const by = -r * 0.32;
  const len = r * 0.28;
  const sw = Math.max(0.7, r * 0.09);
  // angle-up = outer-end raised (worried "/\\"); angle-down = inner end raised
  // (angry "\\/"); straight = flat dash.
  let leftDx = 0;
  let rightDx = 0;
  if (brow === "angle-up") {
    leftDx = -r * 0.12;
    rightDx = r * 0.12;
  } else if (brow === "angle-down") {
    leftDx = r * 0.12;
    rightDx = -r * 0.12;
  }
  return (
    <g stroke="#3A2A1F" strokeWidth={sw} strokeLinecap="round">
      <line
        x1={-ex - len / 2}
        y1={by + (brow === "angle-up" ? r * 0.08 : 0)}
        x2={-ex + len / 2}
        y2={by + leftDx * 0.5}
      />
      <line
        x1={ex - len / 2}
        y1={by + rightDx * 0.5}
        x2={ex + len / 2}
        y2={by + (brow === "angle-up" ? r * 0.08 : 0)}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// BodyTorso — barrel torso, collar, arms (with hands), legs (with shoes).
// Mood drives lean / pose. Caller positions; we draw centered on (0,0)
// with the head's neck base at (0, 0) and feet at (0, height).
// ---------------------------------------------------------------------------

export interface BodyTorsoProps {
  clothing: ClothingColors;
  pose: AvatarPose;
  /** Overall height in SVG units. Width is derived (~ 0.7x). */
  height?: number;
  /** Skip the rim-light stripe at very small sizes. */
  enableRim?: boolean;
  /** Skip individual leg drawing at very small sizes (single trunk used). */
  enableLegs?: boolean;
  /** Open-Peeps-inspired scarf accessory. */
  scarf?: ScarfKind;
}

export function BodyTorso({
  clothing,
  pose,
  height = 32,
  enableRim = true,
  enableLegs = true,
  scarf = "none",
}: BodyTorsoProps) {
  const h = height;
  const w = h * 0.7;
  // Torso barrel control points — wider at the bottom (pear silhouette).
  const topW = w * 0.55;
  const botW = w * 0.85;
  const torsoTop = h * 0.05;
  const torsoBottom = h * 0.65;
  const shoulderY = h * 0.1;
  const armW = w * 0.13;
  const handR = w * 0.085;
  const armLen = torsoBottom - shoulderY - handR * 1.55;
  const shoulderX = topW / 2 + armW * 0.65;
  const armCrouchY = pose === "crouch" ? -h * 0.05 : 0;
  // Rotation conventions: SVG rotate() is clockwise for positive degrees.
  // Both arm rects extend downward from the shoulder (0,0). To swing an
  // arm across the chest (inward), rotate the LEFT arm POSITIVE and the
  // RIGHT arm NEGATIVE. crouch swings outward (opposite).
  const leftArmRot =
    pose === "cross-arms"
      ? 70
      : pose === "crouch"
        ? -20
        : pose === "sigh"
          ? 8
          : pose === "step-forward"
            ? 10
            : 0;
  const rightArmRot =
    pose === "cross-arms"
      ? -70
      : pose === "wave"
        ? -28
        : pose === "crouch"
          ? 20
          : pose === "sigh"
            ? -8
            : pose === "step-forward"
              ? -10
              : 0;
  const leftLegX = pose === "step-forward" ? -w * 0.08 : -w * 0.22;
  const rightLegX = pose === "step-forward" ? w * 0.18 : w * 0.05;
  const leftLegY = pose === "step-forward" ? -h * 0.05 : 0;
  const isSleeping = pose === "sleeping";
  return (
    <g aria-hidden>
      {/* Legs */}
      {enableLegs && !isSleeping && (
        <g>
          {/* left leg + shoe */}
          <rect
            x={leftLegX}
            y={torsoBottom + leftLegY}
            width={w * 0.17}
            height={h * 0.32}
            rx={w * 0.06}
            fill="#4A382C"
          />
          <ellipse
            cx={leftLegX + w * 0.085}
            cy={torsoBottom + leftLegY + h * 0.34}
            rx={w * 0.13}
            ry={h * 0.04}
            fill="#1F1410"
          />
          {/* right leg + shoe */}
          <rect
            x={rightLegX}
            y={torsoBottom}
            width={w * 0.17}
            height={h * 0.32}
            rx={w * 0.06}
            fill="#4A382C"
          />
          <ellipse
            cx={rightLegX + w * 0.085}
            cy={torsoBottom + h * 0.34}
            rx={w * 0.13}
            ry={h * 0.04}
            fill="#1F1410"
          />
        </g>
      )}
      {/* Torso barrel — pear silhouette via path */}
      <path
        d={`M ${-topW / 2} ${torsoTop}
            L ${topW / 2} ${torsoTop}
            L ${botW / 2} ${torsoBottom}
            L ${-botW / 2} ${torsoBottom}
            Z`}
        fill={clothing.shirt}
      />
      {/* Right-side shading on the torso */}
      <path
        d={`M 0 ${torsoTop}
            L ${topW / 2} ${torsoTop}
            L ${botW / 2} ${torsoBottom}
            L 0 ${torsoBottom}
            Z`}
        fill={clothing.shirtDark}
        opacity={0.4}
      />
      {/* Rim light on the left edge of the torso */}
      {enableRim && (
        <path
          d={`M ${-topW / 2} ${torsoTop}
              L ${-topW / 2 + w * 0.05} ${torsoTop}
              L ${-botW / 2 + w * 0.05} ${torsoBottom}
              L ${-botW / 2} ${torsoBottom}
              Z`}
          fill={clothing.accent}
          opacity={0.85}
        />
      )}
      {/* Collar — V-shape on top of the torso */}
      <path
        d={`M ${-topW / 2} ${torsoTop}
            L 0 ${h * 0.18}
            L ${topW / 2} ${torsoTop}
            L ${topW / 2 - w * 0.05} ${h * 0.02}
            L 0 ${h * 0.13}
            L ${-topW / 2 + w * 0.05} ${h * 0.02}
            Z`}
        fill={clothing.accent}
      />
      {/* Two front buttons */}
      <circle cx={0} cy={h * 0.32} r={Math.max(0.5, w * 0.04)} fill={clothing.shirtDark} />
      <circle cx={0} cy={h * 0.48} r={Math.max(0.5, w * 0.04)} fill={clothing.shirtDark} />
      {/* Scarf — wraps the neck/collar; rendered after the torso/collar so
          it sits in front. Arms are drawn after, so they remain in front
          of the scarf as if dangling outside it. */}
      {scarf !== "none" && !isSleeping && <ScarfSvg kind={scarf} width={w} />}
      {/* Arms — explicit foreground layer. Each limb's local origin is its shoulder. */}
      <g>
        <g transform={`translate(${-shoulderX}, ${shoulderY + armCrouchY}) rotate(${leftArmRot})`}>
          <rect
            x={-armW / 2}
            y={0}
            width={armW}
            height={armLen}
            rx={armW * 0.45}
            fill={pose === "cross-arms" ? clothing.shirt : clothing.shirtDark}
          />
          {enableRim && pose !== "cross-arms" && (
            <rect
              x={-armW / 2}
              y={0}
              width={armW * 0.32}
              height={armLen}
              rx={armW * 0.32}
              fill={clothing.accent}
              opacity={0.65}
            />
          )}
          <circle cx={0} cy={armLen + handR * 0.5} r={handR} fill="#F0CDA8" />
        </g>
        <g transform={`translate(${shoulderX}, ${shoulderY}) rotate(${rightArmRot})`}>
          <g
            style={
              pose === "wave"
                ? {
                    animation: "relayHamletWaveHand 1.6s ease-in-out infinite",
                    transformOrigin: "0px 0px",
                  }
                : undefined
            }
          >
            <rect
              x={-armW / 2}
              y={0}
              width={armW}
              height={armLen}
              rx={armW * 0.45}
              fill={clothing.shirtDark}
            />
            <circle cx={0} cy={armLen + handR * 0.5} r={handR} fill="#F0CDA8" />
          </g>
        </g>
      </g>
      {/* Sleeping — show body lying horizontal (single rect on the ground) */}
      {isSleeping && (
        <rect
          x={-w * 0.55}
          y={torsoBottom - h * 0.08}
          width={w * 1.1}
          height={h * 0.16}
          rx={w * 0.08}
          fill={clothing.shirt}
          opacity={0.85}
        />
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// HamletAvatar — convenience wrapper that stacks head + body and applies
// the breathing animation. Used by all the non-sim-card consumers.
// ---------------------------------------------------------------------------

export interface HamletAvatarProps {
  parts: AvatarParts;
  expression: AvatarExpression;
  clothing: ClothingColors;
  /** Total height in SVG units. Width derives from it. */
  height: number;
  /** Toggle the breathing keyframe. */
  enableBreathe?: boolean;
  /** Toggle the blink keyframe. */
  enableBlink?: boolean;
  /** Toggle the cheek blush. */
  enableCheeks?: boolean;
  /** Optional mood-coloured halo on the head. */
  haloColor?: string;
  /** Hide the body — used for "head only" consumers like Sim Card. */
  bodyOnly?: false;
  /** Children rendered above the avatar (hats / crowns). */
  children?: ReactNode;
  /** Group transform from caller (translate/scale). */
  transform?: string;
  /** Open-Peeps-inspired accessory layer. */
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
  // Head radius is ~22% of total height (slightly larger than realistic to
  // read as "cute character" at small sizes).
  const headR = height * 0.22;
  const bodyH = height * 0.62;
  // Vertical layout: head centered at headR + small neck gap, body below.
  const headCy = headR + 1;
  const bodyTopY = headCy + headR * 0.95; // neck base
  return (
    <g transform={transform} aria-hidden>
      <g
        style={
          enableBreathe
            ? {
                animation: `relayHamletIdleBreathe 4s ease-in-out ${parts.breatheDelay}s infinite`,
                transformOrigin: "center",
              }
            : undefined
        }
      >
        {/* Neck — small rect between head and torso */}
        <rect
          x={-headR * 0.2}
          y={bodyTopY - headR * 0.2}
          width={headR * 0.4}
          height={headR * 0.4}
          fill={`hsl(${parts.skinHue}, 45%, 65%)`}
        />
        <g transform={`translate(0, ${bodyTopY})`}>
          <BodyTorso
            clothing={clothing}
            pose={expression.pose}
            height={bodyH}
            scarf={scarf}
          />
        </g>
        <g transform={`translate(0, ${headCy}) rotate(${expression.leanDeg})`}>
          <HeadFace
            parts={parts}
            expression={expression}
            radius={headR}
            haloColor={haloColor}
            enableBlink={enableBlink}
            enableCheeks={enableCheeks}
            glasses={glasses}
            mustache={mustache}
            beard={beard}
            earring={earring}
          />
        </g>
      </g>
      {children}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Shared keyframes — caller injects via <style>{HAMLET_AVATAR_CSS}</style>
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
`;
