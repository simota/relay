// Context CRUD, backfill, and graph extraction extracted from `client.ts`.

import type { Database } from "bun:sqlite";
import { addGraphEdge, hydrateContext } from "../internal.js";
import type { SessionType } from "../../types.js";
import type { ContextGraphData, RelayContext } from "../types.js";

/**
 * One-off data fixup: copy session_id / session_type from each linked task
 * into the matching context row, for contexts whose own session metadata is
 * still NULL.
 * Idempotent: re-running after a successful pass reports updated=0.
 */
export function runContextSessionBackfill(
  db: Database,
  opts: { dryRun?: boolean } = {},
): { total: number; eligible: number; updated: number } {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM contexts WHERE session_id IS NULL OR session_type IS NULL`)
    .get() as { n: number };

  const eligibleRow = db
    .prepare(
      `SELECT COUNT(DISTINCT c.hash) AS n
         FROM contexts c
         JOIN tasks t
           ON t.context_hash = c.hash AND t.session_id IS NOT NULL
        WHERE c.session_id IS NULL OR c.session_type IS NULL`,
    )
    .get() as { n: number };

  const result = { total: totalRow.n, eligible: eligibleRow.n, updated: 0 };
  if (opts.dryRun) return result;

  const info = db
    .prepare(
      `UPDATE contexts
          SET session_id = COALESCE(session_id, (
            SELECT t.session_id
              FROM tasks t
             WHERE t.context_hash = contexts.hash
               AND t.session_id IS NOT NULL
             ORDER BY t.updated_at DESC
             LIMIT 1
          )),
              session_type = COALESCE(session_type, (
            SELECT CASE t.source_type
              WHEN 'claude_session_todo' THEN 'claude'
              WHEN 'codex_session_todo' THEN 'codex'
              WHEN 'antigravity_session_todo' THEN 'antigravity'
              WHEN 'cursor_session_todo' THEN 'cursor'
              ELSE NULL
            END
              FROM tasks t
             WHERE t.context_hash = contexts.hash
               AND t.session_id IS NOT NULL
             ORDER BY t.updated_at DESC
             LIMIT 1
          ))
        WHERE (session_id IS NULL OR session_type IS NULL)
          AND EXISTS (
            SELECT 1 FROM tasks t
             WHERE t.context_hash = contexts.hash
               AND t.session_id IS NOT NULL
          )`,
    )
    .run();
  result.updated = Number(info.changes);
  return result;
}

export function contextCount(db: Database): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM contexts`)
    .get() as { n: number };
  return row.n;
}

export function insertContext(
  db: Database,
  input: {
    hash: string;
    repo: string;
    branch: string;
    headSha: string;
    dirtyFiles: string[];
    summary: string;
    sessionId?: string | null;
    sessionType?: SessionType | null;
  },
): void {
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT OR REPLACE INTO contexts (hash, repo, branch, head_sha, dirty_files, summary, session_id, session_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.hash,
      input.repo,
      input.branch,
      input.headSha,
      JSON.stringify(input.dirtyFiles),
      input.summary,
      input.sessionId ?? null,
      input.sessionType ?? null,
      now,
    );
}

export function updateContextSummary(
  db: Database,
  input: {
    hash: string;
    summary: string;
    generatedAt: string | null;
    modelName: string | null;
  },
): boolean {
  const info = db
    .prepare(
      `UPDATE contexts
          SET summary = ?, generated_at = ?, model_name = ?
        WHERE hash = ?`,
    )
    .run(input.summary, input.generatedAt, input.modelName, input.hash);
  return Number(info.changes) > 0;
}

export function setTaskContext(db: Database, taskId: number, contextHash: string): void {
  const now = new Date().toISOString();
  db
    .prepare(
      `UPDATE tasks SET context_hash = ?, updated_at = ? WHERE id = ?`,
    )
    .run(contextHash, now, taskId);
}

export function linkContextToActiveTasks(
  db: Database,
  repo: string,
  contextHash: string,
  sessionId?: string,
): number {
  const now = new Date().toISOString();
  if (sessionId) {
    const info = db
      .prepare(
        `UPDATE tasks SET context_hash = ?, updated_at = ?
           WHERE session_id = ?`,
      )
      .run(contextHash, now, sessionId);
    if (info.changes > 0) return Number(info.changes);
  }
  const info = db
    .prepare(
      `UPDATE tasks SET context_hash = ?, updated_at = ?
         WHERE repo = ? AND status = 'in_progress'`,
    )
    .run(contextHash, now, repo);
  return Number(info.changes);
}

export function getContext(db: Database, hash: string): RelayContext | null {
  // Try exact match first, then prefix (git-style)
  const exact = db
    .prepare(`SELECT * FROM contexts WHERE hash = ?`)
    .get(hash) as Record<string, unknown> | undefined;
  if (exact) return hydrateContext(exact);
  const prefix = db
    .prepare(`SELECT * FROM contexts WHERE hash LIKE ? ORDER BY created_at DESC LIMIT 1`)
    .get(`${hash}%`) as Record<string, unknown> | undefined;
  return prefix ? hydrateContext(prefix) : null;
}

