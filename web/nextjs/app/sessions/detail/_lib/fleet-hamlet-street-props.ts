// Hamlet — Street props placement helpers.
//
// Picks a deterministic set of "street furniture" — utility poles, signs,
// benches, vending machines, bus stops, trash cans, traffic signs — to
// scatter between the houses on the Neighborhood main street. Inspired by
// Codrops' "Generative CSS Worlds" 2:1 dimetric block-placement playbook,
// but rendered as pure SVG (no CSS 3D transforms).
//
// Density scales with the active-cell count and the seed is drawn from the
// cards so the same village always produces the same street props.

import { hashStringToInt } from "./fleet-hamlet";
import type { Season } from "./fleet-hamlet-particles";
import type { WeatherKind } from "./fleet-hamlet-layout";

// ---------------------------------------------------------------------------
// Prop kinds — each maps to one SVG sprite in fleet-hamlet-street-props.tsx
// ---------------------------------------------------------------------------

export type StreetPropKind =
  | "utility-pole"
  | "billboard"
  | "bench"
  | "vending"
  | "bus-stop"
  | "trash"
  | "traffic-sign"
  | "puddle"        // stormy-only addon
  | "fallen-leaves" // autumn-only addon
  | "snow-pile";    // winter + vending combo

export interface StreetProp {
  /** Stable key for React lists. */
  id: string;
  kind: StreetPropKind;
  /** Grid column index for placement (0..cols, half-cells allowed). */
  col: number;
  /** Grid row index (0..rows). */
  row: number;
  /** Sub-cell horizontal offset (-0.5..0.5) — places prop in the gap. */
  offsetX: number;
  /** Sub-cell vertical offset (-0.2..0.6) — anchors near the cell base. */
  offsetY: number;
  /** Optional label text for billboards / signs. */
  label?: string;
  /** Optional hue rotation for variety (vending machines / billboards). */
  hue?: number;
}

// ---------------------------------------------------------------------------
// Density tiers — keep prop nodes <= 50 even at 9+ houses
// ---------------------------------------------------------------------------

interface DensityTier {
  base: number;
  variance: number;
}

function densityForCount(count: number): DensityTier {
  if (count <= 0) return { base: 0, variance: 0 };
  if (count <= 3) return { base: 2, variance: 1 };
  if (count <= 8) return { base: 4, variance: 2 };
  return { base: 6, variance: 2 };
}

// Core prop pool — biased so utility poles + signage feel like the spine of
// the street, with bigger furniture (bench/vending/bus stop) as accents.
const CORE_POOL: { kind: StreetPropKind; weight: number }[] = [
  { kind: "utility-pole", weight: 4 },
  { kind: "billboard", weight: 2 },
  { kind: "bench", weight: 2 },
  { kind: "vending", weight: 2 },
  { kind: "bus-stop", weight: 1 },
  { kind: "trash", weight: 3 },
  { kind: "traffic-sign", weight: 2 },
];

const BILLBOARD_LABELS = [
  "WELCOME",
  "OPEN",
  "RELAY",
  "HAMLET",
  "MARKET",
  "CAFE",
  "FRESH",
  "DAILY",
];

const SIGN_LABELS = ["STOP", "→", "←", "↑", "SLOW", "YIELD"];

// ---------------------------------------------------------------------------
// Main API — pickStreetProps
// ---------------------------------------------------------------------------

/**
 * Pick street props for the Neighborhood active grid. Returns an empty list
 * for tiny mode (caller should also gate on `fit.useTiny`).
 *
 * The placement strategy:
 *  - Iterate (col, row) gaps between house cells.
 *  - Use the seed to deterministically choose a prop kind per gap.
 *  - Anchor all props — including tall ones (utility poles, signs,
 *    billboards) — to the ground line so their bases sit on the street.
 *    The "back" lane only differs in column offset and prop bias, not in
 *    vertical anchor.
 *  - Seasonal/weather addons (puddle / fallen-leaves / snow-pile) are
 *    appended on top of the core list, anchored near the front edge.
 */
