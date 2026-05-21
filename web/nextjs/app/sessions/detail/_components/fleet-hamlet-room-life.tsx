"use client";

// Fleet Hamlet — Room Scene "Accumulated Life" layer (R3: C1 + C2).
//
// Wall-mounted achievement frames + family photo frames + desk-top
// trophies + crown + red carpet. Every group is a pure SVG sub-tree using
// emoji glyphs and a couple of small rectangles so we keep the scene's
// node budget intact (≤ 130 total).
//
// All animations live in ROOM_LIFE_CSS at the bottom of this file.

import type {
  Achievement,
  RelationshipFrame,
} from "../_lib/fleet-hamlet-room-life";
import type {
  AchievementSlot,
  FrameSlot,
} from "../_lib/fleet-hamlet-room-furniture";

// ---------------------------------------------------------------------------
// Scene constants — kept in sync with fleet-hamlet-room-scene.tsx
// ---------------------------------------------------------------------------

const SCENE_W = 360;
const SCENE_H = 220;
const WALL_TOP = 8;
const WALL_BOTTOM = 110;
const FLOOR_TOP = 120;
const FLOOR_BOTTOM = 216;

function mapWall(x: number, y: number): { sx: number; sy: number } {
  return { sx: x * SCENE_W, sy: WALL_TOP + y * (WALL_BOTTOM - WALL_TOP) };
}

function mapFloor(x: number, y: number): { sx: number; sy: number } {
  const depth = 1 - y;
  const compress = depth * 0.18;
  const sx = SCENE_W / 2 + (x - 0.5) * SCENE_W * (1 - compress);
  const sy = FLOOR_TOP + y * (FLOOR_BOTTOM - FLOOR_TOP);
  return { sx, sy };
}

function mapAchievement(slot: AchievementSlot) {
  return slot.anchor === "wall"
    ? mapWall(slot.x, slot.y)
    : mapFloor(slot.x, slot.y);
}

// ---------------------------------------------------------------------------
// C1 — Achievement frames
// ---------------------------------------------------------------------------

export interface AchievementFramesProps {
  items: readonly Achievement[];
  slots: readonly AchievementSlot[];
  accent?: string;
}

export function AchievementFrames({
  items,
  slots,
  accent = "#37474F",
}: AchievementFramesProps) {
  if (items.length === 0 || slots.length === 0) return null;
  // Use wall-anchored slots first; floor-anchored slots are kept for trophies.
  const wallSlots = slots.filter((s) => s.anchor === "wall");
  if (wallSlots.length === 0) return null;
  const limit = Math.min(items.length, wallSlots.length);
  return (
    <g aria-hidden>
      {Array.from({ length: limit }).map((_, i) => {
        const a = items[i];
        const slot = wallSlots[i];
        if (!a || !slot) return null;
        return (
          <AchievementFrame
            key={`ach-${a.skillId}`}
            achievement={a}
            slot={slot}
            accent={accent}
            index={i}
          />
        );
      })}
    </g>
  );
}

