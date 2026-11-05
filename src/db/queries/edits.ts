// User-driven task edits (schema v11): field updates that lock the edited
// fields against adapter re-syncs, snooze auto-wake, and per-task run
// history. Extracted next to `tasks.ts` so the ingest path can stay focused
// on adapter writes.

import type { Database } from "bun:sqlite";
import type { EditableField, TaskEdit } from "../../types.js";
import { EDITABLE_FIELDS } from "../../types.js";
import { parseOverrides } from "../internal.js";

/** Before/after image of the edited fields, stored in undo_log. */
export interface TaskEditSnapshot {
  id: number;
  fields: TaskEdit;
  user_overrides: string[];
}

const COLUMN_OF: Record<EditableField, string> = {
  title: "title",
  body: "body",
  priority: "priority",
  prompt: "prompt",
  files: "files",
  due_at: "due_at",
  wait_on: "wait_on",
  repo: "repo",
};

function encode(field: EditableField, value: unknown): unknown {
  if (field === "files") {
    const files = Array.isArray(value) ? value : [];
    return files.length ? JSON.stringify(files) : null;
  }
  return value ?? null;
}

function decodeRow(row: Record<string, unknown>): TaskEdit {
  return {
    title: row.title as string,
    body: (row.body as string) ?? "",
    priority: (row.priority as number) ?? 50,
    prompt: (row.prompt as string | null) ?? null,
    files: row.files ? (JSON.parse(row.files as string) as string[]) : [],
    due_at: (row.due_at as string | null) ?? null,
    wait_on: (row.wait_on as TaskEdit["wait_on"]) ?? "self",
    repo: row.repo as string,
  };
}

function sameValue(field: EditableField, a: unknown, b: unknown): boolean {
  if (field === "files") return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? null) === (b ?? null);
}

/**
 * Apply `patch` to task `id`, add the changed fields to user_overrides
 * (unless `lock` is false), and drop the fields in `unlock` from the
 * override set so the next sync restores upstream values.
 *
 * Returns before/after snapshots of exactly the touched fields, or null when
 * the task does not exist. `changed` lists the fields whose value differed;
 * when it is empty and `overridesChanged` is false nothing was written, so
 * callers can skip a no-op undo entry.
 */
export function editTask(
  db: Database,
  id: number,
  patch: TaskEdit,
  opts: { lock?: boolean; unlock?: EditableField[] } = {},
): { before: TaskEditSnapshot; after: TaskEditSnapshot; changed: EditableField[]; overridesChanged: boolean } | null {
  const lock = opts.lock ?? true;
  const unlock = opts.unlock ?? [];
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;

  const current = decodeRow(row);
  const overridesBefore = parseOverrides(row.user_overrides);
  const changed: EditableField[] = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue;
    if (!sameValue(field, current[field], patch[field])) changed.push(field);
  }

  const overrides = new Set(overridesBefore);
  if (lock) for (const field of changed) overrides.add(field);
  for (const field of unlock) overrides.delete(field);
  const overridesAfter = EDITABLE_FIELDS.filter((f) => overrides.has(f));
  const overridesChanged =
    JSON.stringify(overridesAfter) !== JSON.stringify(EDITABLE_FIELDS.filter((f) => overridesBefore.includes(f)));

  const touched = [...new Set<EditableField>([...changed, ...unlock])];
  const beforeFields: TaskEdit = {};
  const afterFields: TaskEdit = {};
  for (const field of touched) {
    (beforeFields as Record<string, unknown>)[field] = current[field];
    (afterFields as Record<string, unknown>)[field] = field in patch ? patch[field] : current[field];
  }

  if (changed.length > 0 || overridesChanged) {
    const sets = changed.map((field) => `${COLUMN_OF[field]} = ?`);
    const values = changed.map((field) => encode(field, patch[field]));
    sets.push("user_overrides = ?");
    values.push(overridesAfter.length ? JSON.stringify(overridesAfter) : null);
    // Only real field changes count as "touching" the task (priority decay,
    // staleness); toggling a lock alone does not.
    if (changed.length > 0) {
      sets.push("updated_at = ?");
      values.push(new Date().toISOString());
    }
    db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(
      ...(values as Array<string | number | null>),
      id,
    );
  }

  return {
    before: { id, fields: beforeFields, user_overrides: overridesBefore },
    after: { id, fields: afterFields, user_overrides: overridesAfter },
    changed,
    overridesChanged,
  };
}

/** Restore a snapshot written by {@link editTask} (undo / redo). */
export function restoreTaskEdit(db: Database, snapshot: TaskEditSnapshot): boolean {
  const fields = EDITABLE_FIELDS.filter((f) => f in snapshot.fields);
  const sets = fields.map((field) => `${COLUMN_OF[field]} = ?`);
  const values: Array<string | number | null> = fields.map(
    (field) => encode(field, snapshot.fields[field]) as string | number | null,
  );
  sets.push("user_overrides = ?", "updated_at = ?");
  values.push(
    snapshot.user_overrides.length ? JSON.stringify(snapshot.user_overrides) : null,
    new Date().toISOString(),
  );
  const info = db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values, snapshot.id);
  return Number(info.changes) > 0;
}

/**
 * Re-open snoozed tasks whose snooze-until (stored in due_at) has passed.
 * Indefinite snoozes (due_at NULL) stay snoozed. Returns the woken ids so
 * callers can surface "N tasks are back".
 */
export function wakeSnoozed(db: Database, now: Date = new Date()): number[] {
  const nowIso = now.toISOString();
  const rows = db
    .prepare(
      `SELECT id FROM tasks
        WHERE status = 'snoozed' AND due_at IS NOT NULL AND due_at <= ?`,
    )
    .all(nowIso) as Array<{ id: number }>;
  if (rows.length === 0) return [];
  db.prepare(
    `UPDATE tasks SET status = 'open', updated_at = ?, closed_at = NULL
      WHERE status = 'snoozed' AND due_at IS NOT NULL AND due_at <= ?`,
  ).run(nowIso, nowIso);
  return rows.map((r) => r.id);
}

/**
 * Snooze one task. With `until`, due_at becomes the wake time; without it
 * the snooze is indefinite, and a due_at already in the past is cleared so
 * auto-wake does not immediately undo the snooze.
 */
export function snoozeTask(db: Database, id: number, until: string | null, now: Date = new Date()): void {
  const nowIso = now.toISOString();
  if (until) {
    db.prepare(
      `UPDATE tasks SET status = 'snoozed', due_at = ?, updated_at = ?, closed_at = NULL WHERE id = ?`,
    ).run(until, nowIso, id);
    return;
  }
  db.prepare(
    `UPDATE tasks
        SET status = 'snoozed',
            due_at = CASE WHEN due_at IS NOT NULL AND due_at <= ? THEN NULL ELSE due_at END,
            updated_at = ?, closed_at = NULL
      WHERE id = ?`,
  ).run(nowIso, nowIso, id);
}

export interface TaskRunRow {
  id: number;
  agent: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  output_summary: string | null;
}

/** Newest-first agent runs for one task (`relay run` history). */
export function listRunsForTask(db: Database, taskId: number, limit = 20): TaskRunRow[] {
  return db
    .prepare(
      `SELECT id, agent, started_at, ended_at, status, output_summary
         FROM runs WHERE task_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT ?`,
    )
    .all(taskId, limit) as TaskRunRow[];
}
