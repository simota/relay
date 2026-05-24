"use client";

// Fleet Hamlet — Park Resident Layer.
//
// Gimmick A.2 — non-active residents are out at the park. Renders three
// kinds of mini-avatars:
//   1. "Next-to-house" stander — one per tiny house cell, anchored to the
//      cell's bottom-right corner so the user reads "this resident is
//      out, in front of their own little house".
//   2. "Strollers" — 2-3 extra mini avatars scattered across the park
//      between cells to add life.
//   3. "Bench sitters" — 1-2 bench glyphs with a small sitting avatar so
//      the park looks like more than just a row of houses.
//
// All positioning is deterministic given the card set + park geometry so
// repeated renders don't make residents teleport.

import type { SimCardModel } from "../_lib/fleet-hamlet";
import { avatarPartsFromSeed, hashStringToInt } from "../_lib/fleet-hamlet";
import {
  HeadFace,
  avatarStyleFromSeed,
  clothingForStyle,
} from "./fleet-hamlet-avatar";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";
import { DIORAMA_DEFS } from "../_lib/fleet-hamlet-diorama-tokens";

interface Props {
  cards: readonly SimCardModel[];
  cellW: number;
  cellH: number;
  rows: number;
  cols: number;
  /** Total park-zone width — used to bound stroller / bench positions. */
  totalW: number;
  /** Total park-zone height — same purpose. */
  totalH: number;
}

