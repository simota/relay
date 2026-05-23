import { Hono } from "hono";
import type { Context } from "hono";
import { RelayDB } from "../db/client.js";
import { SourceType } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

// --- Response contracts ---------------------------------------------------

export type WfrPeriod = "8w" | "12w";

export interface WfrResponse {
  period: WfrPeriod;
  weeks: Array<{
    wk: string;
    wfr: number;
    active_repos: number;
    repos_with_open: number;
    closed_n: number;
    opened_n: number;
  }>;
}

export interface ThroughputResponse {
  window: string;
  closed: number;
  opened: number;
  ratio: number;
}

export interface StaleResponse {
  threshold_days: number;
  stale: number;
  open_total: number;
  ratio: number;
}

export interface TouchedResponse {
  window: string;
  active: number;
  total: number;
}

export interface WaitAgeResponse {
  median_days: number;
  sample_n: number;
}

export interface StaleReposResponse {
  repos: Array<{
    repo: string;
    open_n: number;
    days_stale: number;
  }>;
}

export interface NewlyActiveResponse {
  window: string;
  repos: Array<{
    repo: string;
    new_tasks: number;
  }>;
}

export interface FlowTimeseriesResponse {
  days: Array<{
    day: string;
    opened: number;
    closed: number;
  }>;
}

export type WaitOnBucket = "self" | "reviewer" | "external" | "scheduled";

export interface WaitMixResponse {
  mix: Array<{ wait_on: WaitOnBucket; n: number }>;
  total: number;
}

export type AgeBucket = "0-1d" | "1-3d" | "3-7d" | "7-14d" | "14-30d" | "30d+";

export interface AgeHistogramResponse {
  buckets: Array<{ bucket: AgeBucket; n: number }>;
}

export interface SourceInflowResponse {
  window: string;
  rows: Array<{
    source_type: string;
    curr: number;
    prev: number;
  }>;
}

export interface RunsByAgentResponse {
  days: number;
  rows: Array<{
    agent: string;
    total: number;
    failed: number;
    failed_rate: number;
  }>;
}

export type SyncReliabilityStatus = "ok" | "partial" | "error" | "none";

export interface SyncReliabilityResponse {
  days: number;
  adapters: Array<{
    adapter: string;
    cells: Array<{
      day: string;
      status: SyncReliabilityStatus;
      count: number;
    }>;
  }>;
}

export interface ContextFreshnessResponse {
  repos: Array<{
    repo: string;
    days_since_ctx: number | null;
    open_n: number;
  }>;
}

export interface OrphansResponse {
  age_days: number;
  rows: Array<{
    id: number;
    repo: string;
    title: string;
    priority: number;
    updated_at: string;
    days_since_updated: number;
  }>;
}

export interface BurndownResponse {
  days: number;
  rows: Array<{ date: string; open: number; in_progress: number; done: number }>;
}

export interface VelocityResponse {
  weeks: number;
  rows: Array<{ repo: string; closed: number; avg_lifetime_days: number }>;
}

export interface DuplicateCluster {
  id: number;
  tasks: Array<{ id: number; title: string; repo: string; source_type: string }>;
}

export interface DuplicatesResponse {
  clusters: DuplicateCluster[];
}

export interface StaleCloseResponse {
  ok: true;
  closed: number;
  ids: number[];
}

export interface SkillRankEntry {
  /** Skill name (e.g. "nexus"). Kebab-case, lowercase. */
  name: string;
  /** Distinct sessions in the window that used this skill at least once. */
  sessions_count: number;
  /** Same metric in the previous comparable window. */
  prev_sessions_count: number;
  /** Most recent session that used this skill, for direct navigation. */
  latest_session: {
    type: "claude" | "codex" | "antigravity" | "cursor";
    id: string;
    last_active: string;
  } | null;
}

export interface SkillRankResponse {
  /** Number of days the rolling window covers. */
  window_days: number;
  /** Distinct sessions in the window (denominator for adoption %). */
  total_sessions: number;
  entries: SkillRankEntry[];
}

export interface SessionsByTypeEntry {
  /** Session type — claude / codex / antigravity / cursor. */
  type: "claude" | "codex" | "antigravity" | "cursor";
  /** Top-level sessions (subagents excluded) in the window. */
  session_count: number;
  /** Sum of `last_active - started_at` across those sessions, in seconds. */
  total_seconds: number;
  /** Mean wall-clock duration per session, in seconds. */
  avg_seconds: number;
}

