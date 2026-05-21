"use client";

// Fleet Hamlet — Room Scene dynamic layers.
//
// Visual companions to `_lib/fleet-hamlet-room-state.ts`. Each layer is a
// pure-SVG group meant to drop into the existing <RoomScene> below /
// alongside the static furniture:
//
//   <ToolPropSvg>          — tiny tool icon next to the avatar (A1)
//   <MessLayer>            — papers / cups / pizza / knocked chair (B1)
//   <EventDecorLayer>      — birthday / wedding / fire / reaper marks (D1)
//   <RoomWhiteboard>       — wall-mounted todo list (B2)
//
// The layers are all conditional: when there is nothing to show they
// render an empty fragment so they cost a single React node + no SVG
// children. Animations live in `ROOM_STATE_CSS` (one stylesheet block,
// injected once by the parent panel).

import type {
  EventSlot,
  MessSlot,
  ToolSlot,
  WhiteboardSlot,
} from "../_lib/fleet-hamlet-room-furniture";
import type { LifeEvent } from "../_lib/fleet-hamlet-events";
import type {
  ToolPropKind,
  WhiteboardItem,
} from "../_lib/fleet-hamlet-room-state";
import { DIORAMA_DEFS } from "../_lib/fleet-hamlet-diorama-tokens";

// ---------------------------------------------------------------------------
// Coordinate mapping helpers
//
// The room scene's working canvas is 360x220. The "floor area" of the room
// runs from y=120 (back wall horizon) to y=220 (front edge); the back wall
// covers y=0..120. The static furniture layer uses its own mapping inside
// fleet-hamlet-room-scene.tsx — for the dynamic layers we keep things
// independent + readable, using a flat (no perspective) projection so the
// caller can position decor against a single 360x220 grid.
// ---------------------------------------------------------------------------

const SCENE_W = 360;
const SCENE_H = 220;
const FLOOR_TOP = 120;
const FLOOR_BOTTOM = 216;
const WALL_TOP = 8;
const WALL_BOTTOM = 110;

function mapFloor(x: number, y: number): { sx: number; sy: number } {
  // Same trapezoid as the static floor — items closer to the back compress
  // slightly toward the center to suggest depth.
  const depth = 1 - y;
  const compress = depth * 0.18;
  const sx = SCENE_W / 2 + (x - 0.5) * SCENE_W * (1 - compress);
  const sy = FLOOR_TOP + y * (FLOOR_BOTTOM - FLOOR_TOP);
  return { sx, sy };
}

function mapWall(x: number, y: number): { sx: number; sy: number } {
  return { sx: x * SCENE_W, sy: WALL_TOP + y * (WALL_BOTTOM - WALL_TOP) };
}

function mapCeiling(x: number, y: number): { sx: number; sy: number } {
  return { sx: x * SCENE_W, sy: 4 + y * 24 };
}

// ---------------------------------------------------------------------------
// A1 — Tool Prop
// ---------------------------------------------------------------------------

export interface ToolPropProps {
  kind: ToolPropKind;
  slot: ToolSlot;
  /** Optional tint (e.g. the room's accent) used on outlines. */
  accent?: string;
}

/**
 * Tiny tool prop placed near the avatar. Rendered as a small grouped SVG
 * (~24x24 viewport) — sized so it reads as "in the avatar's hand" rather
 * than as a piece of furniture.
 */
export function ToolPropSvg({ kind, slot, accent = "#37474F" }: ToolPropProps) {
  const { sx, sy } = mapFloor(slot.x, slot.y);
  // The avatar's head sits ~groundY-54; slot.y≈0.66..0.78 places this
  // around mid-torso level, which reads as "carried" without the prop
  // floating in front of the face.
  return (
    <g transform={`translate(${sx}, ${sy})`}>
      {/* D2 — soft ground shadow ellipse beneath the prop. */}
      <ellipse cx={0} cy={9} rx={9} ry={1.4} fill="rgba(0,0,0,0.22)" />
      <g style={{ animation: "relayHamletToolBob 4.6s ease-in-out infinite", transformOrigin: "center" }}>
        <ToolPropShape kind={kind} accent={accent} />
      </g>
    </g>
  );
}

