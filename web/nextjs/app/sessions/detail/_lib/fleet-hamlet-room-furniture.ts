// Hamlet — room furniture presets.
//
// Pure-data presets describing what furniture lives in each kind of room.
// `getFurnitureLayout(roomKind, seed)` returns a deterministic array of
// emoji-based furniture items with their position inside the room's
// floor box, so the RoomScene component can paint them without doing any
// layout maths of its own.
//
// All coordinates are in a normalized 0..1 room space:
//   x: 0 = left wall, 1 = right wall
//   y: 0 = back wall, 1 = front edge of floor
// The RoomScene maps this to its SVG viewport with a soft perspective.

import type { RoomKind } from "./fleet-hamlet-house";

export type FurnitureSlot =
  | "wall"
  | "floor-back"
  | "floor-mid"
  | "floor-front"
  | "corner"
  | "ceiling";

export interface FurnitureItem {
  /** Display glyph — emoji or short string. */
  glyph: string;
  /** Normalized x (0..1) inside the room floor box. */
  x: number;
  /** Normalized y (0..1); 0 = back, 1 = front. */
  y: number;
  /** Visual scale multiplier (1 = default). */
  scale: number;
  /** Slot kind — controls which depth layer this item paints in. */
  slot: FurnitureSlot;
  /** Optional caption shown beneath / next to the glyph at low contrast. */
  caption?: string;
  /**
   * Marks the item as a placeholder that the dynamic Mess layer can swap
   * out (e.g. 🪴 → 🥀 when the resident has been silent for > 1h).
   */
  swapKind?: "plant";
}

// ---------------------------------------------------------------------------
// Dynamic-layer slot anchors per room
// ---------------------------------------------------------------------------

/** Position for the A1 Tool Prop — placed near the avatar's hands. */
export interface ToolSlot {
  /** Normalized x (0..1). */
  x: number;
  /** Normalized y (0..1). */
  y: number;
}

/** Floor slot for the B1 Mess layer (cups, paper, pizza, knocked chair). */
export interface MessSlot {
  /** Normalized x (0..1). */
  x: number;
  /** Normalized y (0..1). */
  y: number;
}

export type EventAnchor = "wall" | "floor" | "ceiling";

/** Slot used by the D1 Event Decor layer. */
export interface EventSlot {
  /** Normalized x (0..1). */
  x: number;
  /** Normalized y (0..1). */
  y: number;
  anchor: EventAnchor;
}

/** Wall area used to mount the B2 Whiteboard. */
export interface WhiteboardSlot {
  /** Normalized x (0..1) of the top-left corner. */
  x: number;
  /** Normalized y (0..1) of the top-left corner. */
  y: number;
  /** Width in normalized units. */
  w: number;
  /** Height in normalized units. */
  h: number;
}

/** Wall / desk slot for an Achievement frame (R3 C1). */
export interface AchievementSlot {
  /** Normalized x (0..1). */
  x: number;
  /** Normalized y (0..1). */
  y: number;
  /** Which surface this slot lives on. */
  anchor: "wall" | "floor";
}

/** Wall slot for a Family / Friend photo frame (R3 C2). */
export interface FrameSlot {
  /** Normalized x (0..1) — frame centre. */
  x: number;
  /** Normalized y (0..1) — frame centre. */
  y: number;
  /** Normalized width 0..1. */
  w: number;
  /** Normalized height 0..1. */
  h: number;
}

/** Floor anchor for the seasonal decor (R4 E1). */
export interface SeasonSlot {
  /** Normalized x (0..1). */
  x: number;
  /** Normalized y (0..1). */
  y: number;
}

/** Desk / table slot for the meal item (R4 E2). */
export interface MealSlot {
  /** Normalized x (0..1). */
  x: number;
  /** Normalized y (0..1). */
  y: number;
}

/** Floor anchor for a pet (R5 F1). */
export interface PetSlot {
  /** Normalized x (0..1). */
  x: number;
  /** Normalized y (0..1). */
  y: number;
}