export interface SessionsByTypeResponse {
  /** Rolling window in days. */
  window_days: number;
  /** Sum of `session_count` across all types — useful as a denominator. */
  total_sessions: number;
  /** Sum of `total_seconds` across all types. */
  total_seconds: number;
  entries: SessionsByTypeEntry[];
}

// --- 60s in-memory cache --------------------------------------------------

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

function cacheKey(c: Context): string {
  // `c.req.url` includes the querystring, so the same path with different
  // query values gets its own cache slot.
  return new URL(c.req.url).pathname + "?" + new URL(c.req.url).search;
}

function withCache<T>(c: Context, compute: () => T): T {
  const key = cacheKey(c);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }
  const value = compute();
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

// --- API ------------------------------------------------------------------

export function createInsightsApi() {
  const app = new Hono();

  app.get("/heatmap", (c) => {
    const range = parseRange(c.req.query("from"), c.req.query("to"), c.req.query("period"));
    if (!range) {
      return c.json({ error: "from/to must be valid YYYY-MM-DD dates and period must be 7d, 30d, or 90d" }, 400);
    }
    const sources = parseSources(c.req.query("source"));
    if (!sources) {
      return c.json({ error: "source must be a valid source type" }, 400);
    }

    const db = new RelayDB();
    const heatmap = db.heatmap(range, sources);
    db.close();
    return c.json(heatmap);
  });

  // 1. WFR (Workflow Flow Rate) ---------------------------------------
  app.get("/wfr", (c) => {
    const period = parseWfrPeriod(c.req.query("period"));
    if (!period) return c.json({ error: "period must be 8w or 12w" }, 400);
    const value = withCache<WfrResponse>(c, () => {
      const db = new RelayDB();
      const rows = db.insightsWfr(period === "8w" ? 8 : 12);
      db.close();
      const weeks = rows.map((r) => {
        const denomA = r.closed_n + r.opened_n;
        const ratioA = denomA === 0 ? 0 : r.closed_n / denomA;
        const denomB = r.repos_with_open;
        const ratioB = denomB === 0 ? 0 : r.active_repos / denomB;
        const wfr = Number((ratioA * ratioB).toFixed(4));
        return {
          wk: r.wk,
          wfr,
          active_repos: r.active_repos,
          repos_with_open: r.repos_with_open,
          closed_n: r.closed_n,
          opened_n: r.opened_n,
        };
      });
      return { period, weeks };
    });
    return c.json(value);
  });

  // 2. throughput -----------------------------------------------------
  app.get("/throughput", (c) => {
    const win = parseWindow(c.req.query("window"), "7d", ["7d", "30d"]);
    if (!win) return c.json({ error: "window must be 7d or 30d" }, 400);
    const value = withCache<ThroughputResponse>(c, () => {
      const db = new RelayDB();
      const { closed, opened } = db.insightsThroughput(win.days);
      db.close();
      const denom = closed + opened;
      const ratio = denom === 0 ? 0 : Number((closed / denom).toFixed(4));
      return { window: win.label, closed, opened, ratio };
    });
    return c.json(value);
  });

  // 3. stale ----------------------------------------------------------
  app.get("/stale", (c) => {
    const threshold = parseThreshold(c.req.query("threshold"));
    if (threshold === null) {
      return c.json({ error: "threshold must be 7, 14, or 30" }, 400);
    }
    const value = withCache<StaleResponse>(c, () => {
      const db = new RelayDB();
      const { stale, open_total } = db.insightsStale(threshold);
      db.close();
      const ratio = open_total === 0 ? 0 : Number((stale / open_total).toFixed(4));
      return { threshold_days: threshold, stale, open_total, ratio };
    });
    return c.json(value);
  });

  // 4. touched --------------------------------------------------------
  app.get("/touched", (c) => {
    const win = parseWindow(c.req.query("window"), "7d", ["7d", "30d"]);
    if (!win) return c.json({ error: "window must be 7d or 30d" }, 400);
    const value = withCache<TouchedResponse>(c, () => {
      const db = new RelayDB();
      const { active, total } = db.insightsTouched(win.days);
      db.close();
      return { window: win.label, active, total };
    });
    return c.json(value);
  });

  // 5. wait_age -------------------------------------------------------
  app.get("/wait_age", (c) => {
    const value = withCache<WaitAgeResponse>(c, () => {
      const db = new RelayDB();
      const ages = db.insightsWaitAgeRaw();
      db.close();
      if (ages.length === 0) return { median_days: 0, sample_n: 0 };
      const sorted = ages; // already ORDER BY age_d ASC
      const mid = sorted.length >>> 1;
      const median =
        sorted.length % 2 === 0
          ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
          : (sorted[mid] ?? 0);
      return {
        median_days: Number(median.toFixed(2)),
        sample_n: sorted.length,
      };
    });
    return c.json(value);
  });

  // 6. stale_repos ----------------------------------------------------
  app.get("/stale_repos", (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === null) {
      return c.json({ error: "limit must be an integer between 1 and 20" }, 400);
    }
    const value = withCache<StaleReposResponse>(c, () => {
      const db = new RelayDB();
      const repos = db.insightsStaleRepos(limit);
      db.close();
      return { repos };
    });
    return c.json(value);
  });

  // 7. newly_active ---------------------------------------------------
  app.get("/newly_active", (c) => {
    const win = parseWindow(c.req.query("window"), "14d", ["7d", "14d"]);
    if (!win) return c.json({ error: "window must be 7d or 14d" }, 400);
    const value = withCache<NewlyActiveResponse>(c, () => {
      const db = new RelayDB();
      const repos = db.insightsNewlyActive(win.days);
      db.close();
      return { window: win.label, repos };
    });
    return c.json(value);
  });

  // 8. flow_timeseries ------------------------------------------------
  app.get("/flow_timeseries", (c) => {
    const days = parseFlowDays(c.req.query("days"));
    if (days === null) {
      return c.json({ error: "days must be 14, 30, or 90" }, 400);
    }
    const value = withCache<FlowTimeseriesResponse>(c, () => {
      const db = new RelayDB();
      const series = db.insightsFlowTimeseries(days);
      db.close();
      return { days: series };
    });
    return c.json(value);
  });

  // 9. wait_mix -------------------------------------------------------
  app.get("/wait_mix", (c) => {
    const value = withCache<WaitMixResponse>(c, () => {
      const db = new RelayDB();
      const rows = db.insightsWaitMix();
      db.close();
      const mix: WaitMixResponse["mix"] = [];
      let total = 0;
      for (const r of rows) {
        const bucket = normalizeWaitOn(r.wait_on);
        if (!bucket) continue;
        mix.push({ wait_on: bucket, n: r.n });
        total += r.n;
      }
      return { mix, total };
    });
    return c.json(value);
  });

  // 10. age_histogram -------------------------------------------------
  app.get("/age_histogram", (c) => {
    const value = withCache<AgeHistogramResponse>(c, () => {
      const db = new RelayDB();
      const rows = db.insightsAgeHistogram();
      db.close();
      // Force canonical bucket ordering even when SQL returns sparse rows.
      const order: AgeBucket[] = ["0-1d", "1-3d", "3-7d", "7-14d", "14-30d", "30d+"];
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.bucket, r.n);
      const buckets = order.map((bucket) => ({
        bucket,
        n: counts.get(bucket) ?? 0,
      }));
      return { buckets };
    });
    return c.json(value);
  });

  // 11. source_inflow -------------------------------------------------
  app.get("/source_inflow", (c) => {
    const win = parseWindow(c.req.query("window"), "7d", ["7d", "30d"]);
    if (!win) return c.json({ error: "window must be 7d or 30d" }, 400);
    const value = withCache<SourceInflowResponse>(c, () => {
      const db = new RelayDB();
      const rows = db.insightsSourceInflow(win.days);
      db.close();
      return { window: win.label, rows };
    });
    return c.json(value);
  });

  // 12. runs_by_agent -------------------------------------------------
  app.get("/runs_by_agent", (c) => {
    const days = parseRunsDays(c.req.query("days"));
    if (days === null) {
      return c.json({ error: "days must be 14, 30, or 90" }, 400);
    }
    const value = withCache<RunsByAgentResponse>(c, () => {
      const db = new RelayDB();
      const raw = db.insightsRunsByAgent(days);
      db.close();
      const rows = raw.map((r) => ({
        agent: r.agent,
        total: r.total,
        failed: r.failed,
        failed_rate:
          r.total === 0 ? 0 : Number((r.failed / r.total).toFixed(4)),
      }));
      return { days, rows };
    });
    return c.json(value);
  });

  // 13. sync_reliability ----------------------------------------------
  app.get("/sync_reliability", (c) => {
    const days = parseReliabilityDays(c.req.query("days"));
    if (days === null) {
      return c.json({ error: "days must be 7 or 14" }, 400);
    }
    const value = withCache<SyncReliabilityResponse>(c, () => {
      const db = new RelayDB();
      const raw = db.insightsSyncReliabilityRaw(days);
      db.close();
      const dayLabels = lastNDayLabels(days);
      const byAdapter = new Map<string, Map<string, { status: SyncReliabilityStatus; count: number }>>();
      for (const row of raw) {
        let inner = byAdapter.get(row.adapter);
        if (!inner) {
          inner = new Map();
          byAdapter.set(row.adapter, inner);
        }
        inner.set(row.day, { status: row.day_status, count: row.count });
      }
      const adapters = Array.from(byAdapter.keys())
        .sort()
        .map((adapter) => {
          const inner = byAdapter.get(adapter) ?? new Map();
          const cells = dayLabels.map((day) => {
            const hit = inner.get(day);
            if (hit) return { day, status: hit.status, count: hit.count };
            return { day, status: "none" as const, count: 0 };
          });
          return { adapter, cells };
        });
      return { days, adapters };
    });
    return c.json(value);
  });

  // 14. context_freshness ---------------------------------------------
  app.get("/context_freshness", (c) => {
    const limit = parseFreshnessLimit(c.req.query("limit"));
    if (limit === null) {
      return c.json({ error: "limit must be an integer between 1 and 100" }, 400);
    }
    const value = withCache<ContextFreshnessResponse>(c, () => {
      const db = new RelayDB();
      const repos = db.insightsContextFreshness(limit);
      db.close();
      return { repos };
    });
    return c.json(value);
  });

  // 15. orphans -------------------------------------------------------
  app.get("/orphans", (c) => {
    const age = parseOrphansAge(c.req.query("age"));
    if (age === null) {
      return c.json({ error: "age must be 30, 60, or 90" }, 400);
    }
    const limit = parseOrphansLimit(c.req.query("limit"));
    if (limit === null) {
      return c.json({ error: "limit must be an integer between 1 and 100" }, 400);
    }
    const value = withCache<OrphansResponse>(c, () => {
      const db = new RelayDB();
      const rows = db.insightsOrphans(age, limit);
      db.close();
      return { age_days: age, rows };
    });
    return c.json(value);
  });

  // 16. burndown timeseries -------------------------------------------
  app.get("/burndown", (c) => {
    const days = parseBurndownDays(c.req.query("days"));
    if (days === null) {
      return c.json({ error: "days must be between 7 and 90" }, 400);
    }
    const value = withCache<BurndownResponse>(c, () => {
      const db = new RelayDB();
      const rows = db.insightsBurndown(days);
      db.close();
      return { days, rows };
    });
    return c.json(value);
  });

  // 17. velocity per repo --------------------------------------------
  app.get("/velocity", (c) => {
    const weeks = parseVelocityWeeks(c.req.query("weeks"));
    if (weeks === null) {
      return c.json({ error: "weeks must be between 1 and 52" }, 400);
    }
    const value = withCache<VelocityResponse>(c, () => {
      const db = new RelayDB();
      const rows = db.insightsVelocity(weeks);
      db.close();
      return { weeks, rows };
    });
    return c.json(value);
  });

  // 18. duplicate detection ------------------------------------------
  app.get("/duplicates", (c) => {
    const value = withCache<DuplicatesResponse>(c, () => {
      const db = new RelayDB();
      const clusters = db.insightsDuplicates();
      db.close();
      return { clusters };
    });
    return c.json(value);
  });

  // 20. skill usage ranking ------------------------------------------------
  app.get("/skills", (c) => {
    const windowDays = clampWindowDays(c.req.query("window_days"), 30);
    const value = withCache<SkillRankResponse>(c, () => {
      const db = new RelayDB();
      try {
        return computeSkillRank(db, windowDays);
      } finally {
        db.close();
      }
    });
    return c.json(value);
  });

  // 21. sessions by CLI type — count + total/avg wall-clock duration -----
  app.get("/sessions-by-type", (c) => {
    const windowDays = clampWindowDays(c.req.query("window_days"), 30);
    const value = withCache<SessionsByTypeResponse>(c, () => {
      const db = new RelayDB();
      try {
        const sinceIso = new Date(Date.now() - windowDays * DAY_MS).toISOString();
        const rows = db.rawSessionStatsByTypeSince(sinceIso);
        const entries: SessionsByTypeEntry[] = rows.map((r) => ({
          type: r.type as SessionsByTypeEntry["type"],
          session_count: r.session_count,
          total_seconds: Math.max(0, Math.round(r.total_seconds)),
          avg_seconds: Math.max(0, Math.round(r.avg_seconds)),
        }));
        const total_sessions = entries.reduce((s, e) => s + e.session_count, 0);
        const total_seconds = entries.reduce((s, e) => s + e.total_seconds, 0);
        return {
          window_days: windowDays,
          total_sessions,
          total_seconds,
          entries,
        };
      } finally {
        db.close();
      }
    });
    return c.json(value);
  });

  // 19. stale auto-close (POST, mutates DB) --------------------------
  app.post("/stale/close", (c) => {
    const threshold = parseStaleCloseThreshold(c.req.query("threshold"));
    if (threshold === null) {
      return c.json({ error: "threshold must be between 1 and 365" }, 400);
    }
    const db = new RelayDB();
    const result = db.closeStaleTasks(threshold);
    db.close();
    // Invalidate stale-related cache entries
    for (const key of cache.keys()) {
      if (key.includes("/stale") || key.includes("/burndown") || key.includes("/velocity")) {
        cache.delete(key);
      }
    }
    return c.json<StaleCloseResponse>({ ok: true, closed: result.closed, ids: result.ids });
  });

  return app;
}