function ToolPropShape({
  kind,
  accent,
}: {
  kind: ToolPropKind;
  accent: string;
}) {
  // All shapes are drawn in a -12..12 local box so the parent can swap them
  // freely without touching positioning.
  switch (kind) {
    case "book":
      return (
        <g>
          <rect x={-8} y={-6} width={16} height={11} fill="#7E5A3A" stroke={accent} strokeWidth={0.6} rx={1} />
          <rect x={-7} y={-5} width={14} height={9} fill="#F4ECD8" />
          <line x1={0} y1={-5} x2={0} y2={4} stroke={accent} strokeWidth={0.5} />
          {/* D2 — top edge highlight + bottom edge shadow */}
          <line x1={-7} y1={-5.6} x2={7} y2={-5.6} stroke="rgba(255,240,210,0.65)" strokeWidth={0.5} />
          <line x1={-8} y1={5} x2={8} y2={5} stroke="rgba(0,0,0,0.35)" strokeWidth={0.4} />
        </g>
      );
    case "monitor":
      return (
        <g>
          <rect x={-9} y={-9} width={18} height={11} fill="#1E2638" stroke={accent} strokeWidth={0.6} rx={1.2} />
          <rect x={-7.5} y={-7.5} width={15} height={8} fill="#3DDC97" opacity={0.85} />
          {/* D2 — screen reflection highlight (top-left). */}
          <polygon points="-7.5,-7.5 -2,-7.5 -5,-3.5 -7.5,-3.5" fill="rgba(255,255,255,0.30)" />
          <rect x={-1.5} y={2.2} width={3} height={1.6} fill={accent} />
          <rect x={-5} y={3.6} width={10} height={1.4} fill={accent} rx={0.4} />
          {/* Bezel rim highlight */}
          <line x1={-8.5} y1={-8.5} x2={8.5} y2={-8.5} stroke="rgba(255,255,255,0.4)" strokeWidth={0.4} />
        </g>
      );
    case "magnifier":
      return (
        <g>
          <circle cx={-1.5} cy={-2} r={5.5} fill="rgba(180,210,235,0.45)" stroke={accent} strokeWidth={1.2} />
          {/* D2 — lens rim highlight + glass reflection */}
          <path d="M -4.5 -4.5 A 5.5 5.5 0 0 1 0 -6" stroke="rgba(255,255,255,0.85)" strokeWidth={0.6} fill="none" />
          <line x1={2.5} y1={2} x2={7} y2={6.5} stroke={accent} strokeWidth={2} strokeLinecap="round" />
          <line x1={3} y1={2.5} x2={6.5} y2={6} stroke="rgba(255,255,255,0.4)" strokeWidth={0.4} strokeLinecap="round" />
        </g>
      );
    case "terminal":
      return (
        <g>
          <rect x={-9} y={-7} width={18} height={12} fill="#0A0F1A" stroke={accent} strokeWidth={0.6} rx={1} />
          {/* D2 — screen glow halo */}
          <rect x={-8.5} y={-6.5} width={17} height={11} fill="rgba(124,255,178,0.06)" rx={0.8} />
          <text
            x={-6}
            y={-1.5}
            fontSize={5}
            fontFamily="ui-monospace, monospace"
            fill="#7CFFB2"
          >
            ▌
          </text>
          <line x1={-6} y1={2} x2={3} y2={2} stroke="#7CFFB2" strokeWidth={0.6} opacity={0.7} />
          <line x1={-9} y1={-7} x2={9} y2={-7} stroke="rgba(255,255,255,0.3)" strokeWidth={0.4} />
        </g>
      );
    case "telescope":
      return (
        <g>
          <rect x={-10} y={-3} width={14} height={4} fill="#5C6B7A" stroke={accent} strokeWidth={0.5} rx={1} transform="rotate(-18)" />
          {/* D2 — barrel highlight stripe */}
          <rect x={-10} y={-3} width={14} height={0.9} fill="rgba(255,255,255,0.45)" rx={0.4} transform="rotate(-18)" />
          <circle cx={5.5} cy={-4.5} r={2.5} fill="#1A2840" stroke={accent} strokeWidth={0.6} />
          <circle cx={4.8} cy={-5.2} r={0.8} fill="rgba(180,210,255,0.85)" />
          <line x1={-9} y1={3.5} x2={-12} y2={9} stroke={accent} strokeWidth={1.2} strokeLinecap="round" />
        </g>
      );
    case "staff":
      return (
        <g>
          {/* D2 — metal grad on the two orbs via gold/silver gradients. */}
          <circle cx={-3} cy={-5} r={3} fill={`url(#${DIORAMA_DEFS.roomMetalGold})`} stroke={accent} strokeWidth={0.5} />
          <circle cx={3} cy={-5} r={3} fill="#A6CFFF" stroke={accent} strokeWidth={0.5} />
          <circle cx={3.6} cy={-5.7} r={0.7} fill="rgba(255,255,255,0.9)" />
          <rect x={-5} y={-2} width={4} height={5} fill={accent} rx={0.6} />
          <rect x={1} y={-2} width={4} height={5} fill={accent} rx={0.6} />
          <rect x={-5} y={-2} width={4} height={0.8} fill="rgba(255,255,255,0.35)" />
          <rect x={1} y={-2} width={4} height={0.8} fill="rgba(255,255,255,0.35)" />
        </g>
      );
    case "pen":
    default:
      return (
        <g>
          <rect x={-6} y={-5} width={12} height={9} fill="#FAF6EC" stroke={accent} strokeWidth={0.5} />
          <line x1={-4} y1={-2} x2={4} y2={-2} stroke={accent} strokeWidth={0.4} opacity={0.7} />
          <line x1={-4} y1={1} x2={2} y2={1} stroke={accent} strokeWidth={0.4} opacity={0.7} />
          {/* D2 — paper top edge highlight + corner fold shadow */}
          <line x1={-6} y1={-5} x2={6} y2={-5} stroke="rgba(255,255,255,0.85)" strokeWidth={0.4} />
          <polygon points="3,-5 6,-5 6,-2" fill="rgba(0,0,0,0.12)" />
          <rect x={3} y={-9} width={1.6} height={9} fill="#2A3340" transform="rotate(20, 3.8, -4.5)" />
          <rect x={3.2} y={-9} width={0.4} height={9} fill="rgba(255,255,255,0.45)" transform="rotate(20, 3.8, -4.5)" />
        </g>
      );
  }
}

