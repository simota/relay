// Dashboard counts, repo rollups, heatmap, today/agenda/standup queries.
// Extracted from `client.ts`.

import type { Database } from "bun:sqlite";
import { effectivePrioritySqlExpr } from "../../lib/priority.js";
import type { SourceType, Task } from "../../types.js";
import type { HeatmapData, ReviewTasks } from "../types.js";
import { hydrate, lastNDays } from "../internal.js";

/**
 * Today queue, ordered by effective (decayed) priority. See SPEC §15 Q4.
 */
export function today(
  db: Database,
  limit: number,
  excludeRepos: string[] = [],
  decayDays: number = 0,
): Task[] {
  const excludeClause =
    excludeRepos.length > 0
      ? `AND repo NOT IN (${excludeRepos.map(() => "?").join(", ")})`
      : "";
  const effective = effectivePrioritySqlExpr(decayDays);
  const sql = `
    SELECT * FROM tasks
    WHERE status IN ('open', 'in_progress')
      AND (due_at IS NULL OR due_at <= datetime('now', '+1 day'))
      ${excludeClause}
    ORDER BY
      ${effective} DESC,
      CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
      due_at ASC,
      updated_at DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...excludeRepos, limit) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function viewCounts(
  db: Database,
  excludeRepos: string[] = [],
): { today: number; open: number; snoozed: number; done: number } {
  const excludeClause =
    excludeRepos.length > 0
      ? `WHERE repo NOT IN (${excludeRepos.map(() => "?").join(", ")})`
      : "";
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('open','in_progress')
                   AND (due_at IS NULL OR due_at <= datetime('now','+1 day'))
                   THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open_c,
         SUM(CASE WHEN status = 'snoozed' THEN 1 ELSE 0 END) AS snoozed_c,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_c
       FROM tasks
       ${excludeClause}`,
    )
    .get(...excludeRepos) as {
    today: number | null;
    open_c: number | null;
    snoozed_c: number | null;
    done_c: number | null;
  };
  return {
    today: row.today ?? 0,
    open: row.open_c ?? 0,
    snoozed: row.snoozed_c ?? 0,
    done: row.done_c ?? 0,
  };
}

export function sourceCounts(db: Database): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT source_type, COUNT(*) AS n
         FROM tasks
         WHERE status != 'done'
         GROUP BY source_type`,
    )
    .all() as Array<{ source_type: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.source_type] = r.n;
  return out;
}

export function sourceDelta7d(db: Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM tasks
        WHERE status != 'done'
          AND created_at >= datetime('now','-7 days')`,
    )
    .get() as { n: number | null };
  return row.n ?? 0;
}

export function repoStats(db: Database): Array<{
  name: string;
  open: number;
  in_progress: number;
  snoozed: number;
  lastTouched: string;
  dailyEventCounts: number[];
}> {
  const rows = db
    .prepare(
      `SELECT
         repo AS name,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_c,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_c,
         SUM(CASE WHEN status = 'snoozed' THEN 1 ELSE 0 END) AS snoozed_c,
         MAX(updated_at) AS last_touched
       FROM tasks
       GROUP BY repo
       ORDER BY last_touched DESC`,
    )
    .all() as Array<{
    name: string;
    open_c: number;
    in_progress_c: number;
    snoozed_c: number;
    last_touched: string;
  }>;
  const eventDays = lastNDays(14);
  const firstDay = eventDays[0] ?? new Date().toISOString().slice(0, 10);
  const eventRows = db
    .prepare(
      `SELECT repo, day, SUM(n) AS n
         FROM (
           SELECT repo, date(created_at) AS day, COUNT(*) AS n
             FROM tasks
            WHERE created_at >= ?
            GROUP BY repo, day
           UNION ALL
           SELECT repo, date(closed_at) AS day, COUNT(*) AS n
             FROM tasks
            WHERE closed_at IS NOT NULL
              AND closed_at >= ?
            GROUP BY repo, day
           UNION ALL
           SELECT repo, date(updated_at) AS day, COUNT(*) AS n
             FROM tasks
            WHERE status = 'snoozed'
              AND updated_at >= ?
            GROUP BY repo, day
         )
        GROUP BY repo, day`,
    )
    .all(firstDay, firstDay, firstDay) as Array<{ repo: string; day: string; n: number | null }>;
  const eventsByRepo = new Map<string, Map<string, number>>();
  for (const row of eventRows) {
    const days = eventsByRepo.get(row.repo) ?? new Map<string, number>();
    days.set(row.day, row.n ?? 0);
    eventsByRepo.set(row.repo, days);
  }
  return rows.map((r) => ({
    name: r.name,
    open: r.open_c ?? 0,
    in_progress: r.in_progress_c ?? 0,
    snoozed: r.snoozed_c ?? 0,
    lastTouched: r.last_touched,
    dailyEventCounts: eventDays.map((day) => eventsByRepo.get(r.name)?.get(day) ?? 0),
  }));
}