export function pickStreetProps(
  activeCellsCount: number,
  cols: number,
  rows: number,
  seed: number,
  options?: { weather?: WeatherKind; season?: Season },
): StreetProp[] {
  if (activeCellsCount <= 0 || cols <= 0 || rows <= 0) return [];

  const tier = densityForCount(activeCellsCount);
  // Deterministic linear congruential pseudo-RNG seeded by the card seed.
  let state = (seed | 0) || 1;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const count = tier.base + Math.floor(rand() * (tier.variance + 1));
  // Gap inventory — interstitial slots between cells along the street.
  // Front lane sits between adjacent cells (col .5), back lane sits at the
  // cell edge (col 0). Both lanes share the same ground-line anchor
  // (`oy = 0.78`) so tall props (poles, signs) stand on the street and
  // rise into the sky instead of floating in mid-air. Back lane is only
  // populated for every other column to avoid crowding.
  const gaps: { col: number; row: number; ox: number; oy: number; backRow: boolean }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      gaps.push({ col: c, row: r, ox: 0.5, oy: 0.78, backRow: false });
      if (c % 2 === 0) {
        gaps.push({ col: c, row: r, ox: 0.0, oy: 0.78, backRow: true });
      }
    }
  }
  // Shuffle gaps deterministically.
  for (let i = gaps.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = gaps[i]!;
    gaps[i] = gaps[j]!;
    gaps[j] = tmp;
  }

  const props: StreetProp[] = [];
  const picks = Math.min(count, gaps.length);
  for (let i = 0; i < picks; i++) {
    const g = gaps[i]!;
    const kind = pickKindForGap(g.backRow, rand);
    const id = `prop-${i}-${kind}`;
    let label: string | undefined;
    let hue: number | undefined;
    if (kind === "billboard") {
      label = BILLBOARD_LABELS[Math.floor(rand() * BILLBOARD_LABELS.length)];
      hue = Math.floor(rand() * 360);
    } else if (kind === "traffic-sign") {
      label = SIGN_LABELS[Math.floor(rand() * SIGN_LABELS.length)];
    } else if (kind === "vending") {
      hue = Math.floor(rand() * 360);
    }
    props.push({
      id,
      kind,
      col: g.col,
      row: g.row,
      offsetX: g.ox,
      offsetY: g.oy,
      label,
      hue,
    });
  }

  // Seasonal / weather addons — appended so they layer on top of the core
  // street furniture rather than displacing it.
  const weather = options?.weather;
  const season = options?.season;
  if (weather === "stormy") {
    const puddleCount = Math.min(3, Math.max(1, Math.floor(activeCellsCount / 3)));
    for (let i = 0; i < puddleCount; i++) {
      const c = Math.floor(rand() * cols);
      const r = Math.floor(rand() * rows);
      props.push({
        id: `puddle-${i}`,
        kind: "puddle",
        col: c,
        row: r,
        offsetX: rand() - 0.5,
        offsetY: 0.86 + rand() * 0.06,
      });
    }
  }
  if (season === "autumn") {
    const leafCount = Math.min(4, Math.max(2, Math.floor(activeCellsCount / 2)));
    for (let i = 0; i < leafCount; i++) {
      const c = Math.floor(rand() * cols);
      const r = Math.floor(rand() * rows);
      props.push({
        id: `leaves-${i}`,
        kind: "fallen-leaves",
        col: c,
        row: r,
        offsetX: rand() - 0.5,
        offsetY: 0.82 + rand() * 0.08,
      });
    }
  }
  if (season === "winter") {
    // Snow piles in front of any vending machine we picked.
    let snowIdx = 0;
    for (const p of props.slice()) {
      if (p.kind !== "vending") continue;
      props.push({
        id: `snow-${snowIdx++}`,
        kind: "snow-pile",
        col: p.col,
        row: p.row,
        offsetX: p.offsetX,
        offsetY: 0.9,
      });
    }
  }

  return props;
}

function pickKindForGap(
  backRow: boolean,
  rand: () => number,
): StreetPropKind {
  if (backRow) {
    // Back row strongly favors tall thin props.
    const r = rand();
    if (r < 0.55) return "utility-pole";
    if (r < 0.85) return "billboard";
    return "traffic-sign";
  }
  // Front row weighted pool.
  const totalWeight = CORE_POOL.reduce((s, p) => s + p.weight, 0);
  let pick = rand() * totalWeight;
  for (const p of CORE_POOL) {
    pick -= p.weight;
    if (pick <= 0) return p.kind;
  }
  return CORE_POOL[0]!.kind;
}

/** Convenience — derive a seed from the active card set (key prefixes). */
export function streetPropSeedFromKeys(keys: readonly string[]): number {
  // Sum of first-card-key char codes + count, normalised through
  // hashStringToInt so the result is stable.
  if (keys.length === 0) return 1;
  const joined = keys.slice(0, 4).join("|");
  return hashStringToInt(joined) || 1;
}
