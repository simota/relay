"use client";

// Fleet Hamlet — Room Scene "Time / Season Variety" layer (R4: E1 + E2).
//
// Renders a single seasonal decoration on the floor and an optional meal /
// sleepwear / late-night snack on the desk-side table slot. Each shape is a
// small grouped SVG (one or two emoji + a couple of decorative rects) so
// the total node footprint stays modest.
//
// All animations live in ROOM_TEMPORAL_CSS.

import type {
  SeasonalDecor,
  MealItem,
} from "../_lib/fleet-hamlet-room-temporal";
import type {
  MealSlot,
  SeasonSlot,
} from "../_lib/fleet-hamlet-room-furniture";
import { DIORAMA_DEFS } from "../_lib/fleet-hamlet-diorama-tokens";

// ---------------------------------------------------------------------------
// Scene constants — kept in sync with fleet-hamlet-room-scene.tsx
// ---------------------------------------------------------------------------

const SCENE_W = 360;
const FLOOR_TOP = 120;
const FLOOR_BOTTOM = 216;

function mapFloor(x: number, y: number): { sx: number; sy: number } {
  const depth = 1 - y;
  const compress = depth * 0.18;
  const sx = SCENE_W / 2 + (x - 0.5) * SCENE_W * (1 - compress);
  const sy = FLOOR_TOP + y * (FLOOR_BOTTOM - FLOOR_TOP);
  return { sx, sy };
}

// ---------------------------------------------------------------------------
// E1 — Seasonal decor
// ---------------------------------------------------------------------------

export interface SeasonDecorProps {
  seasonal: SeasonalDecor;
  slot: SeasonSlot | undefined;
}

export function SeasonDecor({ seasonal, slot }: SeasonDecorProps) {
  if (!slot) return null;
  const { sx, sy } = mapFloor(slot.x, slot.y);
  return (
    <g transform={`translate(${sx}, ${sy})`} aria-hidden>
      {/* D2 — soft ground shadow beneath the seasonal decor. */}
      <ellipse cx={0} cy={7} rx={9} ry={1.5} fill="rgba(0,0,0,0.25)" />
      <SeasonShape seasonal={seasonal} />
    </g>
  );
}

function SeasonShape({ seasonal }: { seasonal: SeasonalDecor }) {
  switch (seasonal.kind) {
    case "spring-blossom":
      return (
        <g>
          {/* Vase — glass gradient + rim highlight + water surface line. */}
          <path
            d="M -5 4 Q -7 -2 -4 -3 L 4 -3 Q 7 -2 5 4 Z"
            fill={`url(#${DIORAMA_DEFS.roomGlass})`}
            stroke="#C66E94"
            strokeWidth={0.5}
          />
          <path d="M -4.4 -2.6 Q -4 -2.4 -4 -1.5" stroke="rgba(255,255,255,0.85)" strokeWidth={0.5} fill="none" />
          <line x1={-3.8} y1={-1.5} x2={3.8} y2={-1.5} stroke="rgba(180,210,230,0.55)" strokeWidth={0.4} />
          <text x={0} y={-5} fontSize={11} textAnchor="middle" dominantBaseline="middle">
            🌸
          </text>
          <text x={-7} y={-10} fontSize={6} textAnchor="middle" dominantBaseline="middle">
            🌸
          </text>
          <text x={6} y={-8} fontSize={6} textAnchor="middle" dominantBaseline="middle">
            🌷
          </text>
        </g>
      );
    case "summer-fan":
      return (
        <g>
          {/* Pedestal */}
          <rect x={-3} y={1} width={6} height={4} fill="#777" rx={0.6} />
          <rect x={-3} y={1} width={6} height={0.6} fill="rgba(255,255,255,0.4)" />
          <rect x={-0.6} y={-4} width={1.2} height={5} fill="#777" />
          {/* Fan body — silver metal grad. */}
          <g
            style={{
              transformOrigin: "0 -6px",
              animation: "relayHamletFanSpin 0.9s linear infinite",
            }}
          >
            <circle cx={0} cy={-6} r={5} fill={`url(#${DIORAMA_DEFS.roomMetalSilver})`} stroke="#5A5A5A" strokeWidth={0.6} />
            <line x1={-4} y1={-6} x2={4} y2={-6} stroke="#8C8C8C" strokeWidth={1.2} />
            <line x1={0} y1={-10} x2={0} y2={-2} stroke="#8C8C8C" strokeWidth={1.2} />
            <circle cx={0} cy={-6} r={0.8} fill="#5A5A5A" />
            <circle cx={-1.3} cy={-7.3} r={0.4} fill="rgba(255,255,255,0.85)" />
          </g>
          <text x={6} y={5} fontSize={6} textAnchor="middle" dominantBaseline="middle">
            🍉
          </text>
        </g>
      );
    case "autumn-pumpkin":
      return (
        <g>
          <text x={0} y={0} fontSize={13} textAnchor="middle" dominantBaseline="middle">
            🎃
          </text>
          <ellipse cx={-2.2} cy={-2.2} rx={1.5} ry={0.7} fill="rgba(255,210,140,0.55)" />
          <text x={-6} y={-3} fontSize={6} textAnchor="middle" dominantBaseline="middle">
            🍁
          </text>
          <text x={7} y={3} fontSize={6} textAnchor="middle" dominantBaseline="middle">
            🌰
          </text>
        </g>
      );
    case "winter-kotatsu":
      return (
        <g>
          {/* Kotatsu — red top + futon skirt with 3-tone shading + flame glow. */}
          <ellipse cx={0} cy={6} rx={11} ry={1.8} fill="rgba(0,0,0,0.25)" />
          <rect x={-9} y={-4} width={18} height={6} fill="#C97A6A" rx={0.6} />
          <rect x={-9} y={-1} width={18} height={5} fill="#F5C2A8" />
          {/* D2 — red top: top highlight band + side shadow. */}
          <rect x={-9} y={-5} width={18} height={1.4} fill="#B33A2A" rx={0.4} />
          <rect x={-9} y={-5} width={18} height={0.5} fill="rgba(255,220,180,0.55)" />
          <rect x={-9} y={-3.7} width={18} height={0.4} fill="rgba(0,0,0,0.30)" />
          <line x1={-7} y1={2} x2={-7} y2={6} stroke="#8B6914" strokeWidth={0.6} />
          <line x1={7} y1={2} x2={7} y2={6} stroke="#8B6914" strokeWidth={0.6} />
          {/* Flame in a tiny grate */}
          <g style={{ animation: "relayHamletFireplaceFlame 1.6s ease-in-out infinite" }}>
            <circle cx={0} cy={-7} r={3} fill="rgba(255,180,80,0.45)" />
            <text x={0} y={-7} fontSize={5} textAnchor="middle" dominantBaseline="middle">
              🔥
            </text>
          </g>
        </g>
      );
  }
}

