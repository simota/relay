// Recurring-task occurrences (schema v13). See src/lib/recurrence.ts for
// the rule format and scheduling semantics.

import type { Database } from "bun:sqlite";
import { nextOccurrence, occurrenceSourceId, recurrenceRoot } from "../../lib/recurrence.js";
import { hydrate } from "../internal.js";

export interface SpawnedOccurrence {
  /** The closed occurrence that produced it. */
  from: number;
  /** The new, snoozed-until-due task. */
  id: number;
  due_at: string;
}

/**
 * For every task in `ids` that is done and carries a recurrence rule,
 * insert its next occurrence: a manual task with the same repo / title /
 * body / assignee / priority / prompt / files / wait_on / tags / rule,
 * snoozed until the next due date so it wakes up on its own.
 *
 * Idempotent per (series, day): the occurrence's source_id is
 * `recur:<root>:<YYYY-MM-DD>`, so closing → undo → closing again, or two
 * surfaces closing the same task, never produces a duplicate. Returns only
 * the occurrences actually inserted.
 */
export function spawnNextOccurrences(db: Database, ids: number[], now: Date = new Date()): SpawnedOccurrence[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT * FROM tasks
        WHERE id IN (${placeholders}) AND status = 'done' AND recurrence IS NOT NULL AND recurrence != ''`,
    )
    .all(...ids) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO tasks (
       source_type, source_id, repo, title, body, status, assignee, priority,
       prompt, files, context_hash, session_id, due_at, wait_on,
       created_at, updated_at, closed_at, user_overrides, tags, recurrence
     ) VALUES ('manual', ?, ?, ?, ?, 'snoozed', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  );
  const out: SpawnedOccurrence[] = [];
  const nowIso = now.toISOString();
  const tx = db.transaction(() => {
    for (const row of rows) {
      const task = hydrate(row);
      const rule = task.recurrence;
      if (!rule) continue;
      const due = nextOccurrence(rule, task.due_at, now);
      if (!due) continue;
      const sourceId = occurrenceSourceId(recurrenceRoot(task), due);
      const info = insert.run(
        sourceId,
        task.repo,
        task.title,
        task.body,
        task.assignee,
        task.priority,
        task.prompt,
        task.files.length ? JSON.stringify(task.files) : null,
        due,
        task.wait_on,
        nowIso,
        nowIso,
        task.tags && task.tags.length ? JSON.stringify(task.tags) : null,
        rule,
      );
      if (Number(info.changes) > 0) {
        out.push({ from: task.id, id: Number(info.lastInsertRowid), due_at: due });
      }
    }
  });
  tx();
  return out;
}

/**
 * Undo of a recurring close: delete occurrences it spawned, but only while
 * they are untouched (still snoozed, never edited, never run) so undo can
 * never destroy work the user did on the new occurrence. Returns the ids
 * actually removed.
 */
export function dropSpawnedOccurrences(db: Database, ids: number[]): number[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT t.id FROM tasks t
        WHERE t.id IN (${placeholders})
          AND t.source_type = 'manual'
          AND t.source_id LIKE 'recur:%'
          AND t.status = 'snoozed'
          AND t.updated_at = t.created_at
          AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.id)`,
    )
    .all(...ids) as Array<{ id: number }>;
  const removable = rows.map((r) => r.id);
  if (removable.length === 0) return [];
  db.prepare(`DELETE FROM tasks WHERE id IN (${removable.map(() => "?").join(", ")})`).run(...removable);
  return removable;
}