export function getLatestContextForRepo(db: Database, repo: string): RelayContext | null {
  const row = db
    .prepare(
      `SELECT * FROM contexts WHERE repo = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(repo) as Record<string, unknown> | undefined;
  return row ? hydrateContext(row) : null;
}

export function listContexts(db: Database, repo?: string, limit = 50): RelayContext[] {
  // Correlated subquery for linked_tasks_count avoids a GROUP BY across
  // every contexts column (SQLite would need each one in the GROUP BY
  // list, and any new column added to the schema would silently break the
  // query). The subquery hits the idx_tasks_context_hash index per row,
  // which at limit=50 is negligible — well under 5ms on the user's DB.
  const sql = repo
    ? `SELECT c.*,
              (SELECT COUNT(*) FROM tasks t WHERE t.context_hash = c.hash) AS linked_tasks_count
         FROM contexts c
        WHERE c.repo = ?
        ORDER BY c.created_at DESC
        LIMIT ?`
    : `SELECT c.*,
              (SELECT COUNT(*) FROM tasks t WHERE t.context_hash = c.hash) AS linked_tasks_count
         FROM contexts c
        ORDER BY c.created_at DESC
        LIMIT ?`;
  const rows = (repo
    ? db.prepare(sql).all(repo, limit)
    : db.prepare(sql).all(limit)) as Array<Record<string, unknown>>;
  return rows.map(hydrateContext);
}

export function contextGraph(
  db: Database,
  filters: { repo?: string; limit?: number } = {},
): ContextGraphData {
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  const contextRows = (filters.repo
    ? db
        .prepare(
          `SELECT hash, repo, branch, session_id, created_at
             FROM contexts
            WHERE repo = ?
            ORDER BY created_at DESC
            LIMIT ?`,
        )
        .all(filters.repo, limit)
    : db
        .prepare(
          `SELECT hash, repo, branch, session_id, created_at
             FROM contexts
            ORDER BY created_at DESC
            LIMIT ?`,
        )
        .all(limit)) as Array<{
    hash: string;
    repo: string;
    branch: string;
    session_id: string | null;
    created_at: string;
  }>;

  const nodes = new Map<string, ContextGraphData["nodes"][number]>();
  const edges = new Map<string, ContextGraphData["edges"][number]>();
  const hashes = contextRows.map((row) => row.hash);

  for (const row of contextRows) {
    nodes.set(`context:${row.hash}`, {
      id: `context:${row.hash}`,
      type: "context",
      label: `${row.repo}@${row.branch}`,
    });
    nodes.set(`repo:${row.repo}`, { id: `repo:${row.repo}`, type: "repo", label: row.repo });
    addGraphEdge(edges, `context:${row.hash}`, `repo:${row.repo}`, 1);
  }

  if (hashes.length > 0) {
    const placeholders = hashes.map(() => "?").join(", ");
    const taskRows = db
      .prepare(
        `SELECT id, title, repo, context_hash
           FROM tasks
          WHERE context_hash IN (${placeholders})
          ORDER BY updated_at DESC`,
      )
      .all(...hashes) as Array<{
      id: number;
      title: string;
      repo: string;
      context_hash: string;
    }>;

    for (const task of taskRows) {
      const taskId = `task:${task.id}`;
      nodes.set(taskId, { id: taskId, type: "task", label: task.title });
      nodes.set(`repo:${task.repo}`, { id: `repo:${task.repo}`, type: "repo", label: task.repo });
      addGraphEdge(edges, `context:${task.context_hash}`, taskId, 1);
      addGraphEdge(edges, taskId, `repo:${task.repo}`, 1);
    }
  }

  const bySession = new Map<string, typeof contextRows>();
  for (const row of contextRows) {
    if (!row.session_id) continue;
    const rows = bySession.get(row.session_id) ?? [];
    rows.push(row);
    bySession.set(row.session_id, rows);
  }
  for (const rows of bySession.values()) {
    rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    for (let i = 1; i < rows.length; i++) {
      addGraphEdge(edges, `context:${rows[i - 1]!.hash}`, `context:${rows[i]!.hash}`, 3);
    }
  }

  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
}

/**
 * Recent contexts whose summary is non-empty. Used by `relay digest`'s
 * "Context highlights" section. Ordered newest first, capped at `limit`.
 */
export function contextHighlightsSince(
  db: Database,
  sinceIso: string,
  limit = 10,
): RelayContext[] {
  const rows = db
    .prepare(
      `SELECT * FROM contexts
        WHERE created_at >= ?
          AND summary IS NOT NULL
          AND length(trim(summary)) > 0
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(sinceIso, limit) as Array<Record<string, unknown>>;
  return rows.map(hydrateContext);
}
