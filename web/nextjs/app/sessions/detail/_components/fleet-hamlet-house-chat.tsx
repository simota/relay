"use client";

// Fleet Hamlet — House Chat Bubble overlay.
//
// Renders a small chat bubble above each active house whose session has a
// new user/assistant message within the freshness window. The bubble fades
// across the window and disappears once the message ages out. Neighborhood
// renders this layer after houses / street props so messages stay readable
// instead of being tucked behind rooftops or roadside objects.

import type { ReactNode } from "react";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import {
  bubbleOpacity,
  HOUSE_BUBBLE_MAX_AGE_MS,
  type LastMessage,
} from "../_lib/fleet-hamlet-last-message";

// ---------------------------------------------------------------------------
// Public — bubble + layer
// ---------------------------------------------------------------------------

export interface HouseChatBubbleProps {
  role: "user" | "assistant";
  text: string;
  ageMs: number;
  /** Container-local x (center of the bubble). */
  x: number;
  /** Container-local y (bottom edge of the bubble, i.e. where the tail anchors). */
  y: number;
  /** Optional max width in px — used to keep the bubble inside its cell. */
  maxWidth?: number;
  /** Optional max height in px — used to keep the bubble from covering rows. */
  maxHeight?: number;
  /** Whether to play the slide-up animation. New entries pop, repeats don't. */
  fresh?: boolean;
}

// Bubble width follows the cell, while height is capped by the cell height.
// This keeps Japanese / long text readable without letting first-row
// messages grow upward into the HUD.
const DEFAULT_MAX_WIDTH = 340;
const MIN_MAX_WIDTH = 64;
const DEFAULT_MAX_HEIGHT = 168;
const MIN_MAX_HEIGHT = 96;

/**
 * One small overhead chat bubble. Visually a smaller cousin of the
 * `ChatBubbleStream` bubbles used in the right panel — pastel role colors,
 * CSS-only tail nib, monospace text.
 */