export interface ChristmasTreeProps {
  visible: boolean;
}

export function ChristmasTree({ visible }: ChristmasTreeProps) {
  if (!visible) return null;
  // Render in the back-right corner of the floor — clear of the avatar.
  const { sx, sy } = mapFloor(0.88, 0.55);
  return (
    <g transform={`translate(${sx}, ${sy})`} aria-hidden>
      {/* D2 — ground shadow + ornament sparkles. */}
      <ellipse cx={0} cy={11} rx={11} ry={1.5} fill="rgba(0,0,0,0.30)" />
      <text x={0} y={0} fontSize={20} textAnchor="middle" dominantBaseline="middle">
        🎄
      </text>
      <text x={0} y={-12} fontSize={5} textAnchor="middle" dominantBaseline="middle">
        ⭐
      </text>
      {/* Sparkles */}
      <circle cx={-5} cy={2} r={0.8} fill="rgba(255,250,180,0.9)" />
      <circle cx={4.5} cy={-3} r={0.7} fill="rgba(255,200,200,0.9)" />
      <circle cx={-2} cy={-5} r={0.6} fill="rgba(180,255,200,0.9)" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// E2 — Meal table
// ---------------------------------------------------------------------------

export interface MealTableProps {
  meal: MealItem;
  slot: MealSlot | undefined;
}

export function MealTable({ meal, slot }: MealTableProps) {
  if (!slot) return null;
  const { sx, sy } = mapFloor(slot.x, slot.y);
  return (
    <g transform={`translate(${sx}, ${sy})`} aria-hidden>
      {/* Plate / placemat */}
      <ellipse cx={0} cy={2.5} rx={8} ry={2} fill="rgba(0,0,0,0.18)" />
      <ellipse cx={0} cy={1.5} rx={7} ry={2.2} fill="#FAFAF5" stroke="#C7B59B" strokeWidth={0.5} />
      {/* D2 — plate rim highlight (top-left crescent). */}
      <path d="M -6.2 0 A 7 2.2 0 0 1 -1 -0.8" stroke="rgba(255,255,255,0.85)" strokeWidth={0.5} fill="none" />
      <text
        x={meal.secondary ? -2 : 0}
        y={-2}
        fontSize={9}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {meal.primary}
      </text>
      {meal.secondary && (
        <text
          x={4}
          y={-1}
          fontSize={6}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {meal.secondary}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export const ROOM_TEMPORAL_CSS = `
@keyframes relayHamletFanSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes relayHamletFireplaceFlame {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.95; }
  50% { transform: translate(0.4px, -0.6px) scale(1.08); opacity: 1; }
}
`;