function AchievementFrame({
  achievement,
  slot,
  accent,
  index,
}: {
  achievement: Achievement;
  slot: AchievementSlot;
  accent: string;
  index: number;
}) {
  const { sx, sy } = mapAchievement(slot);
  const goldTier = achievement.tier !== "basic";
  const frameColor = goldTier ? "#D7B254" : "#1A1A1A";
  const matColor = goldTier ? "#FCEFC9" : "#F4ECD8";
  const w = 22;
  const h = 14;
  const animation =
    achievement.tier === "master"
      ? `relayHamletAchievementGleam 2.6s ease-in-out ${index * 0.3}s infinite`
      : goldTier
        ? `relayHamletAchievementGleam 4.8s ease-in-out ${index * 0.4}s infinite`
        : undefined;
  return (
    <g transform={`translate(${sx}, ${sy})`} style={animation ? { animation } : undefined}>
      {/* Frame outer */}
      <rect
        x={-w / 2 - 1}
        y={-h / 2 - 1}
        width={w + 2}
        height={h + 2}
        fill={frameColor}
        rx={1}
      />
      {/* Mat */}
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={matColor} />
      {/* Icon */}
      <text
        x={-w / 2 + 5}
        y={0.5}
        fontSize={7}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontFamily: "ui-monospace, monospace",
          fontWeight: 600,
        }}
        fill={accent}
      >
        {achievement.icon}
      </text>
      {/* Stars */}
      {achievement.stars > 0 && (
        <text
          x={w / 2 - 2}
          y={-h / 2 + 4.5}
          fontSize={5}
          textAnchor="end"
          dominantBaseline="middle"
          fill="#FFB400"
        >
          {"★".repeat(Math.min(3, achievement.stars))}
        </text>
      )}
      {/* Caption */}
      <text
        x={0}
        y={h / 2 - 1.5}
        fontSize={3.6}
        textAnchor="middle"
        dominantBaseline="ideographic"
        fill="rgba(0,0,0,0.7)"
        style={{ fontFamily: "ui-monospace, monospace" }}
      >
        Lv{achievement.level} {achievement.label.slice(0, 8)}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// C1 — Trophy / crown / carpet
// ---------------------------------------------------------------------------

export interface TrophyShelfProps {
  /** Floor-anchored achievement slot used to position the trophy. */
  slot: AchievementSlot | undefined;
  /** True when at least one skill is Lv ≥ 9 → larger trophy. */
  large?: boolean;
}

export function TrophyShelf({ slot, large = false }: TrophyShelfProps) {
  if (!slot) return null;
  const { sx, sy } = mapAchievement(slot);
  const scale = large ? 1.4 : 1;
  return (
    <g transform={`translate(${sx}, ${sy}) scale(${scale})`} aria-hidden>
      <rect x={-6} y={2} width={12} height={3} fill="#5C3A1A" rx={0.5} />
      <path
        d="M -5 -7 L 5 -7 L 4 0 L -4 0 Z"
        fill="#E5B14B"
        stroke="#8B6914"
        strokeWidth={0.6}
      />
      <path d="M -7 -5 Q -8 -2 -5 -1" stroke="#8B6914" strokeWidth={0.6} fill="none" />
      <path d="M 7 -5 Q 8 -2 5 -1" stroke="#8B6914" strokeWidth={0.6} fill="none" />
      <text
        x={0}
        y={-3}
        fontSize={4.5}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#8B6914"
        style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}
      >
        ★
      </text>
    </g>
  );
}

export interface CrownDisplayProps {
  slot: AchievementSlot | undefined;
}

export function CrownDisplay({ slot }: CrownDisplayProps) {
  if (!slot) return null;
  // The crown is a high-honour wall display, not a floor item. Borrow the x
  // of whichever achievement slot we were given, but force the y up onto the
  // back-wall band so the crown reads as "mounted high" instead of floating
  // mid-room. The wooden plinth underneath sits flush with that wall y so
  // there's no visual gap between the crown, plinth, and wall.
  const { sx: rawSx } = mapAchievement(slot);
  // Clamp x to leave clearance from the side walls so the plinth stays on
  // the back wall band.
  const sx = Math.min(Math.max(rawSx, 28), SCENE_W - 28);
  const sy = 36; // top quarter of the wall, well clear of the floor seam
  return (
    <g
      transform={`translate(${sx}, ${sy})`}
      style={{ animation: "relayHamletCrownPulse 2.4s ease-in-out infinite" }}
      aria-hidden
    >
      <rect x={-9} y={3} width={18} height={4} fill="#7A5A28" rx={0.8} />
      <rect x={-10} y={6} width={20} height={1.2} fill="rgba(0,0,0,0.35)" />
      <text
        x={0}
        y={-2}
        fontSize={14}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        👑
      </text>
    </g>
  );
}