export function heatmap(
  db: Database,
  range: { weekStarts: string[]; weekEnds: string[] },
  sourceTypes: SourceType[] = [],
): HeatmapData {
  const sourceClause = sourceTypes.length > 0
    ? ` AND source_type IN (${sourceTypes.map(() => "?").join(", ")})`
    : "";
  const rows = db
    .prepare(
      `SELECT DISTINCT repo
         FROM tasks
        WHERE (created_at < ?
           OR (closed_at IS NOT NULL AND closed_at >= ?))
          ${sourceClause}
        ORDER BY repo ASC`,
    )
    .all(
      range.weekEnds[range.weekEnds.length - 1] ?? new Date().toISOString(),
      range.weekStarts[0] ?? new Date().toISOString(),
      ...sourceTypes,
    ) as Array<{ repo: string }>;

  const openStmt = db.prepare(
    `SELECT COUNT(*) AS n
       FROM tasks
      WHERE repo = ?
        AND created_at < ?
        AND (
          status != 'done'
          OR closed_at IS NULL
          OR closed_at >= ?
        )
        ${sourceClause}`,
  );
  const closedStmt = db.prepare(
    `SELECT COUNT(*) AS n
       FROM tasks
      WHERE repo = ?
        AND closed_at IS NOT NULL
        AND closed_at >= ?
        AND closed_at < ?
        ${sourceClause}`,
  );

  const repos: string[] = [];
  const cells: number[][] = [];
  const open: number[][] = [];
  const closed: number[][] = [];

  for (const row of rows) {
    const openRow: number[] = [];
    const closedRow: number[] = [];
    const cellRow: number[] = [];

    for (let i = 0; i < range.weekStarts.length; i++) {
      const weekStart = range.weekStarts[i]!;
      const weekEnd = range.weekEnds[i]!;
      const openCount = (openStmt.get(row.repo, weekEnd, weekEnd, ...sourceTypes) as { n: number | null }).n ?? 0;
      const closedCount =
        (closedStmt.get(row.repo, weekStart, weekEnd, ...sourceTypes) as { n: number | null }).n ?? 0;
      const total = openCount + closedCount;

      openRow.push(openCount);
      closedRow.push(closedCount);
      cellRow.push(total === 0 ? 0 : Number((openCount / total).toFixed(3)));
    }

    repos.push(row.repo);
    open.push(openRow);
    closed.push(closedRow);
    cells.push(cellRow);
  }

  return { repos, weeks: range.weekStarts.map((week) => week.slice(0, 10)), cells, open, closed };
}

export function reviewTasks(
  db: Database,
  range: {
    weekStart: string;
    weekEnd: string;
    previousWeekStart: string;
    staleBefore: string;
  },
): ReviewTasks {
  const closed = db
    .prepare(
      `SELECT * FROM tasks
        WHERE status = 'done'
          AND closed_at >= ?
          AND closed_at < ?
        ORDER BY closed_at DESC, priority DESC`,
    )
    .all(range.previousWeekStart, range.weekStart) as Array<Record<string, unknown>>;
  const stale = db
    .prepare(
      `SELECT * FROM tasks
        WHERE status IN ('open', 'in_progress', 'blocked')
          AND updated_at < ?
        ORDER BY updated_at ASC, priority DESC`,
    )
    .all(range.staleBefore) as Array<Record<string, unknown>>;
  const fresh = db
    .prepare(
      `SELECT * FROM tasks
        WHERE created_at >= ?
          AND created_at < ?
        ORDER BY created_at DESC, priority DESC`,
    )
    .all(range.weekStart, range.weekEnd) as Array<Record<string, unknown>>;
  const unsnoozed = db
    .prepare(
      `SELECT * FROM tasks
        WHERE status IN ('open', 'in_progress', 'blocked')
          AND due_at IS NOT NULL
          AND due_at >= ?
          AND due_at < ?
        ORDER BY due_at DESC, priority DESC`,
    )
    .all(range.previousWeekStart, range.weekStart) as Array<Record<string, unknown>>;

  return {
    closed: closed.map(hydrate),
    stale: stale.map(hydrate),
    new: fresh.map(hydrate),
    unsnoozed: unsnoozed.map(hydrate),
  };
}

