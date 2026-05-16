// Task CRUD / list / mutation / session helpers extracted from `client.ts`.
// Every export takes `db: Database` as the first argument and is otherwise
// a verbatim move of the corresponding RelayDB method body.

import type { Database } from "bun:sqlite";
import type { SessionRow, SessionType, Task } from "../../types.js";
import type { TaskStatusSnapshot } from "../types.js";
import { hydrate, parseAgeFilter } from "../internal.js";

// Filesystem-bound source types — these tasks cannot exist meaningfully
// when the local repo directory is gone. github_issue/pr live on github.com,
// manual tasks may target remote-only repos, so we leave those alone.
export const FS_BOUND_SOURCES: readonly string[] = [
  "code_todo",
  "agents_note",
  "claude_session_todo",
  "codex_session_todo",
  "gemini_session_todo",
  "cursor_session_todo",
];

export function listAllTasks(db: Database): Task[] {
  const rows = db
    .prepare(`SELECT * FROM tasks ORDER BY created_at ASC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function getTaskBySourceId(db: Database, sourceType: string, sourceId: string): Task | null {
  const row = db
    .prepare(`SELECT * FROM tasks WHERE source_type = ? AND source_id = ?`)
    .get(sourceType, sourceId) as Record<string, unknown> | undefined;
  return row ? hydrate(row) : null;
}

export function listOpenSourceIdsByType(db: Database, sourceType: string): string[] {
  const rows = db
    .prepare(
      `SELECT source_id FROM tasks
         WHERE source_type = ?
           AND status != 'done'`,
    )
    .all(sourceType) as Array<{ source_id: string }>;
  return rows.map((r) => r.source_id);
}

export function getTask(db: Database, id: number): Task | null {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return hydrate(row);
}

export function getTasksByIds(db: Database, ids: number[]): Task[] {
  if (ids.length === 0) return [];
  const uniqueIds = Array.from(new Set(ids));
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function listTasks(
  db: Database,
  filters: {
    repo?: string;
    source?: string;
    status?: string;
    assignee?: string;
    context?: string;
    session?: string;
    age?: string;
    limit?: number;
  },
): Task[] {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (filters.repo) {
    where.push("repo = ?");
    args.push(filters.repo);
  }
  if (filters.source) {
    where.push("source_type = ?");
    args.push(filters.source);
  }
  if (filters.status) {
    where.push("status = ?");
    args.push(filters.status);
  } else {
    where.push("status != 'done'");
  }
  if (filters.assignee) {
    where.push("assignee = ?");
    args.push(filters.assignee);
  }
  if (filters.context) {
    where.push("context_hash LIKE ?");
    args.push(`${filters.context}%`);
  }
  if (filters.session) {
    where.push("session_id = ?");
    args.push(filters.session);
  }
  const olderThanDays = parseAgeFilter(filters.age);
  if (olderThanDays !== null) {
    where.push("created_at <= datetime('now', ?)");
    args.push(`-${olderThanDays} days`);
  }
  const sql = `
    SELECT * FROM tasks
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY priority DESC, updated_at DESC
    ${filters.limit ? "LIMIT ?" : ""}
  `;
  if (filters.limit) args.push(filters.limit);
  const stmt = db.prepare(sql);
  const rows = stmt.all(...args) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function setStatus(db: Database, id: number, status: string): void {
  const now = new Date().toISOString();
  const closedAt = status === "done" ? now : null;
  db
    .prepare(
      `UPDATE tasks SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?`,
    )
    .run(status, now, closedAt, id);
}

export function setAssignee(db: Database, id: number, assignee: string): void {
  const now = new Date().toISOString();
  db
    .prepare(`UPDATE tasks SET assignee = ?, updated_at = ? WHERE id = ?`)
    .run(assignee, now, id);
}

export function firstGithubSourceIdPerRepo(db: Database): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT repo, MIN(source_id) AS source_id
         FROM tasks
        WHERE source_type IN ('github_issue', 'github_pr')
          AND source_id LIKE 'https://github.com/%'
        GROUP BY repo`,
    )
    .all() as Array<{ repo: string; source_id: string }>;
  const out = new Map<string, string>();
  for (const r of rows) out.set(r.repo, r.source_id);
  return out;
}