export interface RedCarpetProps {
  /** Use the "front" floor band — drawn behind the avatar. */
  visible: boolean;
}

export function RedCarpet({ visible }: RedCarpetProps) {
  if (!visible) return null;
  // Trapezoid stretched along the floor — back narrow, front wide.
  return (
    <g aria-hidden>
      <polygon
        points={`130,150 230,150 270,210 90,210`}
        fill="#B3261E"
        opacity={0.85}
      />
      <polygon
        points={`140,155 220,155 252,205 108,205`}
        fill="none"
        stroke="#E8C547"
        strokeWidth={1.2}
        opacity={0.85}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// C2 — Relationship photo frames
// ---------------------------------------------------------------------------

export interface RelationshipFramesProps {
  frames: readonly RelationshipFrame[];
  slots: readonly FrameSlot[];
}

export function RelationshipFrames({
  frames,
  slots,
}: RelationshipFramesProps) {
  if (frames.length === 0 || slots.length === 0) return null;
  const limit = Math.min(frames.length, slots.length);
  return (
    <g aria-hidden>
      {Array.from({ length: limit }).map((_, i) => {
        const frame = frames[i];
        const slot = slots[i];
        if (!frame || !slot) return null;
        return (
          <PhotoFrame key={`frame-${frame.key}`} frame={frame} slot={slot} />
        );
      })}
    </g>
  );
}

function PhotoFrame({
  frame,
  slot,
}: {
  frame: RelationshipFrame;
  slot: FrameSlot;
}) {
  // Slot uses full-canvas coordinates (matches RoomWhiteboard).
  const cx = slot.x * SCENE_W;
  const cy = slot.y * SCENE_H;
  const w = slot.w * SCENE_W;
  const h = slot.h * SCENE_H;
  const silhouette = `hsl(${frame.hue}, 50%, 65%)`;
  const innerW = Math.max(6, w - 2);
  const innerH = Math.max(6, h - 4);
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Wooden frame */}
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        fill="#7A5A36"
        rx={0.8}
      />
      {/* Mat */}
      <rect
        x={-innerW / 2}
        y={-h / 2 + 0.6}
        width={innerW}
        height={innerH}
        fill="#FAFAF5"
      />
      {/* Silhouette — circle head + shoulders */}
      <g transform={`translate(0, ${-h / 2 + innerH * 0.45})`}>
        <circle cx={0} cy={-1.8} r={innerH * 0.22} fill={silhouette} />
        <path
          d={`M ${-innerW * 0.35} ${innerH * 0.22} Q ${0} ${innerH * 0.05} ${innerW * 0.35} ${innerH * 0.22} L ${innerW * 0.35} ${innerH * 0.4} L ${-innerW * 0.35} ${innerH * 0.4} Z`}
          fill={silhouette}
        />
      </g>
      {/* Caption */}
      <text
        x={0}
        y={h / 2 - 1}
        fontSize={3.4}
        textAnchor="middle"
        dominantBaseline="ideographic"
        fill="rgba(0,0,0,0.78)"
        style={{ fontFamily: "ui-monospace, monospace" }}
      >
        {frame.caption}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// CSS — registered alongside ROOM_SCENE_CSS
// ---------------------------------------------------------------------------

export const ROOM_LIFE_CSS = `
@keyframes relayHamletAchievementGleam {
  0%, 100% { filter: drop-shadow(0 0 0 rgba(255,220,140,0)); }
  50% { filter: drop-shadow(0 0 2px rgba(255,220,140,0.7)); }
}
@keyframes relayHamletCrownPulse {
  0%, 100% { transform: translate(0, 0); filter: drop-shadow(0 0 0 rgba(255,200,80,0)); }
  50% { transform: translate(0, -0.6px); filter: drop-shadow(0 0 3px rgba(255,200,80,0.85)); }
}
`;