export function ParkResidentLayer({
  cards,
  cellW,
  cellH,
  rows,
  cols,
  totalW,
  totalH,
}: Props) {
  if (cards.length === 0 || cellW < 18 || cellH < 18) return null;
  // Compute extras count from the park footprint — clamp at 4 strollers + 2
  // bench sitters so the layer never overwhelms the tiny houses.
  const strollerCount = Math.min(
    4,
    Math.max(2, Math.floor(Math.min(rows, cols) * 0.9 + 1)),
  );
  const benchCount = Math.min(2, Math.max(1, Math.floor(cols / 2)));
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {/* 1. Next-to-house residents */}
      {cards.map((sim, i) => {
        const col = i % Math.max(1, cols);
        const row = Math.floor(i / Math.max(1, cols));
        const seed = hashStringToInt(sim.key);
        // Avatar sits ~25% to the right of the house, ~75% down the cell.
        const left = col * cellW + cellW * 0.68 + ((seed % 6) - 3);
        const top = row * cellH + cellH * 0.58 + ((seed % 4) - 2);
        return (
          <span
            key={`r-${sim.key}`}
            style={{
              position: "absolute",
              left,
              top,
              transform: "scale(0.85)",
              transformOrigin: "center",
              opacity: 0.9,
            }}
          >
            <StandingMiniAvatar
              agentKind={sim.sessionType}
              hue={sim.hue}
              sim={sim}
            />
          </span>
        );
      })}

      {/* 2. Strollers — between cells, no specific owner. */}
      {Array.from({ length: strollerCount }).map((_, i) => {
        // Use card seeds to vary positions deterministically, falling back
        // to row indices when there aren't enough cards.
        const refSim = cards[i % cards.length];
        const seed = refSim ? hashStringToInt(refSim.key) + i * 71 : i * 71;
        const left = ((seed * 11) % Math.max(40, totalW - 30));
        const top = (cellH * 0.5) + ((seed * 13) % Math.max(20, totalH - cellH));
        // Half the strollers face left.
        const flip = (seed & 2) === 0;
        return (
          <span
            key={`s-${i}`}
            style={{
              position: "absolute",
              left,
              top,
              transformOrigin: "center",
              animation: `relayHamletParkSway ${(3.6 + (seed % 9) / 4).toFixed(2)}s ease-in-out ${-((seed % 11) / 4).toFixed(2)}s infinite`,
              opacity: 0.85,
              display: "inline-block",
            }}
          >
            <span
              style={{
                display: "inline-block",
                transform: flip ? "scaleX(-1)" : undefined,
              }}
            >
              <StandingMiniAvatar
                agentKind={refSim?.sessionType ?? "claude"}
                hue={refSim?.hue ?? 200}
                sim={refSim}
              />
            </span>
          </span>
        );
      })}

      {/* 3. Benches — 1-2 placed deterministically inside the park zone. */}
      {Array.from({ length: benchCount }).map((_, i) => {
        const seed = (i + 1) * 211;
        const left = ((seed * 17) % Math.max(60, totalW - 80));
        const top = Math.max(
          cellH * 0.5,
          Math.min(totalH - 30, totalH * (i === 0 ? 0.45 : 0.78)),
        );
        const sitterSim = cards[i % cards.length];
        return (
          <span
            key={`b-${i}`}
            style={{ position: "absolute", left, top }}
          >
            <BenchSvg />
            <span
              style={{
                position: "absolute",
                left: 4,
                top: -10,
                transform: "scale(0.7)",
                transformOrigin: "left top",
              }}
            >
              <SittingMiniAvatar
                agentKind={sitterSim?.sessionType ?? "claude"}
                hue={sitterSim?.hue ?? 200}
                sim={sitterSim}
              />
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StandingMiniAvatar — head + body + two legs + shoes. Compact and built
// on the shared HeadFace primitive so the park residents share the same
// character family as the Sim Card / Room avatars.
// ---------------------------------------------------------------------------

export function StandingMiniAvatar({
  agentKind,
  hue,
  sim,
}: {
  agentKind: SimCardModel["sessionType"];
  hue: number;
  sim?: SimCardModel;
}) {
  const seed = sim?.avatarSeed ?? hashStringToInt(`${agentKind}:${hue}`);
  const parts = avatarPartsFromSeed(seed);
  const moodKey = sim?.mood.key ?? "happy";
  const expression = getExpressionForMood(moodKey);
  const stylePreset = avatarStyleFromSeed(seed, agentKind);
  const clothes = clothingForStyle(agentKind, stylePreset);
  return (
    <svg width={18} height={24} viewBox="0 0 18 24" aria-hidden overflow="visible">
      <ellipse cx={9} cy={22} rx={6.2} ry={1.5} fill="rgba(0,0,0,0.28)" />
      <ellipse
        cx={9}
        cy={21.4}
        rx={4.6}
        ry={0.9}
        fill={clothes.accent}
        opacity={0.45}
      />
      <g
        style={{
          animation: `relayHamletIdleBreathe 4s ease-in-out ${parts.breatheDelay}s infinite`,
          transformOrigin: "center",
        }}
      >
        {/* Torso */}
        <path
          d={`M 6.1 7.8 L 6.6 10.5 L 6.1 15.7 L 11.9 15.7 L 11.4 10.5 L 11.9 7.8 Z`}
          fill={clothes.shirt}
          stroke="rgba(25,25,25,0.35)"
          strokeWidth={0.25}
        />
        <path
          d={`M 9 7.8 L 11.9 7.8 L 11.4 10.5 L 11.9 15.7 L 9 15.7 Z`}
          fill={clothes.shirtDark}
          opacity={0.4}
        />
        {/* Collar */}
        <path d="M 6.7 7.8 L 9 9.4 L 11.3 7.8 L 9 10.1 Z" fill={clothes.accent} />
        {stylePreset === "taisho-wagara" && (
          <g opacity={0.92}>
            <path d="M 5.7 8 L 7.4 8.8 L 7 15.3 L 5.6 15.1 Z" fill="hsl(176, 48%, 54%)" />
            <path d="M 10.6 8.8 L 12.3 8 L 12.4 15.1 L 11 15.3 Z" fill="hsl(218, 40%, 28%)" />
            <path d="M 6.1 11 L 6.9 11.8 L 6.1 12.6 M 11.9 11 L 11.1 11.8 L 11.9 12.6" fill="none" stroke="hsla(42, 86%, 82%, 0.78)" strokeWidth={0.28} strokeLinecap="round" />
          </g>
        )}
        {stylePreset === "occult-academy" && (
          <g>
            <path d="M 6.6 8 L 11.4 8 L 11.8 15.5 L 6.2 15.5 Z" fill="hsla(250, 35%, 12%, 0.7)" />
            <circle cx={9} cy={11.8} r={0.62} fill="none" stroke="hsl(45, 90%, 75%)" strokeWidth={0.26} />
          </g>
        )}
        {/* Legs + shoes */}
        <rect x={6.8} y={15.6} width={1.7} height={4.8} rx={0.5} fill="#4A382C" />
        <rect x={9.5} y={15.6} width={1.7} height={4.8} rx={0.5} fill="#4A382C" />
        <ellipse cx={7.7} cy={20.8} rx={1.35} ry={0.65} fill="#1F1410" />
        <ellipse cx={10.4} cy={20.8} rx={1.35} ry={0.65} fill="#1F1410" />
        {/* Head */}
        <g transform="translate(9, 4.4)">
          <HeadFace
            parts={parts}
            expression={expression}
            radius={3.65}
            enableBlink={false}
            enableCheeks={false}
          />
        </g>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SittingMiniAvatar — torso + legs extended forward, sized to perch on the
// bench. Uses the shared HeadFace primitive for facial features.
// ---------------------------------------------------------------------------

function SittingMiniAvatar({
  agentKind,
  hue,
  sim,
}: {
  agentKind: SimCardModel["sessionType"];
  hue: number;
  sim?: SimCardModel;
}) {
  const seed = sim?.avatarSeed ?? hashStringToInt(`${agentKind}:${hue}`);
  const parts = avatarPartsFromSeed(seed);
  const moodKey = sim?.mood.key ?? "happy";
  const expression = getExpressionForMood(moodKey);
  const stylePreset = avatarStyleFromSeed(seed, agentKind);
  const clothes = clothingForStyle(agentKind, stylePreset);
  return (
    <svg width={18} height={20} viewBox="0 0 18 20" aria-hidden overflow="visible">
      {/* Torso */}
      <path
        d={`M 3.2 7 L 3.6 9.5 L 3.2 14 L 8.6 14 L 8.4 9.5 L 8.6 7 Z`}
        fill={clothes.shirt}
      />
      <path d="M 4 7 L 6 8.4 L 8 7 L 6 9 Z" fill={clothes.accent} />
      {stylePreset === "taisho-wagara" && (
        <g opacity={0.92}>
          <path d="M 2.9 7.2 L 4.5 8 L 4.2 13.8 L 2.8 13.8 Z" fill="hsl(176, 48%, 54%)" />
          <path d="M 7.5 8 L 9.1 7.2 L 9 13.8 L 7.8 13.8 Z" fill="hsl(218, 40%, 28%)" />
        </g>
      )}
      {stylePreset === "occult-academy" && (
        <g>
          <path d="M 3.6 7.2 L 8.2 7.2 L 8.4 14 L 3.4 14 Z" fill="hsla(250, 35%, 12%, 0.7)" />
          <circle cx={6} cy={10.6} r={0.55} fill="none" stroke="hsl(45, 90%, 75%)" strokeWidth={0.24} />
        </g>
      )}
      {/* Upper leg extended forward (horizontal) */}
      <rect x={5} y={13.5} width={8.5} height={2.2} rx={0.7} fill="#4A382C" />
      {/* Lower leg (vertical) */}
      <rect x={11.5} y={14} width={2} height={4.2} rx={0.7} fill="#4A382C" />
      <ellipse cx={12.5} cy={18.5} rx={1.5} ry={0.6} fill="#1F1410" />
      {/* Head */}
      <g transform="translate(6, 4)">
        <HeadFace
          parts={parts}
          expression={expression}
          radius={3.2}
          enableBlink={false}
          enableCheeks={false}
        />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// BenchSvg — a small wooden park bench, big enough for one mini-avatar.
// ---------------------------------------------------------------------------

function BenchSvg() {
  return (
    <svg width={26} height={16} viewBox="0 0 26 16" aria-hidden>
      {/* Ground shadow */}
      <ellipse cx={13} cy={14.5} rx={11} ry={1} fill="rgba(0,0,0,0.28)" />
      {/* Seat plank — base + wood grain + top highlight */}
      <rect x={1} y={6} width={24} height={2.4} rx={0.6} fill="#8C6A3F" />
      {/* F-3 — wood-grain texture overlay on the seat plank. */}
      <rect
        x={1}
        y={6}
        width={24}
        height={2.4}
        rx={0.6}
        fill="#5E4226"
        filter={`url(#${DIORAMA_DEFS.woodGrain})`}
        opacity={0.28}
      />
      <rect x={1} y={6} width={24} height={0.6} rx={0.4} fill="#B58A55" opacity={0.85} />
      <line x1={1} y1={7} x2={25} y2={7} stroke="#5E4226" strokeWidth={0.2} opacity={0.6} />
      {/* Back slat */}
      <rect x={1} y={4} width={24} height={1.6} rx={0.4} fill="#A07F4D" />
      {/* F-3 — wood-grain texture overlay on the back slat. */}
      <rect
        x={1}
        y={4}
        width={24}
        height={1.6}
        rx={0.4}
        fill="#5E4226"
        filter={`url(#${DIORAMA_DEFS.woodGrain})`}
        opacity={0.24}
      />
      <rect x={1} y={4} width={24} height={0.4} rx={0.4} fill="#C99E64" opacity={0.85} />
      {/* Legs — metal-ish darker stock with highlight stripe */}
      <rect x={2.5} y={8.5} width={1.6} height={5} fill="#6E4F2C" />
      <rect x={2.5} y={8.5} width={0.4} height={5} fill="#9F7A4E" opacity={0.85} />
      <rect x={21.9} y={8.5} width={1.6} height={5} fill="#6E4F2C" />
      <rect x={21.9} y={8.5} width={0.4} height={5} fill="#9F7A4E" opacity={0.85} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// CSS — appended to the neighborhood <style> block.
// ---------------------------------------------------------------------------

export const PARK_RESIDENT_CSS = `
@keyframes relayHamletParkSway {
  0%, 100% { transform: translate(0, 0); }
  50%      { transform: translate(2px, -1px); }
}
`;