export function myOpenPrCountPerRepo(db: Database): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT repo, COUNT(*) AS n
         FROM tasks
        WHERE source_type = 'github_pr' AND status != 'done'
        GROUP BY repo`,
    )
    .all() as Array<{ repo: string; n: number }>;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.repo, r.n);
  return out;
}

export function findOpenTasksInRepos(
  db: Database,
  repos: string[],
  sourceTypes?: string[],
): Task[] {
  if (repos.length === 0) return [];
  const types = sourceTypes ?? FS_BOUND_SOURCES;
  const sql = `
    SELECT * FROM tasks
     WHERE repo IN (${repos.map(() => "?").join(", ")})
       AND source_type IN (${types.map(() => "?").join(", ")})
       AND status != 'done'
     ORDER BY repo, id`;
  const rows = db.prepare(sql).all(...repos, ...types) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function findDoneTasksInRepos(
  db: Database,
  repos: string[],
  sourceTypes?: string[],
): Task[] {
  if (repos.length === 0) return [];
  const types = sourceTypes ?? FS_BOUND_SOURCES;
  const sql = `
    SELECT * FROM tasks
     WHERE repo IN (${repos.map(() => "?").join(", ")})
       AND source_type IN (${types.map(() => "?").join(", ")})
       AND status = 'done'
     ORDER BY repo, id`;
  const rows = db.prepare(sql).all(...repos, ...types) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function closeTasksBySourceIds(
  db: Database,
  items: Array<{ source_type: string; source_id: string }>,
): TaskStatusSnapshot[] {
  if (items.length === 0) return [];
  const inverses: TaskStatusSnapshot[] = [];
  const findStmt = db.prepare(
    `SELECT id, status, due_at, closed_at
       FROM tasks
      WHERE source_type = ? AND source_id = ? AND status != 'done'`,
  );
  const closeStmt = db.prepare(
    `UPDATE tasks SET status = 'done', closed_at = ?, updated_at = ?
      WHERE id = ? AND status != 'done'`,
  );
  const now = new Date().toISOString();
  const tx = db.transaction((batch: Array<{ source_type: string; source_id: string }>) => {
    for (const item of batch) {
      const row = findStmt.get(item.source_type, item.source_id) as
        | { id: number; status: string; due_at: string | null; closed_at: string | null }
        | undefined;
      if (!row) continue;
      inverses.push({
        id: row.id,
        status: row.status as Task["status"],
        due_at: row.due_at,
        closed_at: row.closed_at,
      });
      closeStmt.run(now, now, row.id);
    }
  });
  tx(items);
  return inverses;
}

export function batchCloseTasks(db: Database, ids: number[]): TaskStatusSnapshot[] {
  if (ids.length === 0) return [];
  const inverses: TaskStatusSnapshot[] = [];
  const findStmt = db.prepare(
    `SELECT id, status, due_at, closed_at FROM tasks WHERE id = ?`,
  );
  const closeStmt = db.prepare(
    `UPDATE tasks SET status = 'done', closed_at = ?, updated_at = ? WHERE id = ? AND status != 'done'`,
  );
  const now = new Date().toISOString();
  const tx = db.transaction((batch: number[]) => {
    for (const id of batch) {
      const row = findStmt.get(id) as
        | { id: number; status: string; due_at: string | null; closed_at: string | null }
        | undefined;
      if (!row || row.status === "done") continue;
      inverses.push({
        id: row.id,
        status: row.status as Task["status"],
        due_at: row.due_at,
        closed_at: row.closed_at,
      });
      closeStmt.run(now, now, id);
    }
  });
  tx(ids);
  return inverses;
}

/**
 * Physically delete tasks by id. Returns the full Task snapshots of the
 * deleted rows so they can be restored via restoreDeletedTasks (undo).
 * Runs inside a single transaction; queue_items are cascade-deleted by FK.
 */
export function batchDeleteTasks(db: Database, ids: number[]): Task[] {
  if (ids.length === 0) return [];
  const snapshots: Task[] = [];
  const findStmt = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM tasks WHERE id = ?`);
  const tx = db.transaction((batch: number[]) => {
    for (const id of batch) {
      const row = findStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) continue;
      snapshots.push(hydrate(row));
      deleteStmt.run(id);
    }
  });
  tx(ids);
  return snapshots;
}