// --- helpers --------------------------------------------------------------

function parseRange(from?: string, to?: string, period?: string): { weekStarts: string[]; weekEnds: string[] } | null {
  const toDate = to ? parseDate(to) : startOfIsoWeek(new Date());
  if (!toDate) return null;

  const periodDays = parsePeriod(period);
  if (!periodDays) return null;
  const defaultFrom = new Date(toDate.getTime() - (periodDays - 1) * DAY_MS);
  const fromDate = from ? parseDate(from) : defaultFrom;
  if (!fromDate || fromDate.getTime() > toDate.getTime()) return null;

  const firstWeek = startOfIsoWeek(fromDate);
  const lastWeek = startOfIsoWeek(toDate);
  const starts: string[] = [];
  for (let t = firstWeek.getTime(); t <= lastWeek.getTime(); t += WEEK_MS) {
    starts.push(new Date(t).toISOString());
  }

  const weekStarts = starts;
  const weekEnds = weekStarts.map((week) => new Date(Date.parse(week) + WEEK_MS).toISOString());
  return { weekStarts, weekEnds };
}

function parsePeriod(value?: string): number | null {
  if (!value) return PERIODS["30d"];
  return value in PERIODS ? PERIODS[value as keyof typeof PERIODS] : null;
}

function parseSources(value?: string): SourceType[] | null {
  if (!value) return [];
  const sources = value.split(",").map((source) => source.trim()).filter(Boolean);
  const unique = Array.from(new Set(sources));
  if (unique.length === 0) return [];
  const parsed = SourceType.array().safeParse(unique);
  return parsed.success ? parsed.data : null;
}