/** Wall-mounted bookshelf slot (R6 G2). x/y = top-left, w/h normalized. */
export interface BookshelfSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Wall-mounted fridge slot (R6 G2). x/y = top-left, w/h normalized. */
export interface FridgeSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomDynamicSlots {
  toolSlot?: ToolSlot;
  messSlots?: readonly MessSlot[];
  eventSlots?: readonly EventSlot[];
  whiteboardSlot?: WhiteboardSlot;
  /** R3 C1 — Achievement frames / trophies. */
  achievementSlots?: readonly AchievementSlot[];
  /** R3 C2 — Family / best-friend photos. */
  frameSlots?: readonly FrameSlot[];
  /** R4 E1 — Seasonal decoration. */
  seasonSlot?: SeasonSlot;
  /** R4 E2 — Meal / sleepwear on the desk / table. */
  mealSlot?: MealSlot;
  /** R5 F1 — One or two pet anchors. */
  petSlots?: readonly PetSlot[];
  /** R6 G2 — wall bookshelf (library / workshop / study / reception). */
  bookshelfSlot?: BookshelfSlot;
  /** R6 G2 — wall fridge (living / nursery). */
  fridgeSlot?: FridgeSlot;
}

// ---------------------------------------------------------------------------
// Presets — one furniture template per RoomKind
// ---------------------------------------------------------------------------

const TEMPLATES: Record<RoomKind, FurnitureItem[]> = {
  living: [
    { glyph: "🖼", x: 0.22, y: 0.05, scale: 1.0, slot: "wall" },
    { glyph: "💡", x: 0.75, y: 0.02, scale: 0.9, slot: "ceiling" },
    { glyph: "🛋", x: 0.55, y: 0.55, scale: 1.6, slot: "floor-mid", caption: "sofa" },
    { glyph: "📺", x: 0.22, y: 0.45, scale: 1.2, slot: "floor-back" },
    { glyph: "🪴", x: 0.88, y: 0.7, scale: 1.0, slot: "corner", swapKind: "plant" },
    { glyph: "🧶", x: 0.4, y: 0.85, scale: 0.8, slot: "floor-front" },
  ],
  workshop: [
    { glyph: "🖥", x: 0.32, y: 0.5, scale: 1.4, slot: "floor-mid", caption: "PC" },
    { glyph: "⌨️", x: 0.32, y: 0.7, scale: 0.85, slot: "floor-mid" },
    { glyph: "🔧", x: 0.78, y: 0.1, scale: 0.9, slot: "wall" },
    { glyph: "🪛", x: 0.84, y: 0.18, scale: 0.85, slot: "wall" },
    { glyph: "📋", x: 0.18, y: 0.1, scale: 1.0, slot: "wall", caption: "TODO" },
    { glyph: "🪑", x: 0.55, y: 0.85, scale: 0.95, slot: "floor-front" },
  ],
  library: [
    // Note: the bookshelf SVG (R6 G2) takes over the wall on the right —
    // the left wall still gets a single emoji book stack for variety.
    { glyph: "📚", x: 0.16, y: 0.18, scale: 1.2, slot: "wall" },
    { glyph: "🕯", x: 0.5, y: 0.08, scale: 0.85, slot: "ceiling" },
    { glyph: "📖", x: 0.45, y: 0.6, scale: 1.1, slot: "floor-mid", caption: "open book" },
    { glyph: "🪑", x: 0.6, y: 0.78, scale: 1.05, slot: "floor-front" },
    { glyph: "🪴", x: 0.92, y: 0.95, scale: 0.95, slot: "corner", swapKind: "plant" },
  ],
  nursery: [
    { glyph: "🛏", x: 0.32, y: 0.55, scale: 1.4, slot: "floor-mid", caption: "crib" },
    { glyph: "🧸", x: 0.42, y: 0.7, scale: 1.0, slot: "floor-mid" },
    { glyph: "🍼", x: 0.7, y: 0.75, scale: 0.85, slot: "floor-front" },
    { glyph: "🎈", x: 0.18, y: 0.18, scale: 1.0, slot: "wall" },
    { glyph: "🎈", x: 0.82, y: 0.14, scale: 0.9, slot: "wall" },
    { glyph: "🌙", x: 0.86, y: 0.06, scale: 0.85, slot: "wall" },
  ],
  trophy: [
    { glyph: "🏆", x: 0.35, y: 0.42, scale: 1.5, slot: "floor-back", caption: "trophy" },
    { glyph: "🎖", x: 0.18, y: 0.16, scale: 1.0, slot: "wall" },
    { glyph: "🎖", x: 0.5, y: 0.1, scale: 0.9, slot: "wall" },
    { glyph: "🖼", x: 0.82, y: 0.18, scale: 1.0, slot: "wall", caption: "cert" },
    { glyph: "🟥", x: 0.5, y: 0.85, scale: 1.8, slot: "floor-front", caption: "carpet" },
    { glyph: "🪴", x: 0.92, y: 0.78, scale: 0.9, slot: "corner", swapKind: "plant" },
  ],
  study: [
    { glyph: "🎓", x: 0.78, y: 0.4, scale: 1.1, slot: "floor-back" },
    { glyph: "📐", x: 0.32, y: 0.55, scale: 1.2, slot: "floor-mid", caption: "desk" },
    { glyph: "📊", x: 0.2, y: 0.12, scale: 1.0, slot: "wall" },
    // Bookshelf SVG (R6 G2) replaces the right-wall emoji book stack.
    { glyph: "💡", x: 0.32, y: 0.4, scale: 0.85, slot: "floor-mid" },
    { glyph: "🪑", x: 0.5, y: 0.82, scale: 0.95, slot: "floor-front" },
  ],
  reception: [
    { glyph: "🪑", x: 0.32, y: 0.6, scale: 1.05, slot: "floor-mid" },
    { glyph: "🪑", x: 0.68, y: 0.6, scale: 1.05, slot: "floor-mid" },
    { glyph: "☕", x: 0.5, y: 0.65, scale: 0.95, slot: "floor-mid", caption: "coffee" },
    { glyph: "🌹", x: 0.5, y: 0.72, scale: 0.85, slot: "floor-front" },
    { glyph: "🖼", x: 0.5, y: 0.08, scale: 1.0, slot: "wall", caption: "family" },
    { glyph: "🪴", x: 0.1, y: 0.82, scale: 0.95, slot: "corner", swapKind: "plant" },
  ],
};