/** Display label for a given tool prop kind. */
export function toolPropLabel(kind: ToolPropKind): string {
  switch (kind) {
    case "book": return "reading";
    case "monitor": return "editing";
    case "magnifier": return "searching";
    case "terminal": return "shell";
    case "telescope": return "fetching";
    case "staff": return "delegating";
    case "pen": return "drafting";
  }
}

// ---------------------------------------------------------------------------
// B1 — Mess layer
// ---------------------------------------------------------------------------

export interface MessLayerProps {
  level: 0 | 1 | 2 | 3;
  errorBoost: boolean;
  slots: readonly MessSlot[];
  /** Stable seed so we always pick the same slots between renders. */
  seed: number;
  /** Axis 4a — show extra late-night clutter (☕🍜🍕🥫) when true. */
  allNighter?: boolean;
  /** Axis 4b — suppress all mess to simulate post-celebration tidy room. */
  recentCelebration?: boolean;
}

interface MessItem {
  glyph: string;
  /** 0..1 inside slot — keeps SVG node count low. */
  scale: number;
  /** Apply paper flutter animation. */
  fluttering: boolean;
}

function planMess(level: 0 | 1 | 2 | 3, errorBoost: boolean): MessItem[] {
  if (level === 0) return [];
  const out: MessItem[] = [];
  // Level 1 — one cup.
  out.push({ glyph: "☕", scale: 0.9, fluttering: false });
  if (level === 1) return out;
  // Level 2 — cup + 2 papers.
  out.push({ glyph: "📄", scale: 0.85, fluttering: true });
  out.push({ glyph: "📄", scale: 0.8, fluttering: true });
  if (level === 2) return out;
  // Level 3 — full chaos.
  out.push({ glyph: "📄", scale: 0.85, fluttering: true });
  out.push({ glyph: "🍕", scale: 0.95, fluttering: false });
  if (errorBoost) {
    out.push({ glyph: "🪑", scale: 0.95, fluttering: false });
  }
  return out;
}

// Extra late-night clutter items added when allNighter is true.
const ALL_NIGHTER_EXTRAS: ReadonlyArray<MessItem> = [
  { glyph: "☕", scale: 0.9, fluttering: false },
  { glyph: "🍜", scale: 0.9, fluttering: false },
  { glyph: "🍕", scale: 0.95, fluttering: false },
  { glyph: "🥫", scale: 0.85, fluttering: false },
];

