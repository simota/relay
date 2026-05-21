"use client";

// Fleet Hamlet — Tiny House SVG (overflow fallback).
//
// Used when the village has so many households that the regular HouseSvg
// can't shrink any further without losing legibility. The tiny variant
// drops the chimney smoke, side wall isometric tilt, and second window so
// each house occupies only ~48px and still reads as a "house with a roof".
//
// Same color logic as HouseSvg so the village-wide palette mapping
// (repo → roof hue, agent → wall hue shift) stays consistent.

import type { LifeEvent } from "../_lib/fleet-hamlet-events";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import type { Bustle } from "../_lib/fleet-hamlet-bustle";
import { agentHueShift, hashRepoToHue } from "../_lib/fleet-hamlet-layout";

interface TinyHouseSvgProps {
  sim: SimCardModel;
  /** Pixel size (square box). Caller is responsible for layout. */
  size: number;
  /** Recently-active → windows lit. */
  chimneyActive: boolean;
  /** Selected / highlighted in the panel — adds a soft drop shadow. */
  highlight?: boolean;
  /** Park residents — dim + no window glow. */
  dim?: boolean;
  /** Top-priority event — only `fire` and `achievement` render at tiny scale. */
  event?: LifeEvent;
  /** Night-time window glow. */
  windowsLit?: boolean;
  /** Tiny mode shows only minimal bustle (one note + aura at lively+). */
  bustle?: Bustle;
}