function parseDate(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function startOfIsoWeek(input: Date): Date {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function parseWfrPeriod(value?: string): WfrPeriod | null {
  if (!value) return "8w";
  if (value === "8w" || value === "12w") return value;
  return null;
}

function parseWindow(
  value: string | undefined,
  fallback: string,
  allowed: readonly string[],
): { label: string; days: number } | null {
  const label = value ?? fallback;
  if (!allowed.includes(label)) return null;
  const match = /^(\d+)d$/.exec(label);
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days <= 0) return null;
  return { label, days };
}

function parseThreshold(value?: string): number | null {
  if (!value) return 14;
  const allowed = new Set(["7", "14", "30"]);
  if (!allowed.has(value)) return null;
  return Number(value);
}

function parseLimit(value?: string): number | null {
  if (!value) return 5;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 20) return null;
  return n;
}

function parseFlowDays(value?: string): number | null {
  if (!value) return 30;
  const allowed = new Set(["14", "30", "90"]);
  if (!allowed.has(value)) return null;
  return Number(value);
}

function normalizeWaitOn(value: string): WaitOnBucket | null {
  if (value === "self" || value === "reviewer" || value === "external" || value === "scheduled") {
    return value;
  }
  return null;
}

function parseRunsDays(value?: string): number | null {
  if (!value) return 30;
  const allowed = new Set(["14", "30", "90"]);
  if (!allowed.has(value)) return null;
  return Number(value);
}

