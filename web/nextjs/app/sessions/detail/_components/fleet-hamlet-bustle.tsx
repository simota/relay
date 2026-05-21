"use client";

// Fleet Hamlet — Bustle SVG overlays.
//
// Visual effects added on top of an active `<HouseSvg>` when one or more
// sub-agents are working under a parent session. The component set is
// pure-SVG + CSS keyframes so it composes inside the existing house SVG
// without any new dependency. All sprite counts are budgeted via
// `bustleSpriteCount()` to keep the page-wide SVG-node count under 350
// even at `party` intensity.

import type { Bustle, BustleIntensity } from "../_lib/fleet-hamlet-bustle";
import { bustleSpriteCount } from "../_lib/fleet-hamlet-bustle";

// ---------------------------------------------------------------------------
// MultiWindowGlow — replaces the single static window when bustle > quiet.
// Renders `count` window rectangles in a row, each pulsing in a staggered
// cycle so the house reads as "many rooms with people inside".
// ---------------------------------------------------------------------------

export function MultiWindowGlow({
  x,
  y,
  cellW,
  cellH,
  count,
  hues,
  baseFill,
  period = 1.4,
}: {
  /** Top-left x of the row, in the house SVG's local coords. */
  x: number;
  y: number;
  /** Full width / height of a single window slot. */
  cellW: number;
  cellH: number;
  count: number;
  hues: readonly number[];
  /** Color used for "off" windows (fallback). */
  baseFill: string;
  /** Animation period in seconds — shorter for `party`, longer for `lively`. */
  period?: number;
}) {
  if (count <= 0) return null;
  const safeCount = Math.min(count, 6);
  // Lay windows out left → right; gap = 10% of cellW between each.
  const gap = cellW * 0.18;
  const totalW = safeCount * cellW + (safeCount - 1) * gap;
  return (
    <g aria-hidden>
      {Array.from({ length: safeCount }).map((_, i) => {
        const hue = hues[i % Math.max(1, hues.length)] ?? 48;
        const fill = `hsl(${hue}, 90%, 65%)`;
        const delay = -(i * (period / safeCount));
        const wx = x + i * (cellW + gap) - totalW / 2 + cellW / 2;
        return (
          <rect
            key={i}
            x={wx}
            y={y}
            width={cellW}
            height={cellH}
            rx={0.6}
            fill={fill}
            stroke="hsl(0, 0%, 15%)"
            strokeWidth={0.6}
            style={{
              animation: `relayHamletMultiWindowGlow ${period.toFixed(2)}s ease-in-out ${delay.toFixed(2)}s infinite`,
              color: fill,
            }}
          />
        );
      })}
      {/* dark "off" pad behind to keep the row visible during the fade trough */}
      <rect
        x={x - totalW / 2}
        y={y - 0.5}
        width={totalW}
        height={cellH + 1}
        fill={baseFill}
        opacity={0.0}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// RoofMusicNotes — small note glyphs rising from the roof ridge.
// Each note has its own delay and horizontal sway so they look like an
// uncoordinated party.
// ---------------------------------------------------------------------------

export function RoofMusicNotes({
  count,
  hues,
  ridgeX,
  ridgeY,
  intensity,
}: {
  count: number;
  hues: readonly number[];
  ridgeX: number;
  ridgeY: number;
  intensity: BustleIntensity;
}) {
  if (count <= 0) return null;
  const safeCount = Math.min(count, 5);
  // Faster cycle on party, slower on lively, so the eye gets the difference.
  const dur =
    intensity === "party" ? 1.8 : intensity === "busy" ? 2.4 : 3.0;
  return (
    <g aria-hidden>
      {Array.from({ length: safeCount }).map((_, i) => {
        const hue = hues[i % Math.max(1, hues.length)] ?? 280;
        const fill = `hsl(${hue}, 75%, 60%)`;
        const offsetX = (i - (safeCount - 1) / 2) * 4;
        const delay = -((i * dur) / safeCount);
        // Even = single-flag note, odd = double-flag → visual variety.
        const shape = i % 2 === 0 ? "♪" : "♫";
        return (
          <text
            key={i}
            x={ridgeX + offsetX}
            y={ridgeY}
            fontSize={6.5}
            textAnchor="middle"
            fill={fill}
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={0.2}
            style={{
              animation: `relayHamletMusicNoteRise ${dur.toFixed(2)}s ease-out ${delay.toFixed(2)}s infinite`,
              transformOrigin: `${ridgeX + offsetX}px ${ridgeY}px`,
            }}
          >
            {shape}
          </text>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// ChimneySmoke — replaces the default uni-color smoke trio with N puffs in
// per-subagent hues. Drawn straight on top of the chimney top.
// ---------------------------------------------------------------------------

export function BustleChimneySmoke({
  cx,
  cy,
  colors,
  density,
}: {
  cx: number;
  cy: number;
  colors: readonly number[];
  density: number;
}) {
  if (density <= 0) return null;
  const safeCount = Math.min(density, 4);
  return (
    <g aria-hidden>
      {Array.from({ length: safeCount }).map((_, i) => {
        const hue = colors[i % Math.max(1, colors.length)] ?? 30;
        const fill = `hsl(${hue}, 65%, 70%)`;
        const r = 2.4 - i * 0.35;
        const delay = (i * 0.5).toFixed(2);
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={Math.max(1.2, r)}
            fill={fill}
            opacity={0.78 - i * 0.12}
            style={{
              animation: `relayHamletColorSmoke 2.6s ease-out ${delay}s infinite`,
            }}
          />
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// HouseAura — drop-shadow / glow pulsing around the whole house. Rendered
// as an outer wrapper <g> with a CSS animated drop-shadow filter. Only used
// at `busy` and above.
// ---------------------------------------------------------------------------

export function HouseAura({
  intensity,
  children,
}: {
  intensity: BustleIntensity;
  children: React.ReactNode;
}) {
  const cfg = bustleSpriteCount(intensity);
  if (!cfg.aura) return <>{children}</>;
  const strength = intensity === "party" ? 1 : 0.6;
  return (
    <g
      aria-hidden
      style={{
        // CSS variable picked up by the keyframe so we can vary intensity
        // without forking the keyframe itself.
        ["--relay-bustle-aura-strength" as unknown as string]: `${strength}`,
        animation: `relayHamletBustleAura ${intensity === "party" ? 2.2 : 3.2}s ease-in-out infinite`,
      }}
    >
      {children}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Shared CSS — append to the consumer's <style> block.
// ---------------------------------------------------------------------------

export const BUSTLE_CSS = `
@keyframes relayHamletMultiWindowGlow {
  0%, 100% { fill-opacity: 0.45; filter: drop-shadow(0 0 0.5px currentColor); }
  50%      { fill-opacity: 1;    filter: drop-shadow(0 0 3.5px currentColor); }
}
@keyframes relayHamletMusicNoteRise {
  0%   { transform: translate(0, 0)    rotate(-6deg); opacity: 0; }
  15%  { opacity: 0.95; }
  60%  { transform: translate(2px, -14px) rotate(8deg); opacity: 0.9; }
  100% { transform: translate(-2px, -28px) rotate(-4deg); opacity: 0; }
}
@keyframes relayHamletColorSmoke {
  0%   { transform: translate(0, 0) scale(0.55); opacity: 0; }
  20%  { opacity: 0.85; }
  100% { transform: translate(-3px, -26px) scale(1.55); opacity: 0; }
}
@keyframes relayHamletBustleAura {
  0%, 100% {
    filter: drop-shadow(0 0 calc(2px * var(--relay-bustle-aura-strength, 1)) hsla(45, 95%, 60%, calc(0.45 * var(--relay-bustle-aura-strength, 1))));
  }
  50% {
    filter: drop-shadow(0 0 calc(9px * var(--relay-bustle-aura-strength, 1)) hsla(45, 95%, 65%, calc(0.95 * var(--relay-bustle-aura-strength, 1))));
  }
}
`;

// Re-export so callers can pass a Bustle straight through without grabbing
// it from `_lib/`.
export type { Bustle };
