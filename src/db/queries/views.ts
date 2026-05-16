// Saved-views CRUD and smart-inbox helpers extracted from `client.ts`.
// `listSavedViews` returns ONLY the user-defined rows; the facade prepends
// `smartViews(this)` so the smart entries keep their pinned-first ordering
// without forcing this module to know about RelayDB.

import type { Database } from "bun:sqlite";
import { ensureViewsSchema } from "../migrations.js";
import { normalizeViewFilter, parseAgeFilter, parseViewFilter } from "../internal.js";
import type { SavedView, ViewFilter } from "../types.js";

export function listSavedViews(db: Database): SavedView[] {
  ensureViewsSchema(db);
  const rows = db
    .prepare(
      `SELECT id, name, filter_json, pinned, created_at
         FROM views
        ORDER BY pinned DESC, created_at DESC, name ASC`,
    )
    .all() as Array<{
    id: number;
    name: string;
    filter_json: string;
    pinned: number;
    created_at: string;
  }>;

  return rows.map((row) => {
    const filter = parseViewFilter(row.filter_json);
    return {
      id: row.id,
      name: row.name,
      filter,
      pinned: row.pinned === 1,
      created_at: row.created_at,
      count: countForViewFilter(db, filter),
      smart: false,
    };
  });
}

export function createView(
  db: Database,
  input: { name: string; filter: ViewFilter; pinned?: boolean },
): SavedView {
  ensureViewsSchema(db);
  const name = input.name.trim();
  const filter = normalizeViewFilter(input.filter);
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO views (name, filter_json, pinned, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         filter_json = excluded.filter_json,
         pinned = excluded.pinned`,
    )
    .run(name, JSON.stringify(filter), input.pinned ? 1 : 0, createdAt);
  const id = Number(info.lastInsertRowid) || viewIdByName(db, name);
  return {
    id,
    name,
    filter,
    pinned: Boolean(input.pinned),
    created_at: createdAt,
    count: countForViewFilter(db, filter),
    smart: false,
  };
}

export function deleteView(db: Database, id: number): boolean {
  ensureViewsSchema(db);
  const info = db.prepare(`DELETE FROM views WHERE id = ?`).run(id);
  return Number(info.changes) > 0;
}

export function countForViewFilter(db: Database, filter: ViewFilter): number {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (filter.repo) {
    where.push("repo = ?");
    args.push(filter.repo);
  }
  if (filter.source) {
    where.push("source_type = ?");
    args.push(filter.source);
  }
  if (filter.status) {
    where.push("status = ?");
    args.push(filter.status);
  } else {
    where.push("status != 'done'");
  }
  const olderThanDays = parseAgeFilter(filter.age);
  if (olderThanDays !== null) {
    where.push("created_at <= datetime('now', ?)");
    args.push(`-${olderThanDays} days`);
  }
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`)
    .get(...args) as { n: number | null };
  return row.n ?? 0;
}

export function smartInboxCounts(db: Database): Record<string, number> {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN source_type = 'github_pr' AND status != 'done'
                  THEN 1 ELSE 0 END) AS github_pr_review,
         SUM(CASE WHEN source_type = 'code_todo'
                   AND status != 'done'
                   AND created_at <= datetime('now', '-30 days')
                  THEN 1 ELSE 0 END) AS old_code_todos,
         SUM(CASE WHEN status = 'snoozed'
                   AND due_at IS NOT NULL
                   AND date(due_at) <= date('now')
                  THEN 1 ELSE 0 END) AS unsnoozing_today
       FROM tasks`,
    )
    .get() as {
    github_pr_review: number | null;
    old_code_todos: number | null;
    unsnoozing_today: number | null;
  };
  return {
    github_pr_review: row.github_pr_review ?? 0,
    old_code_todos: row.old_code_todos ?? 0,
    unsnoozing_today: row.unsnoozing_today ?? 0,
  };
}

export function viewIdByName(db: Database, name: string): number {
  const row = db.prepare(`SELECT id FROM views WHERE name = ?`).get(name) as
    | { id: number }
    | undefined;
  return row?.id ?? 0;
}
