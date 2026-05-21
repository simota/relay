"use client";

// Fleet Hamlet — Room Scene "Companion / Emotion" layer (R5: F1 + G1).
//
// PetSvg     — agent-kind specific pet (cat / dog / bird / hamster), drawn
//              as an emoji with a breath / sleep / wag animation.
// PetGroup   — convenience renderer that places 1..2 pets in their slots.
// MoodWallpaper — paints a wall + bottom band coloured by the resident's
//              mood palette, plus an optional warm overlay that dims the
//              room when the resident is "Asleep".
//
// All animations live in ROOM_COMPANION_CSS.

import type { Pet, MoodPalette } from "../_lib/fleet-hamlet-room-companion";
import type { PetSlot } from "../_lib/fleet-hamlet-room-furniture";

// ---------------------------------------------------------------------------
// Scene constants
// ---------------------------------------------------------------------------

const SCENE_W = 360;
const SCENE_H = 220;
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
// F1 — Pet emoji
// ---------------------------------------------------------------------------

const PET_GLYPH: Record<Pet["kind"], { awake: string; asleep: string }> = {
  cat: { awake: "🐈", asleep: "🐈" },
  dog: { awake: "🐕", asleep: "🐕" },
  bird: { awake: "🐦", asleep: "🐦" },
  hamster: { awake: "🐹", asleep: "🐹" },
};

export interface PetSvgProps {
  pet: Pet;
  /** Slot position on the floor. */
  slot: PetSlot;
}

export function PetSvg({ pet, slot }: PetSvgProps) {
  const { sx, sy } = mapFloor(slot.x, slot.y);
  const glyph = PET_GLYPH[pet.kind];
  const text = pet.state === "asleep" ? glyph.asleep : glyph.awake;
  const baseAnim =
    pet.state === "asleep"
      ? `relayHamletPetSleep 3.6s ease-in-out ${pet.index * 0.4}s infinite`
      : pet.kind === "dog"
        ? `relayHamletPetWag 1.4s ease-in-out ${pet.index * 0.3}s infinite`
        : `relayHamletPetBreathe 2.6s ease-in-out ${pet.index * 0.4}s infinite`;
  // Asleep pets render rotated slightly so they read as "lying down".
  const lay = pet.state === "asleep" ? 70 : 0;
  return (
    <g transform={`translate(${sx}, ${sy})`} aria-hidden>
      <ellipse cx={0} cy={4} rx={6} ry={1.4} fill="rgba(0,0,0,0.28)" />
      <g
        style={{
          animation: baseAnim,
          transformOrigin: "center",
        }}
      >
        <g transform={`rotate(${lay})`}>
          <text
            x={0}
            y={0}
            fontSize={12}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.3))" }}
          >
            {text}
          </text>
        </g>
      </g>
      {pet.state === "asleep" && (
        <text
          x={6}
          y={-6}
          fontSize={5}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(40,60,120,0.85)"
          style={{ fontFamily: "ui-monospace, monospace" }}
        >
          💤
        </text>
      )}
    </g>
  );
}

export interface PetGroupProps {
  pets: readonly Pet[];
  slots: readonly PetSlot[];
}

export function PetGroup({ pets, slots }: PetGroupProps) {
  if (pets.length === 0 || slots.length === 0) return null;
  const limit = Math.min(pets.length, slots.length);
  return (
    <g aria-hidden>
      {Array.from({ length: limit }).map((_, i) => {
        const pet = pets[i];
        const slot = slots[i];
        if (!pet || !slot) return null;
        return <PetSvg key={`pet-${i}`} pet={pet} slot={slot} />;
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// G1 — Mood wallpaper
//
// Paints a solid wall + bottom band coloured by `palette`, sitting on top
// of the default `<RoomBackWall>`. Keeping it as an overlay (instead of
// editing the RoomBackWall component) means R1+R2 stay untouched.
// ---------------------------------------------------------------------------

export interface MoodWallpaperProps {
  palette: MoodPalette;
}

export function MoodWallpaper({ palette }: MoodWallpaperProps) {
  const wallTop = `hsl(${palette.wallH}, ${palette.wallS}%, ${palette.wallL}%)`;
  const wallBottom = `hsl(${palette.wallH}, ${palette.wallS}%, ${palette.wallBottomL}%)`;
  const gradId = "relay-room-mood-wall-grad";
  return (
    <g aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={wallTop} />
          <stop offset="100%" stopColor={wallBottom} />
        </linearGradient>
      </defs>
      <rect
        x={0}
        y={0}
        width={SCENE_W}
        height={120}
        fill={`url(#${gradId})`}
        opacity={0.78}
      />
      {palette.dimOverlay && (
        <rect
          x={0}
          y={0}
          width={SCENE_W}
          height={SCENE_H}
          fill="rgba(10, 14, 38, 0.32)"
        />
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export const ROOM_COMPANION_CSS = `
@keyframes relayHamletPetBreathe {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(0, -0.4px) scale(1.04); }
}
@keyframes relayHamletPetSleep {
  0%, 100% { transform: translate(0, 0); opacity: 0.95; }
  50% { transform: translate(0, -0.2px); opacity: 1; }
}
@keyframes relayHamletPetWag {
  0%, 100% { transform: translate(-0.4px, 0) rotate(-3deg); }
  50% { transform: translate(0.4px, 0) rotate(3deg); }
}
`;
