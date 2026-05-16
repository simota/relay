// Runs, sync_history, queue_items, undo_log helpers extracted from
// `client.ts`. The `ensureXxxSchema` calls preserve the original
// lazy-create behavior for DBs that predate later schema bumps.

import type { Database } from "bun:sqlite";
import type { UndoLogRow } from "../schema.js";
import {
  ensureQueueSchema,
  ensureSyncHistorySchema,
  ensureUndoSchema,
} from "../migrations.js";
import type { LatestSyncRow, QueueItem, SyncHistoryRow } from "../types.js";

/**
 * Most recent successful run per task within the given window. Used by
 * `relay standup` to attach an agent/output_summary cue to each Yesterday
 * row. Returns at most one run per task (the latest success).
 */
export function latestSuccessfulRunsForTasks(
  db: Database,
  taskIds: number[],
  sinceIso: string,
): Map<number, { agent: string; output_summary: string | null; ended_at: string | null }> {
  const out = new Map<
    number,
    { agent: string; output_summary: string | null; ended_at: string | null }
  >();
  if (taskIds.length === 0) return out;
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT r.task_id, r.agent, r.output_summary, r.ended_at
         FROM runs r
        WHERE r.task_id IN (${placeholders})
          AND r.status = 'success'
          AND r.ended_at IS NOT NULL
          AND r.ended_at >= ?
          AND NOT EXISTS (
            SELECT 1 FROM runs n
             WHERE n.task_id = r.task_id
               AND n.status = 'success'
               AND n.ended_at IS NOT NULL
               AND n.ended_at >= ?
               AND (
                 n.ended_at > r.ended_at
                 OR (n.ended_at = r.ended_at AND n.id > r.id)
               )
          )`,
    )
    .all(...taskIds, sinceIso, sinceIso) as Array<{
    task_id: number;
    agent: string;
    output_summary: string | null;
    ended_at: string | null;
  }>;
  for (const row of rows) {
    out.set(row.task_id, {
      agent: row.agent,
      output_summary: row.output_summary,
      ended_at: row.ended_at,
    });
  }
  return out;
}

export function insertRun(db: Database, taskId: number, agent: string): number {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO runs (task_id, agent, started_at, status) VALUES (?, ?, ?, 'running')`,
    )
    .run(taskId, agent, now);
  return Number(info.lastInsertRowid);
}

export function finishRun(db: Database, runId: number, status: string, summary?: string): void {
  const now = new Date().toISOString();
  db
    .prepare(
      `UPDATE runs SET ended_at = ?, status = ?, output_summary = ? WHERE id = ?`,
    )
    .run(now, status, summary ?? null, runId);
}

/**
 * Runs whose `started_at >= sinceIso`. Used by `relay digest` to group by
 * agent and total duration. ended_at can be null (still running); callers
 * decide how to handle that.
 */
export function runsSince(
  db: Database,
  sinceIso: string,
): Array<{
  task_id: number;
  agent: string;
  started_at: string;
  ended_at: string | null;
  status: string;
}> {
  const rows = db
    .prepare(
      `SELECT task_id, agent, started_at, ended_at, status
         FROM runs
        WHERE started_at >= ?
        ORDER BY started_at ASC`,
    )
    .all(sinceIso) as Array<{
    task_id: number;
    agent: string;
    started_at: string;
    ended_at: string | null;
    status: string;
  }>;
  return rows;
}

// --- sync_history ---------------------------------------------------------