export function MessLayer({
  level,
  errorBoost,
  slots,
  seed,
  allNighter = false,
  recentCelebration = false,
}: MessLayerProps) {
  // Axis 4b — celebration tidies the room completely.
  if (recentCelebration) return null;
  if (level === 0 && !allNighter) return null;
  if (slots.length === 0) return null;
  const items = planMess(level, errorBoost);
  // Axis 4a — append extra all-nighter clutter (up to 3 extra items).
  if (allNighter) {
    const budget = Math.min(3, slots.length - items.length);
    for (let i = 0; i < budget && i < ALL_NIGHTER_EXTRAS.length; i++) {
      const extra = ALL_NIGHTER_EXTRAS[i];
      if (extra) items.push({ ...extra });
    }
  }
  if (items.length === 0) return null;
  // Pick slots deterministically — rotate by seed so the same session uses
  // the same arrangement across rerenders.
  const picks = pickIndices(slots.length, items.length, seed);
  return (
    <g aria-hidden>
      {items.map((item, i) => {
        const idx = picks[i];
        if (idx === undefined) return null;
        const slot = slots[idx];
        if (!slot) return null;
        const { sx, sy } = mapFloor(slot.x, slot.y);
        const rot = ((seed + idx * 73) % 60) - 30; // -30..+30
        // Knocked chair gets a strong rotate so it reads as "fallen".
        const isKnocked = item.glyph === "🪑";
        const angle = isKnocked ? 78 : rot;
        const sz = item.scale * 14;
        // D2 — small reflective highlight overlays per glyph type.
        const overlay = item.glyph === "☕"
          ? (
              <ellipse cx={-sz * 0.18} cy={-sz * 0.18} rx={sz * 0.18} ry={sz * 0.06} fill="rgba(255,255,255,0.45)" />
            )
          : item.glyph === "🍕"
            ? (
                <ellipse cx={-sz * 0.16} cy={-sz * 0.20} rx={sz * 0.22} ry={sz * 0.05} fill="rgba(255,235,180,0.45)" />
              )
            : null;
        return (
          <g
            key={`mess-${i}`}
            transform={`translate(${sx}, ${sy}) rotate(${angle})`}
          >
            {/* D2 — soft floor shadow under the mess piece. */}
            <ellipse cx={0} cy={sz * 0.42} rx={sz * 0.36} ry={Math.max(0.8, sz * 0.06)} fill="rgba(0,0,0,0.20)" />
            <g
              style={
                item.fluttering
                  ? {
                      animation: `relayHamletPaperFlutter 3.6s ease-in-out ${i * 0.4}s infinite`,
                      transformOrigin: "center",
                    }
                  : undefined
              }
            >
              <text
                fontSize={sz}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.3))" }}
              >
                {item.glyph}
              </text>
              {overlay}
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// D1 — Event decor
// ---------------------------------------------------------------------------

export interface EventDecorLayerProps {
  events: readonly LifeEvent[];
  slots: readonly EventSlot[];
  seed: number;
}

interface EventDecor {
  // Each event produces 1..2 visual marks pinned to specific anchors.
  marks: { glyph: string; anchor: EventSlot["anchor"]; celebrate?: boolean }[];
}

function planEvent(kind: LifeEvent["kind"]): EventDecor {
  switch (kind) {
    case "birthday":
      return {
        marks: [
          { glyph: "🎀", anchor: "wall", celebrate: true },
          { glyph: "🎂", anchor: "floor", celebrate: true },
        ],
      };
    case "baby":
      return {
        marks: [
          { glyph: "🍼", anchor: "floor" },
          { glyph: "🧸", anchor: "floor" },
        ],
      };
    case "wedding":
      return {
        marks: [
          { glyph: "💖", anchor: "wall", celebrate: true },
          { glyph: "💍", anchor: "floor", celebrate: true },
        ],
      };
    case "fire":
      return {
        marks: [
          { glyph: "💨", anchor: "ceiling" },
          { glyph: "🪣", anchor: "floor" },
        ],
      };
    case "reaper":
      return {
        marks: [
          { glyph: "🕯", anchor: "ceiling" },
          { glyph: "👻", anchor: "floor" },
        ],
      };
    case "quest":
      return { marks: [{ glyph: "🎊", anchor: "floor", celebrate: true }] };
    case "achievement":
      return {
        marks: [{ glyph: "🥇", anchor: "floor", celebrate: true }],
      };
    case "sleep":
      return { marks: [{ glyph: "💤", anchor: "ceiling" }] };
  }
}

export function EventDecorLayer({
  events,
  slots,
  seed,
}: EventDecorLayerProps) {
  if (events.length === 0 || slots.length === 0) return null;
  // Group slots by anchor so each event mark hits a compatible slot.
  const byAnchor: Record<EventSlot["anchor"], EventSlot[]> = {
    wall: [],
    floor: [],
    ceiling: [],
  };
  for (const s of slots) byAnchor[s.anchor].push(s);
  const usedByAnchor: Record<EventSlot["anchor"], Set<number>> = {
    wall: new Set(),
    floor: new Set(),
    ceiling: new Set(),
  };

  const marks: { glyph: string; slot: EventSlot; celebrate: boolean; idx: number }[] = [];
  let stepper = 0;
  for (const ev of events) {
    const plan = planEvent(ev.kind);
    for (const mark of plan.marks) {
      const pool = byAnchor[mark.anchor];
      if (pool.length === 0) continue;
      // Find first un-used slot in this anchor pool — fall back to round
      // robin if all used.
      let slot: EventSlot | undefined;
      let pickedIdx = -1;
      for (let off = 0; off < pool.length; off++) {
        const idx = (seed + stepper + off) % pool.length;
        if (!usedByAnchor[mark.anchor].has(idx)) {
          slot = pool[idx];
          pickedIdx = idx;
          break;
        }
      }
      if (!slot) {
        const idx = (seed + stepper) % pool.length;
        slot = pool[idx];
        pickedIdx = idx;
      }
      if (!slot) continue;
      usedByAnchor[mark.anchor].add(pickedIdx);
      marks.push({
        glyph: mark.glyph,
        slot,
        celebrate: mark.celebrate ?? false,
        idx: marks.length,
      });
      stepper += 1;
    }
  }

  return (
    <g aria-hidden>
      {marks.map((m) => {
        const pos =
          m.slot.anchor === "wall"
            ? mapWall(m.slot.x, m.slot.y)
            : m.slot.anchor === "ceiling"
              ? mapCeiling(m.slot.x, m.slot.y)
              : mapFloor(m.slot.x, m.slot.y);
        // D2 — per-glyph richness overlays. Most decorations get a small
        // highlight glint; floor pieces also get a faint shadow ellipse.
        const onFloor = m.slot.anchor === "floor";
        const isCelebrate = m.celebrate;
        return (
          <g
            key={`event-${m.idx}`}
            transform={`translate(${pos.sx}, ${pos.sy})`}
            style={
              isCelebrate
                ? {
                    animation: `relayHamletEventGlow 2.4s ease-in-out ${m.idx * 0.25}s infinite`,
                  }
                : undefined
            }
          >
            {onFloor && (
              <ellipse cx={0} cy={9} rx={7.5} ry={1.4} fill="rgba(0,0,0,0.22)" />
            )}
            <text
              fontSize={16}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.4))" }}
            >
              {m.glyph}
            </text>
            {/* D2 — sparkle / glow ring on celebratory marks. */}
            {isCelebrate && (
              <circle cx={0} cy={0} r={9} fill="none" stroke="rgba(255,220,140,0.45)" strokeWidth={0.6} />
            )}
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// B2 — Whiteboard
// ---------------------------------------------------------------------------

export interface RoomWhiteboardProps {
  items: readonly WhiteboardItem[];
  slot: WhiteboardSlot;
  accent?: string;
}

export function RoomWhiteboard({
  items,
  slot,
  accent = "#37474F",
}: RoomWhiteboardProps) {
  if (items.length === 0) return null;
  const x = slot.x * SCENE_W;
  const y = slot.y * SCENE_H;
  const w = slot.w * SCENE_W;
  const h = slot.h * SCENE_H;
  const headerH = Math.max(8, h * 0.18);
  const rowH = (h - headerH - 4) / Math.max(1, items.length);
  // Available text width = board width minus the checkbox (5px) +
  // surrounding padding (4px left + 4px right + 2px gap). SVG <text>
  // can't auto-truncate, so we trim by character count using a
  // monospace approximation of ~3.2px per glyph at fontSize 5.4.
  const textBudget = Math.max(8, w - 13);
  const maxChars = Math.max(6, Math.floor(textBudget / 3.2));
  const truncate = (s: string) =>
    s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
  return (
    <g aria-hidden style={{ animation: "relayHamletWhiteboardShimmer 5.2s ease-in-out infinite" }}>
      {/* D2 — cast shadow behind the frame. */}
      <rect x={x} y={y + 1.5} width={w + 2} height={h + 2} fill="rgba(0,0,0,0.22)" rx={1.4} />
      {/* Frame */}
      <rect
        x={x - 1}
        y={y - 1}
        width={w + 2}
        height={h + 2}
        fill="#3A2A1F"
        rx={1.4}
      />
      {/* Frame inner highlight (top edge). */}
      <rect x={x - 1} y={y - 1} width={w + 2} height={0.6} fill="rgba(255,235,200,0.55)" />
      <rect x={x} y={y} width={w} height={h} fill="#FAFAF5" />
      {/* D2 — diagonal gloss sheen on the board surface. */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={`url(#${DIORAMA_DEFS.roomGloss})`}
        opacity={0.55}
      />
      {/* Header strip */}
      <rect x={x} y={y} width={w} height={headerH} fill={accent} opacity={0.85} />
      <rect x={x} y={y} width={w} height={0.6} fill="rgba(255,255,255,0.4)" />
      <text
        x={x + 4}
        y={y + headerH / 2 + 0.5}
        fontSize={5.5}
        fontFamily="ui-monospace, monospace"
        fill="#FAFAF5"
        dominantBaseline="middle"
      >
        TODO
      </text>
      <text
        x={x + w - 4}
        y={y + headerH / 2 + 0.5}
        fontSize={5.5}
        fontFamily="ui-monospace, monospace"
        fill="#FAFAF5"
        textAnchor="end"
        dominantBaseline="middle"
      >
        ✎
      </text>
      {/* Rows */}
      {items.map((item, i) => {
        const ry = y + headerH + 2 + i * rowH;
        const cx = x + 4;
        const cy = ry + rowH / 2;
        return (
          <g key={`wb-${i}`}>
            <rect
              x={cx}
              y={cy - 2.5}
              width={5}
              height={5}
              fill="#FAFAF5"
              stroke={accent}
              strokeWidth={0.5}
              rx={0.6}
            />
            {item.done && (
              <path
                d={`M ${cx + 1} ${cy} L ${cx + 2.2} ${cy + 1.5} L ${cx + 4} ${cy - 1.6}`}
                stroke={accent}
                strokeWidth={0.9}
                fill="none"
                strokeLinecap="round"
              />
            )}
            <text
              x={cx + 7}
              y={cy + 0.5}
              fontSize={5.4}
              fontFamily="ui-monospace, monospace"
              fill="#2A3340"
              dominantBaseline="middle"
              style={
                item.done
                  ? { textDecoration: "line-through", opacity: 0.55 }
                  : undefined
              }
            >
              <title>{item.text}</title>
              {truncate(item.text)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Axis 1 — TODO sticky-note cluster
// ---------------------------------------------------------------------------

export interface TodoStickyClusterProps {
  count: number;
  /** Wall x anchor in scene coords (default: 310 — right wall clear of whiteboard). */
  anchorX?: number;
  /** Wall y anchor in scene coords (default: 20 — upper wall). */
  anchorY?: number;
}

/**
 * Renders 1..6 small yellow sticky-note rectangles on the wall when count > 0.
 * Entirely decorative — pointer-events:none + aria-hidden.
 */
export function TodoStickyCluster({
  count,
  anchorX = 310,
  anchorY = 20,
}: TodoStickyClusterProps) {
  if (count <= 0) return null;
  // Pre-computed offsets so the stickies scatter naturally without randomness.
  const OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, -8],
    [12, 6, 6],
    [-10, 12, -4],
    [8, 20, 10],
    [-6, 28, -12],
    [16, 14, 4],
  ];
  return (
    <g aria-hidden pointerEvents="none">
      {OFFSETS.slice(0, count).map(([dx, dy, rot], i) => (
        <g key={`sticky-${i}`} transform={`translate(${anchorX + dx}, ${anchorY + dy}) rotate(${rot})`}>
          {/* Shadow */}
          <rect x={1.5} y={1.5} width={7} height={7} fill="rgba(0,0,0,0.18)" rx={0.5} />
          {/* Sticky body */}
          <rect x={0} y={0} width={7} height={7} fill="#FFE566" rx={0.5} />
          {/* Fold corner */}
          <polygon points="4.5,0 7,0 7,2.5" fill="rgba(200,160,0,0.35)" />
          {/* Text lines */}
          <line x1={1} y1={2.5} x2={6} y2={2.5} stroke="rgba(100,80,0,0.45)" strokeWidth={0.5} />
          <line x1={1} y1={4} x2={5} y2={4} stroke="rgba(100,80,0,0.35)" strokeWidth={0.5} />
          <line x1={1} y1={5.5} x2={4} y2={5.5} stroke="rgba(100,80,0,0.25)" strokeWidth={0.5} />
        </g>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Axis 2 — Monitor screen overlay
// ---------------------------------------------------------------------------

export interface MonitorScreenProps {
  lines: readonly string[];
  /** Scene-coordinate center of the PC emoji. */
  sx: number;
  sy: number;
}

/**
 * Overlays a tiny CRT-style code screen on top of the 🖥 emoji.
 * Uses amber (#FFB300) monospace text on a dark background.
 * Scrolls vertically on a 7s loop (reduced-motion: static).
 * pointer-events:none + aria-hidden — purely decorative.
 */
export function MonitorScreen({ lines, sx, sy }: MonitorScreenProps) {
  if (lines.length === 0) return null;
  // Screen dimensions (scene units)
  const SW = 18;
  const SH = 11;
  const x = sx - SW / 2 - 2;
  const y = sy - SH - 8; // sits above the center baseline of the emoji
  const AMBER = "#FFB300";
  const BG = "#0A0F1A";
  const FONT_SIZE = 2.6;
  const LINE_H = 2.8;
  return (
    <g aria-hidden pointerEvents="none">
      {/* Bezel */}
      <rect x={x - 1} y={y - 1} width={SW + 2} height={SH + 2} fill="#1C2535" rx={1} />
      {/* Screen bg */}
      <rect x={x} y={y} width={SW} height={SH} fill={BG} rx={0.5} />
      {/* Animated text group */}
      <g style={{ animation: "relayHamletMonitorScroll 7s linear infinite", transformOrigin: `${x + SW / 2}px ${y + SH / 2}px` }}>
        {lines.map((line, i) => (
          <text
            key={`mon-${i}`}
            x={x + 1.5}
            y={y + 2 + (i + 0.8) * LINE_H}
            fontSize={FONT_SIZE}
            fontFamily="ui-monospace, monospace"
            fill={AMBER}
            opacity={1 - i * 0.15}
          >
            {line}
          </text>
        ))}
      </g>
      {/* Scan-line overlay */}
      <rect x={x} y={y} width={SW} height={SH} fill="rgba(0,0,0,0.12)" rx={0.5}
        style={{ mixBlendMode: "multiply" }} />
      {/* Top-left glare */}
      <polygon points={`${x},${y} ${x + 5},${y} ${x},${y + 3}`} fill="rgba(255,255,255,0.07)" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickIndices(poolSize: number, count: number, seed: number): number[] {
  const out: number[] = [];
  if (poolSize <= 0 || count <= 0) return out;
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let pick = (seed + i * 53) % poolSize;
    let guard = 0;
    while (used.has(pick) && guard < poolSize) {
      pick = (pick + 1) % poolSize;
      guard += 1;
    }
    used.add(pick);
    out.push(pick);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSS — registered once per panel
// ---------------------------------------------------------------------------

export const ROOM_STATE_CSS = `
@keyframes relayHamletPaperFlutter {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  50% { transform: translate(0.5px, -0.6px) rotate(2deg); }
}
@keyframes relayHamletWhiteboardShimmer {
  0%, 100% { opacity: 0.96; }
  50% { opacity: 1; }
}
@keyframes relayHamletEventGlow {
  0%, 100% { filter: drop-shadow(0 0 0 rgba(255,220,140,0)); }
  50% { filter: drop-shadow(0 0 2.5px rgba(255,220,140,0.85)); }
}
@keyframes relayHamletToolBob {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(0, -0.6px); }
}
@keyframes relayHamletMonitorScroll {
  0%, 100% { transform: translateY(0); }
  45%  { transform: translateY(-1.5px); }
  55%  { transform: translateY(-1.5px); }
}
@media (prefers-reduced-motion: reduce) {
  .relayHamletMonitorScreen * { animation: none !important; }
}
`;