function parseReliabilityDays(value?: string): number | null {
  if (!value) return 7;
  if (value !== "7" && value !== "14") return null;
  return Number(value);
}

function parseFreshnessLimit(value?: string): number | null {
  if (!value) return 30;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100) return null;
  return n;
}

function parseOrphansAge(value?: string): number | null {
  if (!value) return 30;
  const allowed = new Set(["30", "60", "90"]);
  if (!allowed.has(value)) return null;
  return Number(value);
}

function parseOrphansLimit(value?: string): number | null {
  if (!value) return 20;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100) return null;
  return n;
}

function parseBurndownDays(value?: string): number | null {
  if (!value) return 30;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 7 || n > 90) return null;
  return n;
}

function parseVelocityWeeks(value?: string): number | null {
  if (!value) return 4;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 52) return null;
  return n;
}

function parseStaleCloseThreshold(value?: string): number | null {
  if (!value) return 30;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 365) return null;
  return n;
}

function clampWindowDays(value: string | undefined, dflt: number): number {
  if (!value) return dflt;
  const n = Number(value);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(1, Math.min(365, Math.floor(n)));
}

/**
 * Aggregate skill usage from `sessions.skills_used` across two windows:
 *   - `windowDays` ending now ("current")
 *   - the immediately preceding `windowDays` ("previous")
 *
 * Per-skill counts are distinct *sessions* (not invocation count) so a
 * single session with 30 `/nexus` slashes counts once. Latest-session
 * pointer comes from the row with the highest `last_active` in the current
 * window.
 */