// ---------------------------------------------------------------------------
// Dynamic-layer slot presets — picked deterministically per room kind.
//
// Coordinates are intentionally clear of the avatar centerline (x≈0.6,
// y≈0.95) and clear of the window (top-left ~x=0.18..0.40, y=0.05..0.40)
// so the mess / event / tool / whiteboard layers never collide with the
// existing chrome. The Room Scene then picks the subset it needs.
// ---------------------------------------------------------------------------

const DYNAMIC_SLOTS: Record<RoomKind, RoomDynamicSlots> = {
  living: {
    toolSlot: { x: 0.5, y: 0.78 },
    messSlots: [
      { x: 0.18, y: 0.92 },
      { x: 0.3, y: 0.86 },
      { x: 0.7, y: 0.92 },
      { x: 0.82, y: 0.88 },
      { x: 0.5, y: 0.95 },
      { x: 0.12, y: 0.78 },
    ],
    eventSlots: [
      { x: 0.45, y: 0.12, anchor: "wall" },
      { x: 0.15, y: 0.08, anchor: "ceiling" },
      { x: 0.78, y: 0.92, anchor: "floor" },
      { x: 0.22, y: 0.94, anchor: "floor" },
    ],
    whiteboardSlot: { x: 0.62, y: 0.08, w: 0.32, h: 0.28 },
    achievementSlots: [
      { x: 0.06, y: 0.45, anchor: "wall" },
      { x: 0.95, y: 0.45, anchor: "wall" },
    ],
    frameSlots: [
      { x: 0.05, y: 0.36, w: 0.07, h: 0.09 },
      { x: 0.95, y: 0.36, w: 0.07, h: 0.09 },
      { x: 0.5, y: 0.14, w: 0.07, h: 0.09 },
    ],
    seasonSlot: { x: 0.08, y: 0.92 },
    mealSlot: { x: 0.32, y: 0.88 },
    petSlots: [
      { x: 0.42, y: 0.86 },
      { x: 0.78, y: 0.94 },
    ],
    // R6 G2 — narrow fridge on the back wall, left of the picture frames.
    fridgeSlot: { x: 0.12, y: 0.18, w: 0.08, h: 0.62 },
  },
  workshop: {
    // Tool prop sits closer to the avatar's hand height (floor y≈0.82) so
    // the book / monitor / terminal reads as being held, not floating.
    toolSlot: { x: 0.46, y: 0.82 },
    messSlots: [
      { x: 0.15, y: 0.9 },
      { x: 0.42, y: 0.92 },
      { x: 0.68, y: 0.95 },
      { x: 0.82, y: 0.88 },
      { x: 0.25, y: 0.78 },
      { x: 0.58, y: 0.86 },
    ],
    eventSlots: [
      { x: 0.5, y: 0.05, anchor: "ceiling" },
      { x: 0.78, y: 0.92, anchor: "floor" },
      { x: 0.16, y: 0.95, anchor: "floor" },
      { x: 0.6, y: 0.14, anchor: "wall" },
    ],
    whiteboardSlot: { x: 0.4, y: 0.06, w: 0.32, h: 0.3 },
    achievementSlots: [
      { x: 0.06, y: 0.5, anchor: "wall" },
      { x: 0.94, y: 0.5, anchor: "wall" },
    ],
    frameSlots: [
      { x: 0.05, y: 0.42, w: 0.07, h: 0.09 },
      { x: 0.95, y: 0.42, w: 0.07, h: 0.09 },
    ],
    seasonSlot: { x: 0.08, y: 0.94 },
    // Floor-anchored meal table — sits in front of the desk, not on it.
    mealSlot: { x: 0.18, y: 0.86 },
    petSlots: [
      { x: 0.32, y: 0.9 },
      { x: 0.72, y: 0.92 },
    ],
    // R6 G2 — small reference-shelf on the right wall, clear of whiteboard.
    bookshelfSlot: { x: 0.78, y: 0.34, w: 0.18, h: 0.48 },
  },
  library: {
    // Reading at the desk — drop the book toward the avatar's hands.
    toolSlot: { x: 0.5, y: 0.82 },
    messSlots: [
      { x: 0.22, y: 0.94 },
      { x: 0.38, y: 0.88 },
      { x: 0.7, y: 0.94 },
      { x: 0.84, y: 0.9 },
      { x: 0.5, y: 0.96 },
      { x: 0.14, y: 0.84 },
    ],
    eventSlots: [
      { x: 0.5, y: 0.08, anchor: "ceiling" },
      { x: 0.4, y: 0.14, anchor: "wall" },
      { x: 0.76, y: 0.93, anchor: "floor" },
      { x: 0.18, y: 0.95, anchor: "floor" },
    ],
    whiteboardSlot: { x: 0.4, y: 0.08, w: 0.3, h: 0.28 },
    achievementSlots: [
      { x: 0.04, y: 0.5, anchor: "wall" },
      { x: 0.96, y: 0.5, anchor: "wall" },
      // Wall-anchored extra frame sits mid-wall, not jammed at the floor seam.
      { x: 0.5, y: 0.68, anchor: "wall" },
      // Floor-anchored trophy / crown stand — pushed off the avatar centerline
      // and toward the front so it lands on the perspective floor cleanly.
      { x: 0.28, y: 0.82, anchor: "floor" },
    ],
    frameSlots: [
      { x: 0.05, y: 0.3, w: 0.07, h: 0.09 },
      { x: 0.95, y: 0.3, w: 0.07, h: 0.09 },
      { x: 0.78, y: 0.14, w: 0.07, h: 0.09 },
    ],
    seasonSlot: { x: 0.1, y: 0.9 },
    mealSlot: { x: 0.18, y: 0.88 },
    petSlots: [
      { x: 0.15, y: 0.88 },
      { x: 0.84, y: 0.94 },
    ],
    // R6 G2 — large bookshelf on the right wall (the library star prop).
    bookshelfSlot: { x: 0.74, y: 0.16, w: 0.22, h: 0.68 },
  },
  nursery: {
    toolSlot: { x: 0.5, y: 0.78 },
    messSlots: [
      { x: 0.16, y: 0.92 },
      { x: 0.34, y: 0.95 },
      { x: 0.6, y: 0.94 },
      { x: 0.84, y: 0.9 },
    ],
    eventSlots: [
      { x: 0.5, y: 0.05, anchor: "ceiling" },
      { x: 0.5, y: 0.12, anchor: "wall" },
      { x: 0.78, y: 0.92, anchor: "floor" },
      { x: 0.2, y: 0.94, anchor: "floor" },
    ],
    // No whiteboard in the nursery.
    achievementSlots: [
      { x: 0.06, y: 0.5, anchor: "wall" },
      { x: 0.94, y: 0.5, anchor: "wall" },
    ],
    frameSlots: [
      { x: 0.7, y: 0.14, w: 0.07, h: 0.09 },
      { x: 0.05, y: 0.42, w: 0.07, h: 0.09 },
      { x: 0.95, y: 0.42, w: 0.07, h: 0.09 },
    ],
    seasonSlot: { x: 0.1, y: 0.92 },
    // Floor table near the front-left, away from the crib + tools.
    mealSlot: { x: 0.16, y: 0.88 },
    petSlots: [
      { x: 0.5, y: 0.86 },
      { x: 0.85, y: 0.94 },
    ],
    // R6 G2 — compact baby-fridge tucked into the right wall.
    fridgeSlot: { x: 0.16, y: 0.32, w: 0.07, h: 0.46 },
  },
  trophy: {
    toolSlot: { x: 0.5, y: 0.8 },
    messSlots: [
      { x: 0.18, y: 0.92 },
      { x: 0.78, y: 0.92 },
      { x: 0.16, y: 0.78 },
      { x: 0.84, y: 0.78 },
    ],
    eventSlots: [
      { x: 0.5, y: 0.05, anchor: "ceiling" },
      { x: 0.6, y: 0.14, anchor: "wall" },
      { x: 0.18, y: 0.94, anchor: "floor" },
      { x: 0.8, y: 0.94, anchor: "floor" },
    ],
    // No whiteboard in the trophy room.
    achievementSlots: [
      { x: 0.04, y: 0.45, anchor: "wall" },
      { x: 0.95, y: 0.45, anchor: "wall" },
      // Trophy podia are floor-anchored toward the back-front edge so they
      // sit on the perspective floor cleanly, off the avatar centerline.
      { x: 0.3, y: 0.78, anchor: "floor" },
      { x: 0.78, y: 0.84, anchor: "floor" },
    ],
    frameSlots: [
      { x: 0.05, y: 0.3, w: 0.07, h: 0.09 },
      { x: 0.95, y: 0.3, w: 0.07, h: 0.09 },
      { x: 0.5, y: 0.14, w: 0.07, h: 0.09 },
    ],
    seasonSlot: { x: 0.1, y: 0.92 },
    // Floor pedestal table near the front-left, off-axis to the trophy.
    mealSlot: { x: 0.16, y: 0.88 },
    petSlots: [
      { x: 0.32, y: 0.88 },
      { x: 0.78, y: 0.95 },
    ],
  },
  study: {
    // Drop tool down to the avatar's hands instead of mid-air desk height.
    toolSlot: { x: 0.42, y: 0.82 },
    messSlots: [
      { x: 0.18, y: 0.94 },
      { x: 0.34, y: 0.9 },
      { x: 0.7, y: 0.94 },
      { x: 0.84, y: 0.88 },
      { x: 0.5, y: 0.95 },
      { x: 0.12, y: 0.78 },
    ],
    eventSlots: [
      { x: 0.5, y: 0.05, anchor: "ceiling" },
      { x: 0.42, y: 0.14, anchor: "wall" },
      { x: 0.76, y: 0.93, anchor: "floor" },
      { x: 0.2, y: 0.95, anchor: "floor" },
    ],
    whiteboardSlot: { x: 0.5, y: 0.06, w: 0.3, h: 0.3 },
    achievementSlots: [
      { x: 0.06, y: 0.45, anchor: "wall" },
      { x: 0.94, y: 0.45, anchor: "wall" },
      // Lower wall-anchored frame moved away from floor seam.
      { x: 0.5, y: 0.72, anchor: "wall" },
      // Floor display: front-right corner so it lands on visible floor.
      { x: 0.82, y: 0.84, anchor: "floor" },
    ],
    frameSlots: [
      { x: 0.05, y: 0.3, w: 0.07, h: 0.09 },
      { x: 0.95, y: 0.3, w: 0.07, h: 0.09 },
      { x: 0.85, y: 0.14, w: 0.07, h: 0.09 },
    ],
    seasonSlot: { x: 0.08, y: 0.92 },
    mealSlot: { x: 0.18, y: 0.88 },
    petSlots: [
      { x: 0.5, y: 0.88 },
      { x: 0.85, y: 0.95 },
    ],
    // R6 G2 — bookshelf on the right wall, narrower than the library shelf
    // because the whiteboard occupies most of the back wall.
    bookshelfSlot: { x: 0.82, y: 0.16, w: 0.14, h: 0.58 },
  },
  reception: {
    toolSlot: { x: 0.5, y: 0.82 },
    messSlots: [
      { x: 0.18, y: 0.94 },
      { x: 0.82, y: 0.92 },
      { x: 0.4, y: 0.86 },
      { x: 0.62, y: 0.88 },
    ],
    eventSlots: [
      { x: 0.5, y: 0.05, anchor: "ceiling" },
      { x: 0.32, y: 0.14, anchor: "wall" },
      { x: 0.74, y: 0.94, anchor: "floor" },
      { x: 0.22, y: 0.94, anchor: "floor" },
    ],
    // No whiteboard in reception — kept formal-looking.
    achievementSlots: [
      { x: 0.04, y: 0.5, anchor: "wall" },
      { x: 0.96, y: 0.5, anchor: "wall" },
    ],
    frameSlots: [
      { x: 0.05, y: 0.22, w: 0.07, h: 0.09 },
      { x: 0.05, y: 0.4, w: 0.07, h: 0.09 },
      { x: 0.95, y: 0.22, w: 0.07, h: 0.09 },
      { x: 0.95, y: 0.4, w: 0.07, h: 0.09 },
      { x: 0.4, y: 0.14, w: 0.07, h: 0.09 },
      { x: 0.6, y: 0.14, w: 0.07, h: 0.09 },
    ],
    seasonSlot: { x: 0.1, y: 0.92 },
    // Coffee table on the floor between the two reception chairs.
    mealSlot: { x: 0.5, y: 0.78 },
    petSlots: [
      { x: 0.32, y: 0.88 },
      { x: 0.74, y: 0.95 },
    ],
    // R6 G2 — display shelf for guests, mid-height back-left wall.
    bookshelfSlot: { x: 0.16, y: 0.28, w: 0.14, h: 0.5 },
  },
};