export function recordSyncHistory(
  db: Database,
  input: {
    started_at: string;
    ended_at: string;
    adapter: string;
    status: "ok" | "error" | "skipped";
    count: number;
    error?: string | null;
  },
): number {
  ensureSyncHistorySchema(db);
  const info = db
    .prepare(
      `INSERT INTO sync_history (started_at, ended_at, adapter, status, count, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.started_at,
      input.ended_at,
      input.adapter,
      input.status,
      input.count,
      input.error ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function latestSyncPerAdapter(db: Database): LatestSyncRow[] {
  ensureSyncHistorySchema(db);
  const rows = db
    .prepare(
      `SELECT h.adapter, h.started_at, h.ended_at, h.status, h.count, h.error
         FROM sync_history h
        WHERE NOT EXISTS (
          SELECT 1
            FROM sync_history newer
           WHERE newer.adapter = h.adapter
             AND (
               newer.started_at > h.started_at
               OR (newer.started_at = h.started_at AND newer.id > h.id)
             )
        )
        ORDER BY h.adapter ASC`,
    )
    .all() as LatestSyncRow[];
  return rows;
}

export function listSyncHistory(
  db: Database,
  filters: { adapter?: string; limit?: number } = {},
): SyncHistoryRow[] {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  ensureSyncHistorySchema(db);
  const rows = filters.adapter
    ? db
        .prepare(
          `SELECT id, started_at, ended_at, adapter, status, count, error
             FROM sync_history
            WHERE adapter = ?
            ORDER BY started_at DESC, id DESC
            LIMIT ?`,
        )
        .all(filters.adapter, limit)
    : db
        .prepare(
          `SELECT id, started_at, ended_at, adapter, status, count, error
             FROM sync_history
            ORDER BY started_at DESC, id DESC
            LIMIT ?`,
        )
        .all(limit);
  return rows as SyncHistoryRow[];
}

/**
 * Returns the ISO 8601 `ended_at` timestamp of the most recent successful
 * sync for the given adapter, or `null` if no successful sync exists yet.
 */
export function lastSuccessfulSyncEndedAt(db: Database, adapter: string): string | null {
  ensureSyncHistorySchema(db);
  const row = db
    .prepare(
      `SELECT ended_at FROM sync_history
        WHERE adapter = ? AND status = 'ok'
        ORDER BY ended_at DESC
        LIMIT 1`,
    )
    .get(adapter) as { ended_at: string } | undefined;
  return row?.ended_at ?? null;
}

// --- queue_items ----------------------------------------------------------

export function addQueueItem(db: Database, taskId: number): number | null {
  ensureQueueSchema(db);
  const taskRow = db.prepare(`SELECT 1 FROM tasks WHERE id = ? LIMIT 1`).get(taskId);
  if (!taskRow) return null;
  const info = db
    .prepare(`INSERT INTO queue_items (task_id, added_at) VALUES (?, ?)`)
    .run(taskId, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function listQueueItems(db: Database): QueueItem[] {
  ensureQueueSchema(db);
  const rows = db
    .prepare(
      `SELECT q.id, q.task_id, t.repo, t.prompt, q.added_at
         FROM queue_items q
         JOIN tasks t ON t.id = q.task_id
        ORDER BY q.added_at ASC, q.id ASC`,
    )
    .all() as Array<{
    id: number;
    task_id: number;
    repo: string;
    prompt: string | null;
    added_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    task_id: row.task_id,
    repo: row.repo,
    prompt: row.prompt ?? null,
    added_at: row.added_at,
  }));
}

export function deleteQueueItem(db: Database, id: number): boolean {
  ensureQueueSchema(db);
  const info = db.prepare(`DELETE FROM queue_items WHERE id = ?`).run(id);
  return Number(info.changes) > 0;
}

export function clearQueue(db: Database): void {
  ensureQueueSchema(db);
  db.prepare(`DELETE FROM queue_items`).run();
}

// --- undo_log -------------------------------------------------------------

export function recordUndo(
  db: Database,
  input: { op_kind: string; payload: unknown; inverse: unknown },
): number {
  ensureUndoSchema(db);
  const info = db
    .prepare(
      `INSERT INTO undo_log (op_kind, payload, inverse, created_at, status)
       VALUES (?, ?, ?, ?, 'active')`,
    )
    .run(
      input.op_kind,
      JSON.stringify(input.payload),
      JSON.stringify(input.inverse),
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

export function listUndo(db: Database, limit = 20): UndoLogRow[] {
  ensureUndoSchema(db);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return db
    .prepare(
      `SELECT id, op_kind, payload, inverse, created_at, status
         FROM undo_log
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .all(safeLimit) as UndoLogRow[];
}

export function latestUndo(db: Database, status: UndoLogRow["status"]): UndoLogRow | null {
  ensureUndoSchema(db);
  const row = db
    .prepare(
      `SELECT id, op_kind, payload, inverse, created_at, status
         FROM undo_log
        WHERE status = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    )
    .get(status) as UndoLogRow | undefined;
  return row ?? null;
}

export function markUndoStatus(db: Database, id: number, status: UndoLogRow["status"]): boolean {
  ensureUndoSchema(db);
  const info = db.prepare(`UPDATE undo_log SET status = ? WHERE id = ?`).run(status, id);
  return Number(info.changes) > 0;
}

export function pruneUndoOlderThan(db: Database, days: number): number {
  ensureUndoSchema(db);
  const safeDays = Math.max(1, Math.trunc(days));
  const info = db
    .prepare(`DELETE FROM undo_log WHERE created_at < datetime('now', ?)`)
    .run(`-${safeDays} days`);
  return Number(info.changes);
}
