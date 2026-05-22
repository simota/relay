// Hamlet Rooms — Neighbor Bond (軸1).
//
// Computes the "next door" and "previous door" neighbor for each sim in the
// Rooms grid (order = frozenSims array, grid is row-major). Pure, deterministic.

import type { SimCardModel } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RoomNeighborInfo {
  /** The sim that lives in the cell immediately after this one (i+1). */
  neighborNext: SimCardModel | null;
  /** The sim that lives in the cell immediately before this one (i-1). */
  neighborPrev: SimCardModel | null;
  /** True when any adjacent neighbor shares the same repo. */
  isRoommate: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a map from sim.key → neighbor info for the current frozenSims order.
 * The grid layout is assumed row-major so "next" = i+1 and "prev" = i-1
 * in the flat array, regardless of how many columns are actually rendered.
 */
export function computeRoomNeighbors(
  frozenSims: readonly SimCardModel[],
): Map<string, RoomNeighborInfo> {
  const result = new Map<string, RoomNeighborInfo>();
  for (let i = 0; i < frozenSims.length; i++) {
    const sim = frozenSims[i];
    if (!sim) continue;
    const prev = i > 0 ? (frozenSims[i - 1] ?? null) : null;
    const next = i < frozenSims.length - 1 ? (frozenSims[i + 1] ?? null) : null;
    const isRoommate =
      (prev !== null && prev.repo !== null && prev.repo === sim.repo) ||
      (next !== null && next.repo !== null && next.repo === sim.repo);
    result.set(sim.key, {
      neighborNext: next,
      neighborPrev: prev,
      isRoommate,
    });
  }
  return result;
}
