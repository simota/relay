// Tags and task dependencies (schema v12).
//
// Tags live in `tasks.tags` (JSON array) so every `SELECT * FROM tasks`
// hydrates them for free; filters go through `json_each`. Dependencies live
// in `task_deps` ("task_id is blocked by depends_on_id"). Both are
// user-owned: adapter ingest never writes them, so they survive re-syncs.

import type { Database } from "bun:sqlite";
import type { Task } from "../../types.js";
import { hydrate, parseOverrides } from "../internal.js";
import { MAX_TAGS_PER_TASK, normalizeTags } from "../../lib/tags.js";

export { MAX_TAGS_PER_TASK, normalizeTag, normalizeTags } from "../../lib/tags.js";

function tagsJson(tags: readonly string[]): string | null {
  return tags.length > 0 ? JSON.stringify(tags) : null;
}

export interface TagChange {
  id: number;
  before: string[];
  after: string[];
}

/**
 * Replace a task's tags. Returns null when the task does not exist, and a
 * change with `before === after` content when nothing changed (no write).
 */
export function setTags(db: Database, id: number, tags: readonly string[]): TagChange | null {
  const row = db.prepare(`SELECT tags FROM tasks WHERE id = ?`).get(id) as { tags: string | null } | undefined;
  if (!row) return null;
  const before = parseOverrides(row.tags);
  const after = normalizeTags(tags).tags.slice(0, MAX_TAGS_PER_TASK);
  if (sameList(before, after)) return { id, before, after: before };
  db.prepare(`UPDATE tasks SET tags = ?, updated_at = ? WHERE id = ?`).run(
    tagsJson(after),
    new Date().toISOString(),
    id,
  );
  return { id, before, after };
}

/**
 * Add and/or remove tags on many tasks in one transaction. Only tasks whose
 * tag set actually changed are returned (and written).
 */
export function bulkEditTags(
  db: Database,
  ids: readonly number[],
  edit: { add?: readonly string[]; remove?: readonly string[] },
): TagChange[] {
  const add = normalizeTags(edit.add ?? []).tags;
  const remove = new Set(normalizeTags(edit.remove ?? []).tags);
  const changes: TagChange[] = [];
  const read = db.prepare(`SELECT tags FROM tasks WHERE id = ?`);
  const write = db.prepare(`UPDATE tasks SET tags = ?, updated_at = ? WHERE id = ?`);
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const id of new Set(ids)) {
      const row = read.get(id) as { tags: string | null } | undefined;
      if (!row) continue;
      const before = parseOverrides(row.tags);
      const next = before.filter((tag) => !remove.has(tag));
      for (const tag of add) if (!next.includes(tag) && !remove.has(tag)) next.push(tag);
      const after = next.slice(0, MAX_TAGS_PER_TASK);
      if (sameList(before, after)) continue;
      write.run(tagsJson(after), now, id);
      changes.push({ id, before, after });
    }
  })();
  return changes;
}

/** Restore exact tag lists (undo / redo). Returns rows written. */
export function applyTagLists(db: Database, lists: ReadonlyArray<{ id: number; tags: string[] }>): number {
  const write = db.prepare(`UPDATE tasks SET tags = ?, updated_at = ? WHERE id = ?`);
  const now = new Date().toISOString();
  let count = 0;
  db.transaction(() => {
    for (const { id, tags } of lists) count += write.run(tagsJson(tags), now, id).changes;
  })();
  return count;
}

export interface TagCount {
  tag: string;
  /** Tasks carrying the tag that are not done. */
  open: number;
  total: number;
}

/** Every tag in use with open / total task counts, most-used first. */
export function listTagCounts(db: Database): TagCount[] {
  return db
    .prepare(
      `SELECT j.value AS tag,
              SUM(CASE WHEN t.status != 'done' THEN 1 ELSE 0 END) AS open,
              COUNT(*) AS total
         FROM tasks t, json_each(t.tags) j
        WHERE t.tags IS NOT NULL
        GROUP BY j.value
        ORDER BY open DESC, total DESC, tag ASC`,
    )
    .all() as TagCount[];
}

/** SQL fragment matching tasks that carry `tag` (bind the tag once). */
export const TAG_FILTER_SQL = `(tags IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(tasks.tags) WHERE value = ?))`;

// --- Dependencies -----------------------------------------------------

/**
 * SQL fragment: the current `tasks` row has at least one blocker that is
 * not done. Used by Today / standup / counts to tell dependency-blocked
 * work apart from work that can start now.
 */
export const HAS_OPEN_BLOCKER_SQL = `EXISTS (
  SELECT 1 FROM task_deps d JOIN tasks b ON b.id = d.depends_on_id
   WHERE d.task_id = tasks.id AND b.status != 'done'
)`;

/**
 * Same predicate as HAS_OPEN_BLOCKER_SQL, as an uncorrelated `IN` list, for
 * the positive "only blocked tasks" filter (`relay ls --blocked`,
 * `/api/tasks?blocked=1`). Few tasks match that filter, so the correlated
 * form made SQLite walk every candidate row (via idx_tasks_priority) and
 * run the subquery per row; here the set of blocked ids is built once and
 * rows are fetched by rowid (20k tasks / 50 deps: ~20ms -> ~0.06ms).
 * Equivalent because tasks.id is the INTEGER PRIMARY KEY and
 * task_deps.task_id is NOT NULL. Inside NOT / CASE / OR the correlated
 * form measured as fast or faster, so those call sites keep it.
 */
