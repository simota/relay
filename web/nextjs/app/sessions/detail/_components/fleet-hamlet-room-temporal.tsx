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
      <SeasonShape seasonal={seasonal} />
    </g>
  );
}

function SeasonShape({ seasonal }: { seasonal: SeasonalDecor }) {
  switch (seasonal.kind) {
    case "spring-blossom":
      return (
        <g>
          {/* Vase */}
          <path
            d="M -5 4 Q -7 -2 -4 -3 L 4 -3 Q 7 -2 5 4 Z"
            fill="#FAE0EA"
            stroke="#C66E94"
            strokeWidth={0.5}
          />
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
          <rect x={-0.6} y={-4} width={1.2} height={5} fill="#777" />
          {/* Fan body */}
          <g
            style={{
              transformOrigin: "0 -6px",
              animation: "relayHamletFanSpin 0.9s linear infinite",
            }}
          >
            <circle cx={0} cy={-6} r={5} fill="#E0E0E0" stroke="#5A5A5A" strokeWidth={0.6} />
            <line x1={-4} y1={-6} x2={4} y2={-6} stroke="#8C8C8C" strokeWidth={1.2} />
            <line x1={0} y1={-10} x2={0} y2={-2} stroke="#8C8C8C" strokeWidth={1.2} />
            <circle cx={0} cy={-6} r={0.8} fill="#5A5A5A" />
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
          {/* Kotatsu — red top + futon skirt */}
          <ellipse cx={0} cy={6} rx={11} ry={1.8} fill="rgba(0,0,0,0.25)" />
          <rect x={-9} y={-4} width={18} height={6} fill="#C97A6A" rx={0.6} />
          <rect x={-9} y={-1} width={18} height={5} fill="#F5C2A8" />
          <rect x={-9} y={-5} width={18} height={1.4} fill="#B33A2A" rx={0.4} />
          <line x1={-7} y1={2} x2={-7} y2={6} stroke="#8B6914" strokeWidth={0.6} />
          <line x1={7} y1={2} x2={7} y2={6} stroke="#8B6914" strokeWidth={0.6} />
          {/* Flame in a tiny grate */}
          <g style={{ animation: "relayHamletFireplaceFlame 1.6s ease-in-out infinite" }}>
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
      <text x={0} y={0} fontSize={20} textAnchor="middle" dominantBaseline="middle">
        🎄
      </text>
      <text x={0} y={-12} fontSize={5} textAnchor="middle" dominantBaseline="middle">
        ⭐
      </text>
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
