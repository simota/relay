// Glue between "a task was closed" and the recurring-task scheduler, shared
// by every close surface (`relay close`, `relay run --close-on-success`,
// POST /api/tasks/:id/close, bulk close) so they spawn the next occurrence
// and record it in the same undo entry the same way.

import type { RelayDB } from "../db/client.js";
import type { SpawnedOccurrence } from "../db/queries/recurrence.js";

export interface RecurrenceUndoExtras {
  spawned: SpawnedOccurrence[];
  /** Merge into the undo row's `payload` (redo re-spawns from these ids). */
  payload: { respawn?: number[] };
  /** Merge into the undo row's `inverse` (undo drops these occurrences). */
  inverse: { drop?: number[] };
}

export function spawnAfterClose(db: RelayDB, closedIds: number[]): RecurrenceUndoExtras {
  const spawned = db.spawnNextOccurrences(closedIds);
  if (spawned.length === 0) return { spawned, payload: {}, inverse: {} };
  return {
    spawned,
    payload: { respawn: spawned.map((s) => s.from) },
    inverse: { drop: spawned.map((s) => s.id) },
  };
}

/** Read the optional `respawn` / `drop` id lists of an undo payload. */
export function recurrenceUndoIds(raw: string, key: "respawn" | "drop"): number[] {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const list = parsed && typeof parsed === "object" ? parsed[key] : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}
