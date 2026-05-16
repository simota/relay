// Adapter ingest writes — UPSERT batches of TaskInput/SnapshotRow with
// idempotent (source_type, source_id) keying. Extracted from `client.ts`.

import type { Database } from "bun:sqlite";
import type { TaskInput } from "../../types.js";
import type { SnapshotRow, UpsertResult } from "../types.js";
import { serialize } from "../internal.js";

export function classifyTasks(
  db: Database,
  tasks: TaskInput[],
): UpsertResult & { sampleSourceIds: string[] } {
  const result = { inserted: 0, updated: 0, unchanged: 0, sampleSourceIds: [] as string[] };
  if (tasks.length === 0) return result;
  const findStmt = db.prepare(
    `SELECT title, body, priority, session_id, files, wait_on
       FROM tasks WHERE source_type = ? AND source_id = ?`,
  );
  const now = new Date().toISOString();
  for (const t of tasks) {
    const existing = findStmt.get(t.source_type, t.source_id) as
      | {
          title: string;
          body: string;
          priority: number;
          session_id: string | null;
          files: string | null;
          wait_on: string;
        }
      | undefined;
    if (!existing) {
      result.inserted++;
    } else {
      const row = serialize(t, now);
      const changed =
        existing.title !== row.title ||
        existing.body !== row.body ||
        existing.priority !== row.priority ||
        (existing.session_id ?? null) !== (row.session_id ?? null) ||
        (existing.files ?? null) !== (row.files ?? null) ||
        existing.wait_on !== row.wait_on;
      if (changed) result.updated++;
      else result.unchanged++;
    }
    if (result.sampleSourceIds.length < 5) {
      result.sampleSourceIds.push(t.source_id);
    }
  }
  return result;
}

export function upsertTasks(db: Database, tasks: TaskInput[]): UpsertResult {
  const now = new Date().toISOString();
  const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

  const findStmt = db.prepare(
    `SELECT id, title, body, priority, session_id, files, wait_on
       FROM tasks WHERE source_type = ? AND source_id = ?`,
  );
  const insertStmt = db.prepare(`
    INSERT INTO tasks (
      source_type, source_id, repo, title, body, status, assignee,
      priority, prompt, files, context_hash, session_id, due_at,
      wait_on, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE tasks SET
      repo = ?, title = ?, body = ?, priority = ?,
      prompt = ?, files = ?, session_id = ?, due_at = ?,
      wait_on = ?, updated_at = ?
    WHERE id = ?
  `);

  const tx = db.transaction((batch: TaskInput[]) => {
    for (const t of batch) {
      const row = serialize(t, now);
      const existing = findStmt.get(t.source_type, t.source_id) as
        | {
            id: number;
            title: string;
            body: string;
            priority: number;
            session_id: string | null;
            files: string | null;
            wait_on: string;
          }
        | undefined;

      if (!existing) {
        insertStmt.run(
          row.source_type,
          row.source_id,
          row.repo,
          row.title,
          row.body,
          row.status,
          row.assignee,
          row.priority,
          row.prompt,
          row.files,
          row.context_hash,
          row.session_id,
          row.due_at,
          row.wait_on,
          row.created_at,
          row.updated_at,
        );
        result.inserted++;
        continue;
      }

      const changed =
        existing.title !== row.title ||
        existing.body !== row.body ||
        existing.priority !== row.priority ||
        (existing.session_id ?? "") !== (row.session_id ?? "") ||
        (existing.files ?? "") !== (row.files ?? "") ||
        existing.wait_on !== row.wait_on;

      if (changed) {
        updateStmt.run(
          row.repo,
          row.title,
          row.body,
          row.priority,
          row.prompt,
          row.files,
          row.session_id,
          row.due_at,
          row.wait_on,
          row.updated_at,
          existing.id,
        );
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
  });
  tx(tasks);
  return result;
}

// Snapshot import: preserves source_type, source_id, created_at, updated_at,
// and uses updated_at-based last-writer-wins for conflicts. Designed for
// cross-machine snapshot export → import (#8 / #9), not for adapter ingest.
export function upsertSnapshot(
  db: Database,
  rows: SnapshotRow[],
): { inserted: number; updated: number; conflicted: number } {
  const result = { inserted: 0, updated: 0, conflicted: 0 };

  const findStmt = db.prepare(
    `SELECT id, updated_at FROM tasks WHERE source_type = ? AND source_id = ?`,
  );
  const insertStmt = db.prepare(`
    INSERT INTO tasks (
      source_type, source_id, repo, title, body, status, assignee,
      priority, prompt, files, context_hash, session_id, due_at,
      wait_on, created_at, updated_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE tasks SET
      repo = ?, title = ?, body = ?, status = ?, assignee = ?, priority = ?,
      prompt = ?, files = ?, session_id = ?, due_at = ?, wait_on = ?,
      updated_at = ?, closed_at = ?
    WHERE id = ?
  `);

  const tx = db.transaction((batch: SnapshotRow[]) => {
    for (const r of batch) {
      const existing = findStmt.get(r.source_type, r.source_id) as
        | { id: number; updated_at: string }
        | undefined;
      if (!existing) {
        insertStmt.run(
          r.source_type,
          r.source_id,
          r.repo,
          r.title,
          r.body,
          r.status,
          r.assignee,
          r.priority,
          r.prompt,
          JSON.stringify(r.files),
          r.context_hash,
          r.session_id,
          r.due_at,
          r.wait_on || "self",
          r.created_at,
          r.updated_at,
          r.closed_at,
        );
        result.inserted++;
        continue;
      }
      if (Date.parse(r.updated_at) > Date.parse(existing.updated_at)) {
        updateStmt.run(
          r.repo,
          r.title,
          r.body,
          r.status,
          r.assignee,
          r.priority,
          r.prompt,
          JSON.stringify(r.files),
          r.session_id,
          r.due_at,
          r.wait_on || "self",
          r.updated_at,
          r.closed_at,
          existing.id,
        );
        result.updated++;
      } else {
        result.conflicted++;
      }
    }
  });
  tx(rows);
  return result;
}