/** Look up the dynamic-layer slot anchors for a given room kind. */
export function getRoomDynamicSlots(kind: RoomKind): RoomDynamicSlots {
  return DYNAMIC_SLOTS[kind];
}

// ---------------------------------------------------------------------------
// Public — deterministic layout
// ---------------------------------------------------------------------------

/**
 * Return the furniture layout for a given room kind. The `seed` is mixed in
 * to vary glyph rotation / minor offsets between sessions without changing
 * which items appear, so two different residents living in the same room
 * kind never feel like clones.
 */
export function getFurnitureLayout(
  kind: RoomKind,
  seed: number,
): FurnitureItem[] {
  const base = TEMPLATES[kind];
  // Tiny seeded jitter (±3% on each axis) keeps the room from feeling
  // identical between sessions but stays well clear of walls.
  return base.map((item, i) => {
    const k = (seed + i * 131) & 0xffff;
    const jx = ((k % 17) - 8) / 200; // ≈ ±0.04
    const jy = (((k >> 4) % 17) - 8) / 200;
    return {
      ...item,
      x: clamp01(item.x + jx),
      y: clamp01(item.y + jy),
    };
  });
}

/** Short display label for the room kind — shown in the scene chrome. */
export function roomKindLabel(kind: RoomKind): string {
  switch (kind) {
    case "living":
      return "Living room";
    case "workshop":
      return "Workshop";
    case "library":
      return "Library";
    case "nursery":
      return "Nursery";
    case "trophy":
      return "Trophy room";
    case "study":
      return "Study";
    case "reception":
      return "Reception";
  }
}

