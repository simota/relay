"use client";

// Fleet Hamlet — Room Scene R6 G2: Container Contents.
//
// Wall-anchored Bookshelf and Fridge SVGs whose interior grows with the
// resident's skill XP, age, and Hunger need. Coordinates come from the
// per-room dynamic slot `{ x, y, w, h }` in normalized 0..1 space — the
// parent scene component maps them to viewport pixels exactly like the
// existing whiteboard slot.

import type { ContainerContents } from "../_lib/fleet-hamlet-room-containers";

// ---------------------------------------------------------------------------
// Slot mapping helpers
// ---------------------------------------------------------------------------

/** Wall-anchored rectangular slot in normalized 0..1 space. */
export interface ContainerSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Convert a wall slot to scene pixels — same convention as Whiteboard. */
function mapWallSlot(
  slot: ContainerSlot,
  sceneW: number,
  sceneH: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: slot.x * sceneW,
    // Wall band spans y=0..120 in the scene (back wall) — anchor against it.
    y: slot.y * 120,
    w: slot.w * sceneW,
    h: slot.h * 120,
  };
}

// ---------------------------------------------------------------------------
// Bookshelf
// ---------------------------------------------------------------------------

export interface BookshelfProps {
  slot: ContainerSlot;
  bookCount: number;
  hues: readonly number[];
  sceneW: number;
  sceneH: number;
}

