// Fleet Hamlet — Fit-All layout solver.
//
// Given the container's inner pixel size and the active / park household
// counts, compute a column count + cell size for each zone so that
// **every** house plus the park fits inside the container without
// scrolling. Houses scale dynamically; when even the minimum cell size
// can't accommodate everyone we fall back to the tiny renderer and an
// `overflowCount` chip for the rest.
//
// Pure / deterministic — no DOM access, safe for SSR and memoization.

/** Smallest cell size the regular HouseSvg renders cleanly at. */
export const MIN_CELL = 70;
/** Largest cell size we ever expand to (avoids dwarf-village look at low counts). */
export const MAX_CELL = 180;
/** Upper ceiling for MAX_CELL when the container is tall (height > 500px). */
export const MAX_CELL_TALL = 200;
/** Cell size used by the TinyHouseSvg fallback. */
export const TINY_CELL = 48;

/** Vertical share of the container the active zone gets when park has residents. */
const ACTIVE_SHARE_WITH_PARK = 0.70;
/** When no park residents, active takes (nearly) everything except a small ground margin. */
const ACTIVE_SHARE_SOLO = 0.95;
/** Park always gets at least this much vertical room when populated. */
const MIN_PARK_HEIGHT = 80;
/** Active always reserves at least this much (HUD + sky + 1 row of houses). */
const MIN_ACTIVE_HEIGHT = 160;
/** Horizontal padding budget reserved on each side of the grid (px). */
const SIDE_PAD = 16;

export interface FitLayout {
  /** Effective container width / height after subtracting padding. */
  innerW: number;
  innerH: number;
  /** Active zone (recently-active sims) — main street. */
  activeCols: number;
  activeRows: number;
  activeCellW: number;
  activeCellH: number;
  activeZoneH: number;
  /** How many active sims actually get rendered as houses (the rest overflow). */
  activeVisible: number;
  /** Park zone (idle sims) — silent grove. */
  parkCols: number;
  parkRows: number;
  parkCellW: number;
  parkCellH: number;
  parkZoneH: number;
  parkVisible: number;
  /** When true the active grid should render with TinyHouseSvg. */
  useTiny: boolean;
  /** Total sims that didn't make it onto the grid — surfaced as a `+N more` chip. */
  overflowCount: number;
}

/**
 * Solve a fit-all layout for the Neighborhood street pane.
 *
 * Strategy:
 *   1. Clamp container to sane defaults if SSR / pre-mount (0 or tiny).
 *   2. Decide vertical share: active gets 65% when park is populated, else solo.
 *   3. For each zone, pick the largest cell ≤ MAX_CELL that fits all houses.
 *      - cols = max(1, min(count, floor(innerW / MIN_CELL)))
 *      - cellW candidate = innerW / cols (clamped to [MIN_CELL, MAX_CELL])
 *      - rows = ceil(count / cols)
 *      - cellH candidate = zoneH / rows
 *      - cell = min(cellW, cellH * 1.25) — slight rectangle tolerance so houses
 *        stay roughly square but can tolerate wider grids.
 *   4. If active overflows even at MIN_CELL → switch to TINY_CELL via `useTiny`
 *      and trim the trailing sims into `overflowCount`.
 */