/** Wallpaper / floor palette for a room. Drives the back-wall and floor. */
export interface RoomPalette {
  wallTop: string;
  wallBottom: string;
  /** Wallpaper accent (subtle dot / stripe). */
  wallAccent: string;
  floorNear: string;
  floorFar: string;
  /** Small badge color, e.g. for the room-kind chip. */
  accent: string;
}

export function roomPalette(kind: RoomKind, hue: number): RoomPalette {
  // Tie the wallpaper hue back to the resident's repo hue so each house
  // feels personal, but keep saturation low so furniture pops on top.
  const wallH = (hue + 20) % 360;
  const wallSat = 22;
  switch (kind) {
    case "living":
      return {
        wallTop: `hsl(${wallH}, ${wallSat}%, 82%)`,
        wallBottom: `hsl(${wallH}, ${wallSat - 4}%, 74%)`,
        wallAccent: `hsla(${wallH}, ${wallSat}%, 60%, 0.18)`,
        floorNear: "#A0794F",
        floorFar: "#6F5234",
        accent: `hsl(${wallH}, 55%, 55%)`,
      };
    case "workshop":
      return {
        wallTop: `hsl(${(wallH + 200) % 360}, 14%, 78%)`,
        wallBottom: `hsl(${(wallH + 200) % 360}, 14%, 68%)`,
        wallAccent: `hsla(${(wallH + 200) % 360}, 25%, 50%, 0.2)`,
        floorNear: "#5C5C5C",
        floorFar: "#3A3A3A",
        accent: "#FFC547",
      };
    case "library":
      return {
        wallTop: `hsl(${(wallH + 30) % 360}, 25%, 76%)`,
        wallBottom: `hsl(${(wallH + 30) % 360}, 22%, 66%)`,
        wallAccent: `hsla(${(wallH + 30) % 360}, 35%, 40%, 0.2)`,
        floorNear: "#7C5A36",
        floorFar: "#503823",
        accent: "#A66C3C",
      };
    case "nursery":
      return {
        wallTop: `hsl(${(wallH + 320) % 360}, 55%, 88%)`,
        wallBottom: `hsl(${(wallH + 320) % 360}, 50%, 80%)`,
        wallAccent: `hsla(${(wallH + 320) % 360}, 60%, 55%, 0.2)`,
        floorNear: "#E9D9C5",
        floorFar: "#C7B59B",
        accent: "#F08FB4",
      };
    case "trophy":
      return {
        wallTop: `hsl(${(wallH + 45) % 360}, 35%, 78%)`,
        wallBottom: `hsl(${(wallH + 45) % 360}, 30%, 68%)`,
        wallAccent: `hsla(${(wallH + 45) % 360}, 60%, 50%, 0.22)`,
        floorNear: "#8C6E3E",
        floorFar: "#5E4524",
        accent: "#E5B14B",
      };
    case "study":
      return {
        wallTop: `hsl(${(wallH + 220) % 360}, 22%, 80%)`,
        wallBottom: `hsl(${(wallH + 220) % 360}, 22%, 70%)`,
        wallAccent: `hsla(${(wallH + 220) % 360}, 35%, 50%, 0.2)`,
        floorNear: "#6F5436",
        floorFar: "#4A3825",
        accent: "#6A8AC5",
      };
    case "reception":
      return {
        wallTop: `hsl(${(wallH + 340) % 360}, 30%, 84%)`,
        wallBottom: `hsl(${(wallH + 340) % 360}, 25%, 74%)`,
        wallAccent: `hsla(${(wallH + 340) % 360}, 45%, 55%, 0.18)`,
        floorNear: "#B59B7A",
        floorFar: "#7C6647",
        accent: "#D4798C",
      };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0.04) return 0.04;
  if (x > 0.96) return 0.96;
  return x;
}
