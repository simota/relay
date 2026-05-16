// Insights / analytics dashboard queries extracted from `client.ts`.
// Pure read queries — no writes, no transactions — so callers can fan them
// out without lock contention.

import type { Database } from "bun:sqlite";

/**
 * WFR (Workflow Flow Rate) over the trailing N weeks. Returns one row
 * per ISO-week bucket with raw counts; the API layer turns these into
 * the 0.0-1.0 ratio (closed / (closed + opened) * active_repos /
 * repos_with_open).
 */
export function insightsWfr(
  db: Database,
  periodWeeks: number,
): Array<{
  wk: string;
  active_repos: number;
  repos_with_open: number;
  closed_n: number;
  opened_n: number;
}> {
  const rows: Array<{
    wk: string;
    active_repos: number;
    repos_with_open: number;
    closed_n: number;
    opened_n: number;
  }> = [];
  const activeStmt = db.prepare(
    `SELECT COUNT(DISTINCT repo) AS n FROM tasks
      WHERE updated_at >= ? AND updated_at < ?`,
  );
  const openReposStmt = db.prepare(
    `SELECT COUNT(DISTINCT repo) AS n FROM tasks WHERE status = 'open'`,
  );
  const closedStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM tasks
      WHERE closed_at IS NOT NULL AND closed_at >= ? AND closed_at < ?`,
  );
  const openedStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM tasks
      WHERE created_at >= ? AND created_at < ?`,
  );
  const reposWithOpen =
    (openReposStmt.get() as { n: number | null }).n ?? 0;
  for (let i = periodWeeks - 1; i >= 0; i--) {
    const startExpr = `-${(i + 1) * 7} days`;
    const endExpr = `-${i * 7} days`;
    const weekStartRow = db
      .prepare(`SELECT date('now', ?) AS d, datetime('now', ?) AS start_at, datetime('now', ?) AS end_at`)
      .get(startExpr, startExpr, endExpr) as {
      d: string;
      start_at: string;
      end_at: string;
    };
    const active =
      (activeStmt.get(weekStartRow.start_at, weekStartRow.end_at) as { n: number | null }).n ?? 0;
    const closed =
      (closedStmt.get(weekStartRow.start_at, weekStartRow.end_at) as { n: number | null }).n ?? 0;
    const opened =
      (openedStmt.get(weekStartRow.start_at, weekStartRow.end_at) as { n: number | null }).n ?? 0;
    rows.push({
      wk: weekStartRow.d,
      active_repos: active,
      repos_with_open: reposWithOpen,
      closed_n: closed,
      opened_n: opened,
    });
  }
  return rows;
}

export function insightsThroughput(
  db: Database,
  windowDays: number,
): { closed: number; opened: number } {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM tasks
            WHERE closed_at IS NOT NULL
              AND closed_at >= datetime('now', ?)) AS closed,
         (SELECT COUNT(*) FROM tasks
            WHERE created_at >= datetime('now', ?)) AS opened`,
    )
    .get(`-${windowDays} days`, `-${windowDays} days`) as {
    closed: number | null;
    opened: number | null;
  };
  return { closed: row.closed ?? 0, opened: row.opened ?? 0 };
}

export function insightsStale(
  db: Database,
  thresholdDays: number,
): { stale: number; open_total: number } {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN wait_on = 'self'
                   AND julianday('now') - julianday(updated_at) > ?
                  THEN 1 ELSE 0 END) AS stale,
         COUNT(*) AS open_total
       FROM tasks WHERE status = 'open'`,
    )
    .get(thresholdDays) as { stale: number | null; open_total: number | null };
  return { stale: row.stale ?? 0, open_total: row.open_total ?? 0 };
}