export function computeFitLayout(
  containerW: number,
  containerH: number,
  activeCount: number,
  parkCount: number,
): FitLayout {
  // SSR / pre-mount sentinel — render at a reasonable default so the first
  // paint isn't blank. The ResizeObserver replaces it within one frame.
  const W = Math.max(280, containerW || 720);
  const H = Math.max(220, containerH || 480);

  const innerW = Math.max(160, W - SIDE_PAD * 2);
  const innerH = Math.max(180, H);

  const hasPark = parkCount > 0;
  const hasActive = activeCount > 0;

  // Vertical split between active and park. When one side is empty the
  // other gets effectively all of the container.
  const activeShare = hasActive && hasPark
    ? ACTIVE_SHARE_WITH_PARK
    : hasActive
    ? ACTIVE_SHARE_SOLO
    : 0;

  let activeZoneH = Math.floor(innerH * activeShare);
  let parkZoneH = hasPark ? Math.floor(innerH - activeZoneH) : 0;

  // Honour minimums when both zones populated; otherwise let the populated
  // one expand.
  if (hasActive && hasPark) {
    if (parkZoneH < MIN_PARK_HEIGHT) {
      parkZoneH = Math.min(innerH - MIN_ACTIVE_HEIGHT, MIN_PARK_HEIGHT);
      activeZoneH = innerH - parkZoneH;
    }
    if (activeZoneH < MIN_ACTIVE_HEIGHT) {
      activeZoneH = MIN_ACTIVE_HEIGHT;
      parkZoneH = Math.max(60, innerH - activeZoneH);
    }
  } else if (hasActive) {
    activeZoneH = innerH;
  } else if (hasPark) {
    parkZoneH = innerH;
  }

  // Tall containers let us push houses larger so the village feels like the
  // main subject rather than a postage stamp. Capped to MAX_CELL_TALL.
  const tallContainer = H > 500;

  // ---------------- Active zone ----------------
  const activeFit = solveZone(
    innerW,
    activeZoneH,
    activeCount,
    /* tiny */ false,
    tallContainer,
  );
  let useTiny = false;
  let activeFinal = activeFit;
  let overflowActive = 0;
  if (activeFit.overflow > 0 && activeCount > 0) {
    // Try tiny rendering.
    const tinyFit = solveZone(
      innerW,
      activeZoneH,
      activeCount,
      /* tiny */ true,
      tallContainer,
    );
    useTiny = true;
    activeFinal = tinyFit;
    overflowActive = tinyFit.overflow;
  }

  // ---------------- Park zone ----------------
  // Park always uses small cells (still HouseSvg "sm"); we don't try to
  // expand them to MAX_CELL — they're dormant residents.
  const parkFit = solveZone(
    innerW,
    parkZoneH,
    parkCount,
    /* tiny */ true,
    /* tall */ false,
  );
  // If the park still overflows at TINY_CELL the leftover residents
  // join the same "+N more" chip as active overflow.
  const overflowPark = parkFit.overflow;

  return {
    innerW,
    innerH,
    activeCols: activeFinal.cols,
    activeRows: activeFinal.rows,
    activeCellW: activeFinal.cellW,
    activeCellH: activeFinal.cellH,
    activeZoneH,
    activeVisible: activeFinal.visible,
    parkCols: parkFit.cols,
    parkRows: parkFit.rows,
    parkCellW: parkFit.cellW,
    parkCellH: parkFit.cellH,
    parkZoneH,
    parkVisible: parkFit.visible,
    useTiny,
    overflowCount: overflowActive + overflowPark,
  };
}

interface ZoneFit {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  visible: number;
  overflow: number;
}

function solveZone(
  innerW: number,
  zoneH: number,
  count: number,
  tiny: boolean,
  tall: boolean,
): ZoneFit {
  if (count <= 0 || zoneH <= 0) {
    return { cols: 0, rows: 0, cellW: 0, cellH: 0, visible: 0, overflow: 0 };
  }
  const minCell = tiny ? TINY_CELL : MIN_CELL;
  const maxCell = tiny ? TINY_CELL + 12 : tall ? MAX_CELL_TALL : MAX_CELL;

  // Greedy: try the largest cell that lets `count` fit in `zoneH`.
  // Iterate cellW from maxCell down to minCell; for each, cols = floor(innerW / cellW),
  // rows = ceil(count / cols), then check rows * cellH ≤ zoneH where cellH
  // tracks cellW with the 0.85 aspect (houses are slightly taller than wide
  // because of label + moodlet overhead).
  const aspect = 1.15; // cellH / cellW — labels + bubble overhead.
  for (let cell = maxCell; cell >= minCell; cell -= 2) {
    const cols = Math.max(1, Math.min(count, Math.floor(innerW / cell)));
    if (cols === 0) continue;
    const rows = Math.ceil(count / cols);
    const cellH = cell * aspect;
    if (rows * cellH <= zoneH) {
      return { cols, rows, cellW: cell, cellH, visible: count, overflow: 0 };
    }
  }

  // Overflow path — pack as many as we can at minCell.
  const cols = Math.max(1, Math.min(count, Math.floor(innerW / minCell)));
  const cellH = minCell * 1.15;
  const maxRows = Math.max(1, Math.floor(zoneH / cellH));
  const visible = Math.min(count, cols * maxRows);
  return {
    cols,
    rows: Math.ceil(visible / cols),
    cellW: minCell,
    cellH,
    visible,
    overflow: count - visible,
  };
}