export function TinyHouseSvg({
  sim,
  size,
  chimneyActive,
  highlight,
  dim,
  event,
  windowsLit,
  bustle,
}: TinyHouseSvgProps) {
  const roofHue = hashRepoToHue(sim.repo);
  const wallHueShift = agentHueShift(sim.sessionType);
  const wallHue = (roofHue + wallHueShift + 360) % 360;

  const roofColor = `hsl(${roofHue}, 55%, 45%)`;
  const wallFront = `hsl(${wallHue}, 30%, 65%)`;
  const winLit = chimneyActive && !dim;
  const nightGlow = !!windowsLit && !dim;
  const winFill = nightGlow
    ? "hsl(48, 95%, 65%)"
    : winLit
    ? `hsl(${(roofHue + 50) % 360}, 90%, 65%)`
    : "hsl(220, 15%, 30%)";

  // viewBox is fixed at 32 — the wrapper scales via width/height attributes.
  const VB = 32;
  const eaveY = 14;
  const ridgeY = 4;

  const achievementGlow = event?.kind === "achievement";
  const onFire = event?.kind === "fire";
  const bustleActive = !!bustle && bustle.intensity !== "quiet" && !dim;
  // Tiny mode renders one music note + a soft golden aura — no multi-window
  // pulse, no colored smoke (over-saturates the 32px viewBox).
  const bustleFilter = bustleActive
    ? bustle?.intensity === "party"
      ? "drop-shadow(0 0 5px hsla(45, 95%, 65%, 0.95))"
      : "drop-shadow(0 0 3px hsla(45, 90%, 60%, 0.75))"
    : undefined;
  const noteHue =
    bustleActive && bustle && bustle.subagentHues.length > 0
      ? bustle.subagentHues[0]
      : 280;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VB} ${VB}`}
      aria-hidden
      style={{
        filter: achievementGlow
          ? "drop-shadow(0 0 4px hsla(45, 95%, 60%, 0.9))"
          : bustleFilter
          ? bustleFilter
          : highlight
          ? "drop-shadow(0 2px 3px rgba(0,0,0,0.3))"
          : undefined,
        opacity: dim ? 0.75 : 1,
        animation: bustleActive
          ? `relayHamletBustleAura ${bustle?.intensity === "party" ? "2.2" : "3.2"}s ease-in-out infinite`
          : undefined,
      }}
    >
      {/* Ground shadow */}
      <ellipse
        cx={VB / 2}
        cy={VB - 1}
        rx={VB * 0.4}
        ry={1.2}
        fill="var(--color-fg-dim)"
        opacity={0.35}
      />
      {/* Front wall — mid tone */}
      <rect
        x={VB * 0.22}
        y={eaveY}
        width={VB * 0.56}
        height={VB - eaveY - 2}
        fill={wallFront}
      />
      {/* Wall highlight band (left) */}
      <rect
        x={VB * 0.22}
        y={eaveY}
        width={VB * 0.13}
        height={VB - eaveY - 2}
        fill={`hsl(${wallHue}, 38%, 78%)`}
        opacity={0.55}
      />
      {/* Wall shadow band (right) */}
      <rect
        x={VB * 0.65}
        y={eaveY}
        width={VB * 0.13}
        height={VB - eaveY - 2}
        fill={`hsl(${wallHue}, 28%, 48%)`}
        opacity={0.55}
      />
      {/* Roof — shadow half (right) */}
      <polygon
        points={`${VB * 0.5},${eaveY} ${VB * 0.5},${ridgeY} ${VB * 0.85},${eaveY}`}
        fill={`hsl(${roofHue}, 55%, 32%)`}
      />
      {/* Roof — lit half (left) */}
      <polygon
        points={`${VB * 0.15},${eaveY} ${VB * 0.5},${ridgeY} ${VB * 0.5},${eaveY}`}
        fill={`hsl(${roofHue}, 60%, 55%)`}
      />
      {/* Roof ridge highlight */}
      <line
        x1={VB * 0.5}
        y1={ridgeY}
        x2={VB * 0.5}
        y2={eaveY}
        stroke={`hsl(${roofHue}, 70%, 72%)`}
        strokeWidth={0.4}
        opacity={0.7}
      />
      {/* Door */}
      <rect
        x={VB * 0.43}
        y={VB - 8}
        width={VB * 0.14}
        height={6}
        fill="hsl(25, 35%, 25%)"
        rx={0.5}
      />
      {/* Door shadow side */}
      <rect
        x={VB * 0.55}
        y={VB - 8}
        width={VB * 0.02}
        height={6}
        fill="rgba(0,0,0,0.35)"
      />
      {/* Single window — outer frame + sash + glass */}
      <rect
        x={VB * 0.26}
        y={eaveY + 1.6}
        width={VB * 0.18}
        height={VB * 0.18}
        fill="hsl(20, 30%, 18%)"
        rx={0.3}
      />
      <rect
        x={VB * 0.27}
        y={eaveY + 2}
        width={VB * 0.16}
        height={VB * 0.16}
        fill={winFill}
        stroke="hsl(0, 0%, 15%)"
        strokeWidth={0.4}
      />
      {/* Window inner reflection (top-left) — skipped when lit */}
      {!winLit && !nightGlow && (
        <polygon
          points={`${VB * 0.28},${eaveY + 2.3} ${VB * 0.33},${eaveY + 2.3} ${VB * 0.28},${eaveY + 4}`}
          fill="rgba(255,255,255,0.55)"
        />
      )}
      {/* Fire overlay — small flame on the roof */}
      {onFire && (
        <text
          x={VB / 2}
          y={ridgeY + 2}
          textAnchor="middle"
          fontSize={6}
          aria-hidden
        >
          🔥
        </text>
      )}
      {/* Bustle: single rising music note in tiny mode. */}
      {bustleActive && !onFire && (
        <text
          x={VB * 0.62}
          y={ridgeY + 1}
          fontSize={5.5}
          fill={`hsl(${noteHue}, 75%, 60%)`}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={0.2}
          textAnchor="middle"
          aria-hidden
          style={{
            animation: `relayHamletMusicNoteRise ${bustle?.intensity === "party" ? "1.8" : "2.6"}s ease-out infinite`,
            transformOrigin: `${VB * 0.62}px ${ridgeY + 1}px`,
          }}
        >
          ♪
        </text>
      )}
    </svg>
  );
}