export function insightsTouched(
  db: Database,
  windowDays: number,
): { active: number; total: number } {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT repo) FROM tasks
            WHERE updated_at >= datetime('now', ?)
               OR id IN (
                 SELECT task_id FROM runs
                  WHERE started_at >= datetime('now', ?)
               )) AS active,
         (SELECT COUNT(DISTINCT repo) FROM tasks) AS total`,
    )
    .get(`-${windowDays} days`, `-${windowDays} days`) as {
    active: number | null;
    total: number | null;
  };
  return { active: row.active ?? 0, total: row.total ?? 0 };
}

export function insightsWaitAgeRaw(db: Database): number[] {
  const rows = db
    .prepare(
      `SELECT julianday('now') - julianday(updated_at) AS age_d
         FROM tasks
        WHERE status = 'open'
        ORDER BY age_d ASC`,
    )
    .all() as Array<{ age_d: number | null }>;
  const ages: number[] = [];
  for (const r of rows) ages.push(r.age_d ?? 0);
  return ages;
}

export function insightsStaleRepos(
  db: Database,
  limit: number,
): Array<{ repo: string; open_n: number; days_stale: number }> {
  const rows = db
    .prepare(
      `SELECT repo,
         COUNT(*) AS open_n,
         CAST(julianday('now') - julianday(MAX(updated_at)) AS INTEGER) AS days_stale
       FROM tasks
       WHERE status = 'open'
       GROUP BY repo
       HAVING days_stale >= 14
       ORDER BY open_n DESC, days_stale DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    repo: string;
    open_n: number | null;
    days_stale: number | null;
  }>;
  return rows.map((r) => ({
    repo: r.repo,
    open_n: r.open_n ?? 0,
    days_stale: r.days_stale ?? 0,
  }));
}

export function insightsNewlyActive(
  db: Database,
  windowDays: number,
): Array<{ repo: string; new_tasks: number }> {
  const rows = db
    .prepare(
      `WITH recent AS (
         SELECT DISTINCT repo FROM tasks
          WHERE created_at >= datetime('now','-7 days')
             OR updated_at >= datetime('now','-7 days')
       ),
       prior AS (
         SELECT DISTINCT repo FROM tasks
          WHERE updated_at BETWEEN datetime('now', ?) AND datetime('now','-7 days')
       )
       SELECT r.repo AS repo,
         (SELECT COUNT(*) FROM tasks
            WHERE repo = r.repo
              AND created_at >= datetime('now','-7 days')) AS new_tasks
       FROM recent r
       WHERE r.repo NOT IN (SELECT repo FROM prior)
       ORDER BY new_tasks DESC
       LIMIT 10`,
    )
    .all(`-${windowDays + 7} days`) as Array<{
    repo: string;
    new_tasks: number | null;
  }>;
  return rows.map((r) => ({ repo: r.repo, new_tasks: r.new_tasks ?? 0 }));
}

export function insightsFlowTimeseries(
  db: Database,
  days: number,
): Array<{ day: string; opened: number; closed: number }> {
  const rows: Array<{ day: string; opened: number; closed: number }> = [];
  const openedStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM tasks WHERE date(created_at) = ?`,
  );
  const closedStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM tasks WHERE date(closed_at) = ?`,
  );
  for (let i = days - 1; i >= 0; i--) {
    const dayRow = db
      .prepare(`SELECT date('now', ?) AS d`)
      .get(`-${i} days`) as { d: string };
    const opened = (openedStmt.get(dayRow.d) as { n: number | null }).n ?? 0;
    const closed = (closedStmt.get(dayRow.d) as { n: number | null }).n ?? 0;
    rows.push({ day: dayRow.d, opened, closed });
  }
  return rows;
}

export function insightsWaitMix(db: Database): Array<{ wait_on: string; n: number }> {
  const rows = db
    .prepare(
      `SELECT wait_on, COUNT(*) AS n
         FROM tasks
        WHERE status = 'open'
        GROUP BY wait_on`,
    )
    .all() as Array<{ wait_on: string; n: number | null }>;
  return rows.map((r) => ({ wait_on: r.wait_on, n: r.n ?? 0 }));
}

export function insightsAgeHistogram(db: Database): Array<{ bucket: string; n: number }> {
  const rows = db
    .prepare(
      `SELECT
         CASE
           WHEN julianday('now') - julianday(updated_at) < 1  THEN '0-1d'
           WHEN julianday('now') - julianday(updated_at) < 3  THEN '1-3d'
           WHEN julianday('now') - julianday(updated_at) < 7  THEN '3-7d'
           WHEN julianday('now') - julianday(updated_at) < 14 THEN '7-14d'
           WHEN julianday('now') - julianday(updated_at) < 30 THEN '14-30d'
           ELSE '30d+'
         END AS bucket,
         COUNT(*) AS n
       FROM tasks
       WHERE status = 'open'
       GROUP BY bucket`,
    )
    .all() as Array<{ bucket: string; n: number | null }>;
  return rows.map((r) => ({ bucket: r.bucket, n: r.n ?? 0 }));
}