export const OPEN_BLOCKER_ID_IN_SQL = `tasks.id IN (
  SELECT d.task_id FROM task_deps d JOIN tasks b ON b.id = d.depends_on_id
   WHERE b.status != 'done'
)`;

export type AddDependencyResult =
  | { ok: true; added: boolean }
  | { ok: false; error: "self" | "not_found" | "cycle"; message: string; path?: number[] };

/**
 * Record "taskId is blocked by dependsOnId". Rejects self-dependencies,
 * unknown ids, and edges that would close a cycle (dependsOnId already
 * waits on taskId, directly or transitively). Idempotent.
 */
export function addDependency(db: Database, taskId: number, dependsOnId: number): AddDependencyResult {
  if (taskId === dependsOnId) {
    return { ok: false, error: "self", message: `#${taskId} cannot depend on itself` };
  }
  const exists = db.prepare(`SELECT id FROM tasks WHERE id IN (?, ?)`).all(taskId, dependsOnId) as Array<{ id: number }>;
  if (exists.length < 2) {
    const missing = [taskId, dependsOnId].find((id) => !exists.some((row) => row.id === id));
    return { ok: false, error: "not_found", message: `task #${missing} not found` };
  }
  const path = dependencyPath(db, dependsOnId, taskId);
  if (path) {
    return {
      ok: false,
      error: "cycle",
      message: `would create a cycle: ${[taskId, ...path].map((id) => `#${id}`).join(" → ")}`,
      path,
    };
  }
  const result = db
    .prepare(`INSERT OR IGNORE INTO task_deps (task_id, depends_on_id, created_at) VALUES (?, ?, ?)`)
    .run(taskId, dependsOnId, new Date().toISOString());
  return { ok: true, added: result.changes > 0 };
}

/**
 * Blocker chain from `from` to `to` following "is blocked by" edges, or
 * null when `to` is unreachable. `[from, ..., to]` when found.
 */
function dependencyPath(db: Database, from: number, to: number): number[] | null {
  const edges = db.prepare(`SELECT depends_on_id AS next FROM task_deps WHERE task_id = ?`);
  const parent = new Map<number, number>();
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) {
      const path = [to];
      let node = to;
      while (node !== from) {
        node = parent.get(node)!;
        path.unshift(node);
      }
      return path;
    }
    for (const { next } of edges.all(current) as Array<{ next: number }>) {
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, current);
      queue.push(next);
    }
  }
  return null;
}

/** Remove "taskId is blocked by dependsOnId". Returns whether a row went away. */
export function removeDependency(db: Database, taskId: number, dependsOnId: number): boolean {
  return (
    db.prepare(`DELETE FROM task_deps WHERE task_id = ? AND depends_on_id = ?`).run(taskId, dependsOnId).changes > 0
  );
}

/** Ids `taskId` is directly blocked by (any status). */
export function blockerIdsOf(db: Database, taskId: number): number[] {
  return (
    db.prepare(`SELECT depends_on_id AS id FROM task_deps WHERE task_id = ? ORDER BY depends_on_id`).all(taskId) as Array<{
      id: number;
    }>
  ).map((row) => row.id);
}

export interface DependencyInfo {
  /** Tasks this one waits on. */
  blocked_by: Task[];
  /** Tasks waiting on this one. */
  blocks: Task[];
  /** Ids from blocked_by that are not done yet. */
  open_blocker_ids: number[];
}

export function dependencyInfo(db: Database, taskId: number): DependencyInfo {
  const blockedBy = (
    db
      .prepare(
        `SELECT t.* FROM task_deps d JOIN tasks t ON t.id = d.depends_on_id
          WHERE d.task_id = ? ORDER BY (t.status = 'done'), t.priority DESC, t.id`,
      )
      .all(taskId) as Array<Record<string, unknown>>
  ).map(hydrate);
  const blocks = (
    db
      .prepare(
        `SELECT t.* FROM task_deps d JOIN tasks t ON t.id = d.task_id
          WHERE d.depends_on_id = ? ORDER BY (t.status = 'done'), t.priority DESC, t.id`,
      )
      .all(taskId) as Array<Record<string, unknown>>
  ).map(hydrate);
  return {
    blocked_by: blockedBy,
    blocks,
    open_blocker_ids: blockedBy.filter((task) => task.status !== "done").map((task) => task.id),
  };
}

/**
 * For every not-done task that has an unfinished blocker: task id → the
 * open blocker ids. Small by construction (only rows in task_deps), so the
 * Web list fetches it once to badge blocked rows.
 */
export function openBlockerMap(db: Database): Map<number, number[]> {
  const rows = db
    .prepare(
      `SELECT d.task_id AS task_id, d.depends_on_id AS blocker_id
         FROM task_deps d
         JOIN tasks t ON t.id = d.task_id
         JOIN tasks b ON b.id = d.depends_on_id
        WHERE t.status != 'done' AND b.status != 'done'
        ORDER BY d.task_id, d.depends_on_id`,
    )
    .all() as Array<{ task_id: number; blocker_id: number }>;
  const map = new Map<number, number[]>();
  for (const row of rows) {
    const list = map.get(row.task_id);
    if (list) list.push(row.blocker_id);
    else map.set(row.task_id, [row.blocker_id]);
  }
  return map;
}

export interface DependencyEdge {
  task_id: number;
  depends_on_id: number;
}

/** Every edge, for snapshot export. */
export function listAllDependencies(db: Database): DependencyEdge[] {
  return db.prepare(`SELECT task_id, depends_on_id FROM task_deps ORDER BY task_id, depends_on_id`).all() as DependencyEdge[];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
