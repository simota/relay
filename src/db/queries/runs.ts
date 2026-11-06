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
import { parseRunChanges, type RunChanges } from "../../executor/changes.js";

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

/** Store what a run changed (schema v13); see src/executor/changes.ts. */
export function recordRunChanges(db: Database, runId: number, changes: RunChanges): void {
  db.prepare(`UPDATE runs SET head_before = ?, head_after = ?, changes = ? WHERE id = ?`).run(
    changes.head_before,
    changes.head_after,
    JSON.stringify({ commits: changes.commits, files: changes.files, more: changes.more }),
    runId,
  );
}

export interface RunVerification {
  status: "passed" | "failed";
  command: string;
  output: string | null;
}

/**
 * Store a verify-gate result (schema v15). A failed verification also
 * turns the run itself into a failure, with `summary` explaining why, so
 * every consumer of runs.status (retry-failed, insights, standup) treats
 * "the agent exited 0 but the tests are red" as the failure it is.
 */
export function recordRunVerification(db: Database, runId: number, verify: RunVerification, summary?: string): void {
  db.prepare(`UPDATE runs SET verify_status = ?, verify_command = ?, verify_output = ? WHERE id = ?`).run(
    verify.status,
    verify.command,
    verify.output,
    runId,
  );
  if (verify.status === "failed") {
    db.prepare(`UPDATE runs SET status = 'failed', output_summary = COALESCE(?, output_summary) WHERE id = ?`).run(
      summary ?? null,
      runId,
    );
  }
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
//
// Queue order is `added_at ASC, id ASC`. Re-ordering rewrites added_at
// (front = earliest - 1ms, swap = exchange timestamps) so no schema change
// is needed. A task is queued at most once: re-adding returns the
// existing item instead of creating a duplicate that would run twice.

export function addQueueItem(
  db: Database,
  taskId: number,
  opts: { front?: boolean } = {},
): number | null {
  ensureQueueSchema(db);
  const taskRow = db.prepare(`SELECT 1 FROM tasks WHERE id = ? LIMIT 1`).get(taskId);
  if (!taskRow) return null;
  const existing = db
    .prepare(`SELECT id FROM queue_items WHERE task_id = ? ORDER BY id ASC LIMIT 1`)
    .get(taskId) as { id: number } | undefined;
  if (existing) {
    if (opts.front) moveQueueItemToFront(db, existing.id);
    return existing.id;
  }
  const addedAt = opts.front ? frontTimestamp(db) : new Date().toISOString();
  const info = db
    .prepare(`INSERT INTO queue_items (task_id, added_at) VALUES (?, ?)`)
    .run(taskId, addedAt);
  return Number(info.lastInsertRowid);
}

function frontTimestamp(db: Database): string {
  const row = db.prepare(`SELECT MIN(added_at) AS first FROM queue_items`).get() as
    | { first: string | null }
    | undefined;
  const first = row?.first ? Date.parse(row.first) : NaN;
  const base = Number.isFinite(first) ? first - 1 : Date.now();
  return new Date(base).toISOString();
}

export function moveQueueItemToFront(db: Database, id: number): boolean {
  ensureQueueSchema(db);
  const info = db
    .prepare(`UPDATE queue_items SET added_at = ? WHERE id = ?`)
    .run(frontTimestamp(db), id);
  return Number(info.changes) > 0;
}

/**
 * Swap an item with its neighbour ("up" = earlier, "down" = later).
 * Returns false when the item is missing or already at that end.
 */
export function moveQueueItem(db: Database, id: number, direction: "up" | "down"): boolean {
  ensureQueueSchema(db);
  const ordered = db
    .prepare(`SELECT id, added_at FROM queue_items ORDER BY added_at ASC, id ASC`)
    .all() as Array<{ id: number; added_at: string }>;
  const index = ordered.findIndex((row) => row.id === id);
  if (index < 0) return false;
  const otherIndex = direction === "up" ? index - 1 : index + 1;
  const self = ordered[index];
  const other = ordered[otherIndex];
  if (!self || !other) return false;
  // Equal timestamps (bulk adds in the same ms) can't be swapped by
  // exchanging them, so renumber the whole queue 1ms apart first.
  const tx = db.transaction(() => {
    const update = db.prepare(`UPDATE queue_items SET added_at = ? WHERE id = ?`);
    const base = Date.parse(ordered[0]?.added_at ?? "") || Date.now();
    const ids = ordered.map((row) => row.id);
    ids[index] = other.id;
    ids[otherIndex] = self.id;
    ids.forEach((itemId, i) => update.run(new Date(base + i).toISOString(), itemId));
  });
  tx();
  return true;
}

export function listQueueItems(db: Database): QueueItem[] {
  ensureQueueSchema(db);
  const rows = db
    .prepare(
      `SELECT q.id, q.task_id, t.repo, t.prompt, q.added_at, t.title, t.assignee, t.status
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
    title: string;
    assignee: string;
    status: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    task_id: row.task_id,
    repo: row.repo,
    prompt: row.prompt ?? null,
    added_at: row.added_at,
    title: row.title,
    assignee: row.assignee,
    status: row.status,
  }));
}

export function deleteQueueItem(db: Database, id: number): boolean {
  ensureQueueSchema(db);
  const info = db.prepare(`DELETE FROM queue_items WHERE id = ?`).run(id);
  return Number(info.changes) > 0;
}

export function deleteQueueItemsForTask(db: Database, taskId: number): number {
  ensureQueueSchema(db);
  const info = db.prepare(`DELETE FROM queue_items WHERE task_id = ?`).run(taskId);
  return Number(info.changes);
}

export function clearQueue(db: Database): void {
  ensureQueueSchema(db);
  db.prepare(`DELETE FROM queue_items`).run();
}

// --- runs listing -----------------------------------------------------------

export interface RunListRow {
  id: number;
  task_id: number;
  agent: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  output_summary: string | null;
  task_title: string;
  repo: string;
  /** What the run changed in the repo (schema v13); null when unknown. */
  changes: RunChanges | null;
  /** Verify gate (schema v15): 'passed' / 'failed' / null = not verified. */
  verify_status: string | null;
  verify_command: string | null;
  verify_output: string | null;
}

function withChanges<T extends Record<string, unknown>>(row: T): Omit<T, "head_before" | "head_after"> & { changes: RunChanges | null } {
  const { head_before, head_after, changes, ...rest } = row as T & { head_before?: unknown; head_after?: unknown; changes?: unknown };
  return { ...(rest as Omit<T, "head_before" | "head_after">), changes: parseRunChanges(changes, head_before, head_after) };
}

/** Recent runs across all tasks, newest first, for `relay runs` / GET /api/runs. */
export function listRuns(
  db: Database,
  filters: { status?: string; agent?: string; taskId?: number; limit?: number } = {},
): RunListRow[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filters.status) {
    where.push("r.status = ?");
    params.push(filters.status);
  }
  if (filters.agent) {
    where.push("r.agent = ?");
    params.push(filters.agent);
  }
  if (filters.taskId) {
    where.push("r.task_id = ?");
    params.push(filters.taskId);
  }
  const limit = Math.min(Math.max(Math.round(filters.limit ?? 30), 1), 500);
  params.push(limit);
  return db
    .prepare(
      `SELECT r.id, r.task_id, r.agent, r.started_at, r.ended_at, r.status, r.output_summary,
              r.head_before, r.head_after, r.changes,
              r.verify_status, r.verify_command, r.verify_output,
              t.title AS task_title, t.repo
         FROM runs r
         JOIN tasks t ON t.id = r.task_id
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY r.started_at DESC, r.id DESC
        LIMIT ?`,
    )
    .all(...params)
    .map((row) => withChanges(row as Record<string, unknown>)) as unknown as RunListRow[];
}

/**
 * Tasks whose most recent run failed or was interrupted and that are still
 * not done — the "retry what broke overnight" set for `relay queue add
 * --failed` and POST /api/queue/retry-failed. `sinceIso` limits it to runs
 * that ended after that instant. Ordered oldest failure first so a retry
 * pass replays them in the order they originally ran.
 */
export function failedTaskIds(db: Database, sinceIso?: string): number[] {
  const rows = db
    .prepare(
      `SELECT r.task_id
         FROM runs r
         JOIN tasks t ON t.id = r.task_id
        WHERE r.status IN ('failed', 'interrupted')
          AND t.status != 'done'
          AND (? IS NULL OR COALESCE(r.ended_at, r.started_at) >= ?)
          AND NOT EXISTS (
            SELECT 1 FROM runs n
             WHERE n.task_id = r.task_id
               AND (n.started_at > r.started_at OR (n.started_at = r.started_at AND n.id > r.id))
          )
        ORDER BY r.started_at ASC, r.id ASC`,
    )
    .all(sinceIso ?? null, sinceIso ?? null) as Array<{ task_id: number }>;
  return rows.map((r) => r.task_id);
}

export function getRun(db: Database, id: number): RunListRow | null {
  const row = db
    .prepare(
      `SELECT r.id, r.task_id, r.agent, r.started_at, r.ended_at, r.status, r.output_summary,
              r.head_before, r.head_after, r.changes,
              r.verify_status, r.verify_command, r.verify_output,
              t.title AS task_title, t.repo
         FROM runs r
         JOIN tasks t ON t.id = r.task_id
        WHERE r.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? (withChanges(row) as unknown as RunListRow) : null;
}

// --- undo_log -------------------------------------------------------------

export function recordUndo(
  db: Database,
  input: { op_kind: string; payload: unknown; inverse: unknown },
): number {
  ensureUndoSchema(db);
  // A new action invalidates the redo stack: replaying an `undone` entry
  // recorded before this action would silently overwrite its effect.
  const record = db.transaction(() => {
    db.prepare(`DELETE FROM undo_log WHERE status = 'undone'`).run();
    return db
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
  });
  return Number(record().lastInsertRowid);
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
  // Undo pops the newest active entry. Undone entries always sit above every
  // active one (recordUndo clears them on a new action) and were undone
  // newest-first, so the one undone most recently — the next to redo — is
  // the oldest of them.
  const order = status === "undone" ? "ASC" : "DESC";
  const row = db
    .prepare(
      `SELECT id, op_kind, payload, inverse, created_at, status
         FROM undo_log
        WHERE status = ?
        ORDER BY created_at ${order}, id ${order}
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
    .prepare(`DELETE FROM undo_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`)
    .run(`-${safeDays} days`);
  return Number(info.changes);
}