export function insightsSourceInflow(
  db: Database,
  windowDays: number,
): Array<{ source_type: string; curr: number; prev: number }> {
  const rows = db
    .prepare(
      `SELECT source_type,
         SUM(CASE WHEN created_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS curr,
         SUM(CASE WHEN created_at >= datetime('now', ?)
                   AND created_at <  datetime('now', ?) THEN 1 ELSE 0 END) AS prev
       FROM tasks
       GROUP BY source_type
       ORDER BY curr DESC`,
    )
    .all(
      `-${windowDays} days`,
      `-${windowDays * 2} days`,
      `-${windowDays} days`,
    ) as Array<{ source_type: string; curr: number | null; prev: number | null }>;
  return rows.map((r) => ({
    source_type: r.source_type,
    curr: r.curr ?? 0,
    prev: r.prev ?? 0,
  }));
}

export function insightsRunsByAgent(
  db: Database,
  days: number,
): Array<{ agent: string; total: number; failed: number }> {
  const rows = db
    .prepare(
      `SELECT agent,
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM runs
       WHERE started_at >= datetime('now', ?)
       GROUP BY agent
       ORDER BY total DESC`,
    )
    .all(`-${days} days`) as Array<{
    agent: string;
    total: number | null;
    failed: number | null;
  }>;
  return rows.map((r) => ({
    agent: r.agent,
    total: r.total ?? 0,
    failed: r.failed ?? 0,
  }));
}

/**
 * Returns per-adapter, per-day worst sync status over the trailing N days.
 * The API layer fills in 'none' for days with no sync history.
 */
export function insightsSyncReliabilityRaw(
  db: Database,
  days: number,
): Array<{
  adapter: string;
  day: string;
  day_status: "ok" | "partial" | "error";
  count: number;
}> {
  const rows = db
    .prepare(
      `SELECT adapter,
         date(started_at) AS day,
         CASE
           WHEN SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) > 0 THEN 'error'
           WHEN SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) > 0 THEN 'partial'
           ELSE 'ok'
         END AS day_status,
         COUNT(*) AS count
       FROM sync_history
       WHERE started_at >= datetime('now', ?)
       GROUP BY adapter, day
       ORDER BY adapter, day`,
    )
    .all(`-${days} days`) as Array<{
    adapter: string;
    day: string;
    day_status: "ok" | "partial" | "error";
    count: number | null;
  }>;
  return rows.map((r) => ({
    adapter: r.adapter,
    day: r.day,
    day_status: r.day_status,
    count: r.count ?? 0,
  }));
}

export function insightsContextFreshness(
  db: Database,
  limit: number,
): Array<{ repo: string; days_since_ctx: number | null; open_n: number }> {
  const rows = db
    .prepare(
      `SELECT t.repo AS repo,
         CAST(julianday('now') - julianday(MAX(c.created_at)) AS INTEGER) AS days_since_ctx,
         COUNT(DISTINCT t.id) AS open_n
       FROM tasks t
       LEFT JOIN contexts c ON c.repo = t.repo
       WHERE t.status = 'open'
       GROUP BY t.repo
       ORDER BY days_since_ctx DESC NULLS LAST
       LIMIT ?`,
    )
    .all(limit) as Array<{
    repo: string;
    days_since_ctx: number | null;
    open_n: number | null;
  }>;
  return rows.map((r) => ({
    repo: r.repo,
    days_since_ctx: r.days_since_ctx,
    open_n: r.open_n ?? 0,
  }));
}

export function insightsOrphans(
  db: Database,
  ageDays: number,
  limit: number,
): Array<{
  id: number;
  repo: string;
  title: string;
  priority: number;
  updated_at: string;
  days_since_updated: number;
}> {
  const rows = db
    .prepare(
      `SELECT id, repo, title, priority, updated_at,
         CAST(julianday('now') - julianday(updated_at) AS INTEGER) AS days_since_updated
       FROM tasks
       WHERE status = 'open'
         AND julianday('now') - julianday(updated_at) > ?
       ORDER BY priority DESC, updated_at ASC
       LIMIT ?`,
    )
    .all(ageDays, limit) as Array<{
    id: number;
    repo: string;
    title: string;
    priority: number | null;
    updated_at: string;
    days_since_updated: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    repo: r.repo,
    title: r.title,
    priority: r.priority ?? 50,
    updated_at: r.updated_at,
    days_since_updated: r.days_since_updated ?? 0,
  }));
}