/**
 * Tasks closed within the given ISO window. Used by `relay standup`'s
 * "Yesterday" section. `sinceIso` is inclusive (closed_at >= sinceIso);
 * `untilIso` (default = now) is exclusive (closed_at < untilIso).
 */
export function closedTasksSince(db: Database, sinceIso: string, untilIso?: string): Task[] {
  const upperBound = untilIso ?? new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM tasks
        WHERE status = 'done'
          AND closed_at IS NOT NULL
          AND closed_at >= ?
          AND closed_at < ?
        ORDER BY closed_at DESC, priority DESC`,
    )
    .all(sinceIso, upperBound) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function selfDrivenTasks(
  db: Database,
  limit: number,
  excludeRepos: string[] = [],
): Task[] {
  const excludeClause =
    excludeRepos.length > 0
      ? `AND repo NOT IN (${excludeRepos.map(() => "?").join(", ")})`
      : "";
  const sql = `
    SELECT * FROM tasks
    WHERE status IN ('open', 'in_progress')
      AND wait_on = 'self'
      ${excludeClause}
    ORDER BY priority DESC, updated_at DESC
    LIMIT ?
  `;
  const rows = db
    .prepare(sql)
    .all(...excludeRepos, limit) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function blockedTasks(db: Database, limit: number, excludeRepos: string[] = []): Task[] {
  const excludeClause =
    excludeRepos.length > 0
      ? `AND repo NOT IN (${excludeRepos.map(() => "?").join(", ")})`
      : "";
  const sql = `
    SELECT * FROM tasks
    WHERE status IN ('open', 'in_progress')
      AND wait_on IN ('reviewer', 'external')
      ${excludeClause}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const rows = db
    .prepare(sql)
    .all(...excludeRepos, limit) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function agendaInRange(
  db: Database,
  fromIso: string,
  toIso: string,
  excludeRepos: string[] = [],
): Task[] {
  const excludeClause =
    excludeRepos.length > 0
      ? `AND repo NOT IN (${excludeRepos.map(() => "?").join(", ")})`
      : "";
  const sql = `
    SELECT * FROM tasks
    WHERE status = 'open'
      AND due_at IS NOT NULL
      AND due_at >= ?
      AND due_at < ?
      ${excludeClause}
    ORDER BY due_at ASC, priority DESC
  `;
  const rows = db
    .prepare(sql)
    .all(fromIso, toIso, ...excludeRepos) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function overdueTasks(
  db: Database,
  beforeIso: string,
  excludeRepos: string[] = [],
): Task[] {
  const excludeClause =
    excludeRepos.length > 0
      ? `AND repo NOT IN (${excludeRepos.map(() => "?").join(", ")})`
      : "";
  const sql = `
    SELECT * FROM tasks
    WHERE status = 'open'
      AND due_at IS NOT NULL
      AND due_at < ?
      ${excludeClause}
    ORDER BY due_at ASC, priority DESC
  `;
  const rows = db
    .prepare(sql)
    .all(beforeIso, ...excludeRepos) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function scheduledNoDate(db: Database, excludeRepos: string[] = []): Task[] {
  const excludeClause =
    excludeRepos.length > 0
      ? `AND repo NOT IN (${excludeRepos.map(() => "?").join(", ")})`
      : "";
  const sql = `
    SELECT * FROM tasks
    WHERE status = 'open'
      AND wait_on = 'scheduled'
      AND due_at IS NULL
      ${excludeClause}
    ORDER BY priority DESC, updated_at DESC
  `;
  const rows = db
    .prepare(sql)
    .all(...excludeRepos) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}
