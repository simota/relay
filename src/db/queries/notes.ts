// Task notes (schema v14): a user-written, append-only progress log per task.
//
// Notes are the "feedback channel" of the AI job queue: when an agent run
// fails or goes the wrong way, the user writes what to try next, and the
// next `relay run` / `relay queue run` puts the notes into the agent prompt
// (executor/index.ts `formatNotes`). Like tags and deps, notes are
// user-owned — adapter ingest never touches them, so they survive re-syncs.

import type { Database } from "bun:sqlite";

/** Hard cap so a pasted log can't balloon the DB or the agent prompt. */
export const MAX_NOTE_LENGTH = 4000;

export interface TaskNote {
  id: number;
  task_id: number;
  body: string;
  created_at: string;
}

/** Trim + validate a note body. Returns null when empty after trimming. */
export function normalizeNoteBody(raw: string): string | null {
  const body = raw.replace(/\r\n?/g, "\n").trim();
  if (body.length === 0) return null;
  return body.length > MAX_NOTE_LENGTH ? body.slice(0, MAX_NOTE_LENGTH) : body;
}

export function addNote(db: Database, taskId: number, body: string, now: Date = new Date()): TaskNote | null {
  const exists = db.prepare(`SELECT 1 FROM tasks WHERE id = ?`).get(taskId);
  if (!exists) return null;
  const createdAt = now.toISOString();
  const res = db
    .prepare(`INSERT INTO task_notes (task_id, body, created_at) VALUES (?, ?, ?)`)
    .run(taskId, body, createdAt);
  // A note is activity on the task: bump updated_at so priority decay and
  // the stale sweeps treat a task the user is actively steering as fresh.
  db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(createdAt, taskId);
  return { id: Number(res.lastInsertRowid), task_id: taskId, body, created_at: createdAt };
}

/** Oldest first — the order a reader (or an agent) follows the story in. */
export function listNotes(db: Database, taskId: number): TaskNote[] {
  return db
    .prepare(`SELECT id, task_id, body, created_at FROM task_notes WHERE task_id = ? ORDER BY created_at ASC, id ASC`)
    .all(taskId) as TaskNote[];
}

export function getNote(db: Database, noteId: number): TaskNote | null {
  return (
    (db.prepare(`SELECT id, task_id, body, created_at FROM task_notes WHERE id = ?`).get(noteId) as
      | TaskNote
      | undefined) ?? null
  );
}

/** Delete a note; returns the removed row (for undo) or null. */
export function deleteNote(db: Database, noteId: number): TaskNote | null {
  const note = getNote(db, noteId);
  if (!note) return null;
  db.prepare(`DELETE FROM task_notes WHERE id = ?`).run(noteId);
  return note;
}

/**
 * Re-insert notes with their original ids (undo of a delete / redo of an
 * add). Notes whose task was deleted since are skipped. Returns the count
 * actually restored.
 */
export function restoreNotes(db: Database, notes: readonly TaskNote[]): number {
  let count = 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO task_notes (id, task_id, body, created_at)
     SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?)`,
  );
  db.transaction(() => {
    for (const n of notes) {
      const res = insert.run(n.id, n.task_id, n.body, n.created_at, n.task_id);
      if (res.changes > 0) count++;
    }
  })();
  return count;
}

export function deleteNotesByIds(db: Database, ids: readonly number[]): number {
  if (ids.length === 0) return 0;
  const res = db
    .prepare(`DELETE FROM task_notes WHERE id IN (${ids.map(() => "?").join(",")})`)
    .run(...ids);
  return res.changes;
}

/** Note counts for many tasks at once (list views show a 📝 badge). */
export function noteCounts(db: Database, taskIds: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (taskIds.length === 0) return out;
  // Chunk to stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < taskIds.length; i += 500) {
    const chunk = taskIds.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT task_id, COUNT(*) AS n FROM task_notes WHERE task_id IN (${chunk.map(() => "?").join(",")}) GROUP BY task_id`,
      )
      .all(...chunk) as Array<{ task_id: number; n: number }>;
    for (const r of rows) out.set(r.task_id, r.n);
  }
  return out;
}

/** Every note, for snapshot export. */
export function listAllNotes(db: Database): TaskNote[] {
  return db
    .prepare(`SELECT id, task_id, body, created_at FROM task_notes ORDER BY task_id, created_at, id`)
    .all() as TaskNote[];
}

/**
 * Import a note unless an identical (task, body, created_at) note already
 * exists — makes re-importing the same snapshot idempotent.
 */
export function importNote(db: Database, taskId: number, body: string, createdAt: string): boolean {
  const dup = db
    .prepare(`SELECT 1 FROM task_notes WHERE task_id = ? AND body = ? AND created_at = ?`)
    .get(taskId, body, createdAt);
  if (dup) return false;
  db.prepare(`INSERT INTO task_notes (task_id, body, created_at) VALUES (?, ?, ?)`).run(taskId, body, createdAt);
  return true;
}