/**
 * Restore previously deleted tasks from snapshots (undo of batchDeleteTasks).
 * Inserts with the original id preserved. Idempotent: skips rows whose id
 * already exists (race condition safety).
 */
export function restoreDeletedTasks(db: Database, snapshots: Task[]): number {
  if (snapshots.length === 0) return 0;
  let restored = 0;
  const existsStmt = db.prepare(`SELECT 1 FROM tasks WHERE id = ? LIMIT 1`);
  const insertStmt = db.prepare(`
    INSERT INTO tasks (
      id, source_type, source_id, repo, title, body, status, assignee,
      priority, prompt, files, context_hash, session_id, due_at,
      wait_on, created_at, updated_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows: Task[]) => {
    for (const t of rows) {
      const already = existsStmt.get(t.id);
      if (already) continue;
      insertStmt.run(
        t.id,
        t.source_type,
        t.source_id,
        t.repo,
        t.title,
        t.body,
        t.status,
        t.assignee,
        t.priority,
        t.prompt,
        JSON.stringify(t.files),
        t.context_hash,
        t.session_id,
        t.due_at,
        t.wait_on ?? "self",
        t.created_at,
        t.updated_at,
        t.closed_at,
      );
      restored++;
    }
  });
  tx(snapshots);
  return restored;
}

export function findBySession(db: Database, sourceType: string, sessionId: string): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
        WHERE source_type = ? AND session_id = ?
        ORDER BY id ASC`,
    )
    .all(sourceType, sessionId) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function forgetBySession(db: Database, sourceType: string, sessionId: string): number {
  const info = db
    .prepare(`DELETE FROM tasks WHERE source_type = ? AND session_id = ?`)
    .run(sourceType, sessionId);
  return Number(info.changes);
}

export function updateTaskState(db: Database, snapshot: TaskStatusSnapshot): void {
  const now = new Date().toISOString();
  db
    .prepare(
      `UPDATE tasks
          SET status = ?,
              due_at = ?,
              updated_at = ?,
              closed_at = ?
        WHERE id = ?`,
    )
    .run(snapshot.status, snapshot.due_at, now, snapshot.closed_at, snapshot.id);
}

export function applyTaskStates(db: Database, snapshots: TaskStatusSnapshot[]): number {
  if (snapshots.length === 0) return 0;
  let changed = 0;
  const tx = db.transaction((rows: TaskStatusSnapshot[]) => {
    for (const snapshot of rows) {
      updateTaskState(db, snapshot);
      changed++;
    }
  });
  tx(snapshots);
  return changed;
}

export function bulkSnooze(db: Database, ids: number[], until: string): number {
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(", ");
  const info = db
    .prepare(
      `UPDATE tasks
          SET status = 'snoozed',
              due_at = ?,
              updated_at = ?,
              closed_at = NULL
        WHERE id IN (${placeholders})`,
    )
    .run(until, now, ...ids);
  return Number(info.changes);
}

export function bulkClose(db: Database, ids: number[]): number {
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(", ");
  const info = db
    .prepare(
      `UPDATE tasks
          SET status = 'done',
              updated_at = ?,
              closed_at = ?
        WHERE id IN (${placeholders})`,
    )
    .run(now, now, ...ids);
  return Number(info.changes);
}

// --- F-1 Phase A: sessions table -----------------------------------------

/**
 * UPSERT a single session row by (type, id). Mutable fields
 * (repo / cwd / last_active / message_count / parent_session_id /
 * source_path / sha) are overwritten on conflict; `started_at` is
 * preserved (the row stays anchored to its first-seen timestamp).
 */
export function upsertSession(db: Database, row: SessionRow): void {
  db
    .prepare(
      `INSERT INTO sessions (
         id, type, repo, cwd, started_at, last_active, message_count,
         parent_session_id, source_path, sha
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(type, id) DO UPDATE SET
         repo              = excluded.repo,
         cwd               = excluded.cwd,
         last_active       = excluded.last_active,
         message_count     = excluded.message_count,
         parent_session_id = excluded.parent_session_id,
         source_path       = excluded.source_path,
         sha               = excluded.sha`,
    )
    .run(
      row.id,
      row.type,
      row.repo,
      row.cwd,
      row.started_at,
      row.last_active,
      row.message_count,
      row.parent_session_id,
      row.source_path,
      row.sha,
    );
}

export function getSessions(
  db: Database,
  opts: {
    type?: SessionType;
    repo?: string;
    sinceLastActive?: string;
    limit?: number;
    parent?: string;
    includeSubagents?: boolean;
  } = {},
): SessionRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const where: string[] = [];
  const params: Array<string> = [];
  if (opts.type !== undefined) {
    where.push("type = ?");
    params.push(opts.type);
  }
  if (opts.repo !== undefined) {
    where.push("repo = ?");
    params.push(opts.repo);
  }
  if (opts.sinceLastActive !== undefined) {
    where.push("last_active >= ?");
    params.push(opts.sinceLastActive);
  }
  if (opts.parent !== undefined) {
    where.push("parent_session_id = ?");
    params.push(opts.parent);
  } else if (!opts.includeSubagents) {
    where.push("parent_session_id IS NULL");
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, type, repo, cwd, started_at, last_active, message_count,
              parent_session_id, source_path, sha
         FROM sessions
         ${whereSql}
         ORDER BY last_active DESC
         LIMIT ?`,
    )
    .all(...params, limit) as Array<{
    id: string;
    type: string;
    repo: string | null;
    cwd: string | null;
    started_at: string;
    last_active: string;
    message_count: number;
    parent_session_id: string | null;
    source_path: string;
    sha: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    type: r.type as SessionType,
    repo: r.repo,
    cwd: r.cwd,
    started_at: r.started_at,
    last_active: r.last_active,
    message_count: r.message_count,
    parent_session_id: r.parent_session_id,
    source_path: r.source_path,
    sha: r.sha,
  }));
}

export function getSessionByTypeId(
  db: Database,
  type: SessionType,
  id: string,
): SessionRow | null {
  const row = db
    .prepare(
      `SELECT id, type, repo, cwd, started_at, last_active, message_count,
              parent_session_id, source_path, sha
         FROM sessions
         WHERE type = ? AND id = ?
         LIMIT 1`,
    )
    .get(type, id) as
    | {
        id: string;
        type: string;
        repo: string | null;
        cwd: string | null;
        started_at: string;
        last_active: string;
        message_count: number;
        parent_session_id: string | null;
        source_path: string;
        sha: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    type: row.type as SessionType,
    repo: row.repo,
    cwd: row.cwd,
    started_at: row.started_at,
    last_active: row.last_active,
    message_count: row.message_count,
    parent_session_id: row.parent_session_id,
    source_path: row.source_path,
    sha: row.sha,
  };
}

export function countSubagentsByParent(db: Database, type: SessionType): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT parent_session_id AS parent, COUNT(*) AS n
         FROM sessions
         WHERE type = ? AND parent_session_id IS NOT NULL
         GROUP BY parent_session_id`,
    )
    .all(type) as Array<{ parent: string; n: number }>;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.parent, r.n);
  return out;
}