function computeSkillRank(db: RelayDB, windowDays: number): SkillRankResponse {
  const now = Date.now();
  const winMs = windowDays * DAY_MS;
  const curStart = new Date(now - winMs).toISOString();
  const prevStart = new Date(now - 2 * winMs).toISOString();
  const prevEnd = curStart;

  // Both windows in one pass — gather rows for prev window's start to now
  // and bucket them by comparing each row's last_active.
  const rows = db.rawGetSessionsSkillsSince(prevStart);

  const cur = new Map<string, { sessions: Set<string>; latest: { type: string; id: string; last_active: string } }>();
  const prev = new Map<string, Set<string>>();
  let totalCur = 0;

  for (const row of rows) {
    if (!row.skills_used) continue;
    let names: unknown;
    try {
      names = JSON.parse(row.skills_used);
    } catch {
      continue;
    }
    if (!Array.isArray(names)) continue;
    const inCur = row.last_active >= curStart;
    const inPrev = !inCur && row.last_active >= prevStart && row.last_active < prevEnd;
    if (inCur) totalCur += 1;
    const key = `${row.type}:${row.id}`;
    for (const raw of names) {
      if (typeof raw !== "string" || !raw) continue;
      if (inCur) {
        const existing = cur.get(raw);
        if (existing) {
          existing.sessions.add(key);
          if (row.last_active > existing.latest.last_active) {
            existing.latest = { type: row.type, id: row.id, last_active: row.last_active };
          }
        } else {
          cur.set(raw, {
            sessions: new Set([key]),
            latest: { type: row.type, id: row.id, last_active: row.last_active },
          });
        }
      } else if (inPrev) {
        const s = prev.get(raw) ?? new Set<string>();
        s.add(key);
        prev.set(raw, s);
      }
    }
  }

  const entries: SkillRankEntry[] = [];
  for (const [name, info] of cur) {
    entries.push({
      name,
      sessions_count: info.sessions.size,
      prev_sessions_count: prev.get(name)?.size ?? 0,
      latest_session: {
        type: info.latest.type as "claude" | "codex" | "antigravity" | "cursor",
        id: info.latest.id,
        last_active: info.latest.last_active,
      },
    });
  }
  entries.sort((a, b) => b.sessions_count - a.sessions_count || a.name.localeCompare(b.name));

  return {
    window_days: windowDays,
    total_sessions: totalCur,
    entries,
  };
}

/** Returns the last N day labels ("YYYY-MM-DD"), oldest first. */
function lastNDayLabels(days: number): string[] {
  const labels: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    labels.push(d.toISOString().slice(0, 10));
  }
  return labels;
}