export function Bookshelf({
  slot,
  bookCount,
  hues,
  sceneW,
  sceneH,
}: BookshelfProps) {
  const { x, y, w, h } = mapWallSlot(slot, sceneW, sceneH);
  const shelves = 3;
  const rowH = h / shelves;
  // Distribute books across shelves, top shelf first.
  const perShelf = Array.from({ length: shelves }, (_, i) => {
    const remaining = bookCount - perShelfTotalBefore(bookCount, shelves, i);
    return Math.max(0, Math.min(remaining, Math.ceil(bookCount / shelves)));
  });
  return (
    <g aria-hidden>
      {/* Frame */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#3A2A1F"
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={0.8}
      />
      {/* Inner back panel — slightly lighter so books pop */}
      <rect x={x + 1.5} y={y + 1.5} width={w - 3} height={h - 3} fill="#5A3F2C" />
      {/* Shelf dividers + books per row */}
      {Array.from({ length: shelves }).map((_, row) => {
        const rowY = y + row * rowH;
        const rowBooks = perShelf[row] ?? 0;
        const usableW = w - 4;
        const bookW = Math.max(1.4, Math.min(3.2, usableW / Math.max(rowBooks, 4)));
        return (
          <g key={row}>
            {/* shelf plank */}
            <rect
              x={x + 1}
              y={rowY + rowH - 1.2}
              width={w - 2}
              height={1.2}
              fill="#2A1B12"
            />
            {/* books */}
            {Array.from({ length: rowBooks }).map((__, i) => {
              const hue = hues[(row * 7 + i) % Math.max(1, hues.length)] ?? 30;
              const bookH = rowH * (0.62 + ((i * 37) % 13) * 0.018);
              const bx = x + 2 + i * bookW;
              const by = rowY + rowH - 1.2 - bookH;
              const tilt = (i * 53) % 11 === 0 ? -6 : 0; // occasional leaning book
              return (
                <g
                  key={i}
                  transform={`rotate(${tilt}, ${bx + bookW / 2}, ${by + bookH})`}
                  style={{
                    animation:
                      i % 9 === 0
                        ? `relayHamletBookGlow 6s ease-in-out ${(i % 5) * 0.6}s infinite`
                        : undefined,
                  }}
                >
                  <rect
                    x={bx}
                    y={by}
                    width={bookW * 0.9}
                    height={bookH}
                    fill={`hsl(${hue}, 55%, 45%)`}
                    stroke="rgba(0,0,0,0.4)"
                    strokeWidth={0.3}
                  />
                  {/* spine highlight */}
                  <rect
                    x={bx + 0.2}
                    y={by + 1}
                    width={0.4}
                    height={bookH - 2}
                    fill="rgba(255,255,255,0.35)"
                  />
                </g>
              );
            })}
          </g>
        );
      })}
      {/* Side highlight to give depth */}
      <rect x={x + w - 1.2} y={y + 1} width={1.2} height={h - 2} fill="rgba(0,0,0,0.35)" />
    </g>
  );
}

function perShelfTotalBefore(total: number, shelves: number, row: number): number {
  const each = Math.ceil(total / shelves);
  return Math.min(total, row * each);
}

// ---------------------------------------------------------------------------
// Fridge
// ---------------------------------------------------------------------------

export interface FridgeProps {
  slot: ContainerSlot;
  level: number;
  items: readonly string[];
  sceneW: number;
  sceneH: number;
}

export function Fridge({
  slot,
  level,
  items,
  sceneW,
  sceneH,
}: FridgeProps) {
  const { x, y, w, h } = mapWallSlot(slot, sceneW, sceneH);
  // Vertical split: top freezer (1/3), bottom main door (2/3).
  const topH = h * 0.32;
  const handleX = x + w - 1.4;
  // Door is shown ajar so the interior emoji are visible — translate the
  // bottom door rect slightly right and rotate via transform-origin.
  return (
    <g aria-hidden style={{ animation: "relayHamletFridgeHum 4s ease-in-out infinite" }}>
      {/* Body shadow */}
      <rect
        x={x - 0.6}
        y={y - 0.6}
        width={w + 1.2}
        height={h + 1.2}
        fill="rgba(0,0,0,0.25)"
        rx={1.2}
      />
      {/* Interior cavity (shown through open door) */}
      <rect x={x} y={y} width={w} height={h} fill="#1f2a33" rx={0.8} />
      {/* Top freezer door (closed) */}
      <rect
        x={x}
        y={y}
        width={w}
        height={topH}
        fill="#F4F4F2"
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={0.4}
        rx={0.8}
      />
      <line
        x1={x}
        y1={y + topH}
        x2={x + w}
        y2={y + topH}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={0.5}
      />
      {/* Handles */}
      <rect x={handleX} y={y + topH * 0.25} width={0.8} height={topH * 0.5} fill="#B7B5AE" />
      <rect
        x={handleX}
        y={y + topH + (h - topH) * 0.3}
        width={0.8}
        height={(h - topH) * 0.4}
        fill="#B7B5AE"
      />
      {/* Bottom door — slightly transparent so the items "show through" the
          ajar gap; gives the empty-vs-stocked read without drawing a second
          door swing graphic. */}
      <rect
        x={x}
        y={y + topH}
        width={w}
        height={h - topH}
        fill="#F4F4F2"
        opacity={0.78}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={0.4}
      />
      {/* Interior shelves */}
      <line
        x1={x + 0.5}
        y1={y + topH + (h - topH) * 0.4}
        x2={x + w - 0.5}
        y2={y + topH + (h - topH) * 0.4}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={0.4}
      />
      <line
        x1={x + 0.5}
        y1={y + topH + (h - topH) * 0.72}
        x2={x + w - 0.5}
        y2={y + topH + (h - topH) * 0.72}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={0.4}
      />
      {/* Items inside — emoji laid out in a small grid based on count */}
      {items.map((emoji, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const ix = x + w * 0.32 + col * w * 0.36;
        const iy = y + topH + (h - topH) * (0.32 + row * 0.28);
        return (
          <text
            key={i}
            x={ix}
            y={iy}
            fontSize={Math.max(5, w * 0.42)}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ filter: "drop-shadow(0 0.5px 0.5px rgba(0,0,0,0.45))" }}
          >
            {emoji}
          </text>
        );
      })}
      {/* Empty fridge label */}
      {level === 0 && (
        <text
          x={x + w / 2}
          y={y + topH + (h - topH) / 2}
          fontSize={Math.max(4, w * 0.25)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.55)"
          style={{ fontFamily: "ui-monospace, monospace" }}
        >
          empty
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// CSS — R6 G2 keyframes (also used by F2 in fleet-hamlet-room-window-scene).
// ---------------------------------------------------------------------------

export const ROOM_CONTAINERS_CSS = `
@keyframes relayHamletBookGlow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.35); }
}
@keyframes relayHamletFridgeHum {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(0, 0.25px); }
}
@keyframes relayHamletChildPlay {
  0%, 100% { transform: translate(-1px, 0); }
  50% { transform: translate(1px, -1px); }
}
@keyframes relayHamletPassingFriend {
  0%   { transform: translateX(0); opacity: 0; }
  8%   { opacity: 0.85; }
  92%  { opacity: 0.85; }
  100% { transform: translateX(var(--relay-hamlet-friend-sweep, 120px)); opacity: 0; }
}
`;