export function HouseChatBubble({
  role,
  text,
  ageMs,
  x,
  y,
  maxWidth = DEFAULT_MAX_WIDTH,
  maxHeight = DEFAULT_MAX_HEIGHT,
  fresh = true,
}: HouseChatBubbleProps): ReactNode {
  const isUser = role === "user";
  const bg = isUser
    ? "linear-gradient(135deg, hsla(210, 80%, 92%, 0.96), hsla(220, 70%, 86%, 0.96))"
    : "linear-gradient(135deg, hsla(150, 65%, 90%, 0.96), hsla(150, 55%, 80%, 0.96))";
  const border = isUser ? "hsl(215, 55%, 65%)" : "hsl(150, 45%, 55%)";
  const opacity = bubbleOpacity(ageMs, HOUSE_BUBBLE_MAX_AGE_MS);
  const clampedMax = Math.max(MIN_MAX_WIDTH, Math.min(maxWidth, DEFAULT_MAX_WIDTH));
  const clampedHeight = Math.max(
    MIN_MAX_HEIGHT,
    Math.min(maxHeight, DEFAULT_MAX_HEIGHT),
  );

  // Height is capped separately from width. Neighborhood cells can be wide
  // but not tall, so a width-derived cap made first-row bubbles climb into
  // the HUD / sky. Long text gets clamped with an ellipsis; the full string
  // remains in the `title` for hover.
  const fontSize = 12;
  const lineHeight = 1.4;
  const paddingY = 6;
  const innerMaxHeight = Math.floor(clampedHeight);
  // Available inner text height = innerMaxHeight - 2 × paddingY. Divide by
  // line box height to get an integer line cap (min 2 so the icon row
  // doesn't squeeze out the first text line on the narrowest cells).
  const lineClamp = Math.max(
    2,
    Math.floor((innerMaxHeight - paddingY * 2) / (fontSize * lineHeight)),
  );

  // Diorama bubble — multi-layer drop shadow + faint top-gradient + speckled
  // paper texture via a subtle inline radial-gradient noise pattern.
  return (
    <div
      role="presentation"
      aria-hidden
      style={{
        position: "absolute",
        // Translate so (x, y) marks the bubble's bottom-center. The tail
        // hangs ~5px below `y`.
        left: x,
        top: y,
        transform: "translate(-50%, -100%)",
        // Fixed width (block + border-box) so every bubble on a row is the
        // exact same landscape card size, regardless of how much text each
        // session happens to have. Inline-block / -webkit-box shrink-wraps
        // would otherwise make short messages render visibly narrower than
        // long ones sitting next door.
        display: "block",
        boxSizing: "border-box",
        width: clampedMax,
        borderRadius: 10,
        border: `1px solid ${border}`,
        background: `${bg}, radial-gradient(circle at 30% 20%, rgba(255,255,255,0.6) 0.5px, transparent 1.5px), radial-gradient(circle at 70% 60%, rgba(0,0,0,0.04) 0.5px, transparent 1.5px)`,
        backgroundSize: "auto, 8px 8px, 11px 11px",
        color: "#1A1F2E",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        boxShadow:
          "0 6px 12px -4px rgba(0,0,0,0.35), 0 3px 6px -2px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(0,0,0,0.06)",
        opacity,
        transition: "opacity 600ms ease-out",
        animation: fresh ? "relayHamletHouseChatPop 320ms ease-out both" : undefined,
        pointerEvents: "none",
        zIndex: 25,
        willChange: "transform, opacity",
      }}
      title={text}
    >
      {/* Inner content wrapper — owns padding, the 3:4 max-height cap, and
          the line-clamp. Kept separate from the outer bubble so the tail
          nib below can hang outside the clipped region. */}
      <div
        style={{
          // Force inner to fill outer's fixed width — `display: -webkit-box`
          // otherwise shrink-wraps and the bubble would visually collapse to
          // its longest unbreakable text run.
          width: "100%",
          boxSizing: "border-box",
          padding: `${paddingY}px 9px`,
          maxHeight: innerMaxHeight,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: lineClamp,
          WebkitBoxOrient: "vertical",
          fontSize,
          lineHeight,
          wordBreak: "break-word",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            marginRight: 4,
            fontSize: 10,
            opacity: 0.7,
          }}
        >
          {isUser ? "👤" : "🤖"}
        </span>
        {text}
      </div>
      {/* Tail nib — small triangle anchored at the bottom center, pointing
          down at the house. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          bottom: -5,
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: `5px solid ${border}`,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer — places every bubble for the active grid in one absolute overlay
// ---------------------------------------------------------------------------

export interface HouseChatLayerProps {
  /** Bubbles keyed by SimCardModel.key. */
  bubbles: ReadonlyMap<string, LastMessage>;
  /** Active-zone sims (ordered). */
  cards: readonly SimCardModel[];
  /** Slot lookup keyed by SimCardModel.key. */
  slots: ReadonlyMap<string, { col: number; row: number }>;
  /** Active grid cell sizes. */
  cellW: number;
  cellH: number;
  /** Grid width — used to bound x positions just in case. */
  width: number;
  /** Grid height — likewise. */
  height: number;
  /** When true, suppress everything (tiny mode). */
  hidden?: boolean;
}

export function HouseChatLayer({
  bubbles,
  cards,
  slots,
  cellW,
  cellH,
  width,
  height,
  hidden = false,
}: HouseChatLayerProps): ReactNode {
  if (hidden) return null;
  if (bubbles.size === 0) return null;

  // Bubble anchor: a bit above the moodlet bubble (which sits ~mb-1 above
  // the house top). We aim slightly to the right so the moodlet circle
  // remains visible underneath; the bubble tail still points down at the
  // house top.
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
        pointerEvents: "none",
        zIndex: 24,
      }}
    >
      {cards.map((sim) => {
        const msg = bubbles.get(sim.key);
        if (!msg) return null;
        const slot = slots.get(sim.key);
        if (!slot) return null;
        // Anchor: house center. Bubbles stay inside their own cell so
        // neighbors never overlap; long text wraps / clamps vertically.
        // Y accounts for the bubble height, keeping first-row cards fully
        // visible instead of letting them climb above the scene.
        const cellCenter = slot.col * cellW + cellW / 2;
        // Cap maxWidth to cellW minus a small inter-cell gap so neighbors
        // can never collide horizontally. Wider messages get wrapped.
        const maxWidth = bubbleMaxWidthForCell(cellW);
        const maxHeight = bubbleMaxHeightForCell(cellH);
        // Keep bubble fully inside its half of the grid by clamping anchor
        // to (cellLeft + maxWidth/2 + 2, cellRight - maxWidth/2 - 2).
        const cellLeft = slot.col * cellW;
        const cellRight = cellLeft + cellW;
        const anchorX = Math.max(
          cellLeft + maxWidth / 2 + 2,
          Math.min(cellRight - maxWidth / 2 - 2, cellCenter),
        );
        const anchorY = bubbleAnchorYForCell(slot.row, cellH, maxHeight);
        return (
          <HouseChatBubble
            key={`${sim.key}::${msg.timestamp}`}
            role={msg.role}
            text={msg.text}
            ageMs={msg.ageMs}
            x={anchorX}
            y={anchorY}
            maxWidth={maxWidth}
            maxHeight={maxHeight}
            fresh
          />
        );
      })}
    </div>
  );
}

function bubbleMaxWidthForCell(cellW: number): number {
  return Math.max(MIN_MAX_WIDTH, Math.min(DEFAULT_MAX_WIDTH, cellW - 12));
}

function bubbleMaxHeightForCell(cellH: number): number {
  return Math.max(
    MIN_MAX_HEIGHT,
    Math.min(DEFAULT_MAX_HEIGHT, Math.floor(cellH * 0.98)),
  );
}

function bubbleAnchorYForCell(
  row: number,
  cellH: number,
  bubbleMaxH: number,
): number {
  const rowTop = row * cellH;
  const safeTopY = Math.min(bubbleMaxH + 3, Math.floor(cellH * 0.22));
  const roofLaneY = Math.floor(cellH * 0.18);
  const lowerBound = Math.max(10, safeTopY);
  const laneY = Math.max(
    lowerBound,
    Math.min(Math.floor(cellH * 0.3), roofLaneY),
  );
  return rowTop + laneY;
}

// ---------------------------------------------------------------------------
// Keyframes — must be injected once per scene
// ---------------------------------------------------------------------------

export const HOUSE_CHAT_CSS = `
@keyframes relayHamletHouseChatPop {
  0%   { opacity: 0; transform: translate(-50%, calc(-100% + 6px)) scale(0.92); }
  60%  { opacity: 1; transform: translate(-50%, calc(-100% - 1px)) scale(1.02); }
  100% { opacity: 1; transform: translate(-50%, -100%) scale(1); }
}
`;
