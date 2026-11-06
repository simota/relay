import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SCHEMA_SQL } from "./schema.js";
import {
  insightsBurndown,
  insightsBurndownPerDay,
  insightsDuplicates,
  insightsFlowTimeseries,
} from "./queries/insights.js";

// The single-scan insights must reproduce the original per-day SQL (and the
// original Set-based duplicate clustering) exactly, including odd values
// that SQLite compares differently from JS.

const DAY_MS = 86_400_000;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

const WORDS = "fix parser cache login retry queue docs bench sync widget api the and update refactor".split(" ");

function seededDb(seed: number, n = 800): Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA_SQL);
  const rand = rng(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;
  const ins = db.prepare(
    `INSERT INTO tasks (source_type, source_id, repo, title, status, created_at, updated_at, closed_at)
     VALUES ('manual', ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const created = now - Math.floor(rand() * 120 * DAY_MS);
    const status = pick(["open", "open", "in_progress", "done", "snoozed", "blocked"]);
    const closed = status === "done" || rand() < 0.1 ? created + Math.floor(rand() * 60 * DAY_MS) : null;
    const len = 1 + Math.floor(rand() * 8);
    const title = Array.from({ length: len }, () => pick(WORDS)).join(rand() < 0.5 ? " " : "-");
    ins.run(
      `s${i}`,
      `repo-${Math.floor(rand() * 4)}`,
      title,
      status,
      new Date(created).toISOString(),
      new Date(created).toISOString(),
      closed === null ? null : new Date(closed).toISOString(),
    );
  }
  return db;
}

// The original implementations, kept here as the reference.
function flowPerDay(db: Database, days: number) {
  const rows: Array<{ day: string; opened: number; closed: number }> = [];
  const o = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE date(created_at) = ?`);
  const c = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE date(closed_at) = ?`);
  for (let i = days - 1; i >= 0; i--) {
    const { d } = db.prepare(`SELECT date('now', ?) AS d`).get(`-${i} days`) as { d: string };
    rows.push({
      day: d,
      opened: (o.get(d) as { n: number | null }).n ?? 0,
      closed: (c.get(d) as { n: number | null }).n ?? 0,
    });
  }
  return rows;
}

function duplicatesReference(db: Database, minSimilarity = 0.85) {
  const tasks = db
    .prepare(`SELECT id, title, repo, source_type FROM tasks WHERE status = 'open' ORDER BY repo, id`)
    .all() as Array<{ id: number; title: string; repo: string; source_type: string }>;
  const norm = (t: string) =>
    new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const jac = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 && b.size === 0) return 1;
    let x = 0;
    for (const w of a) if (b.has(w)) x++;
    const u = a.size + b.size - x;
    return u === 0 ? 0 : x / u;
  };
  const byRepo = new Map<string, typeof tasks>();
  for (const t of tasks) byRepo.set(t.repo, [...(byRepo.get(t.repo) ?? []), t]);
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    let cur = x;
    while (cur !== r) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  for (const t of tasks) parent.set(t.id, t.id);
  for (const group of byRepo.values()) {
    const ws = group.map((t) => ({ id: t.id, words: norm(t.title) }));
    for (let i = 0; i < ws.length; i++)
      for (let j = i + 1; j < ws.length; j++)
        if (jac(ws[i]!.words, ws[j]!.words) >= minSimilarity) {
          const ra = find(ws[i]!.id);
          const rb = find(ws[j]!.id);
          if (ra !== rb) parent.set(ra, rb);
        }
  }
  const clusters = new Map<number, typeof tasks>();
  for (const t of tasks) clusters.set(find(t.id), [...(clusters.get(find(t.id)) ?? []), t]);
  const result: Array<{ id: number; tasks: typeof tasks }> = [];
  let idx = 0;
  for (const g of clusters.values()) {
    if (g.length < 2) continue;
    result.push({ id: idx++, tasks: g });
    if (result.length >= 10) break;
  }
  return result;
}

describe("insights single-scan equivalence", () => {
  for (const seed of [1, 7, 42]) {
    test(`flow timeseries matches the per-day SQL (seed ${seed})`, () => {
      const db = seededDb(seed);
      for (const days of [14, 30, 90]) expect(insightsFlowTimeseries(db, days)).toEqual(flowPerDay(db, days));
    });

    test(`burndown matches the per-day SQL (seed ${seed})`, () => {
      const db = seededDb(seed);
      for (const days of [7, 30, 90]) expect(insightsBurndown(db, days)).toEqual(insightsBurndownPerDay(db, days));
    });

    test(`duplicates match the Set-based clustering (seed ${seed})`, () => {
      const db = seededDb(seed);
      for (const t of [0.85, 0.5, 0.3, 0]) expect(insightsDuplicates(db, t)).toEqual(duplicatesReference(db, t));
    });
  }

  test("odd stored values: date-only / space-separated text, NULLs, numbers, non-BMP text", () => {
    const db = seededDb(3, 200);
    const now = Date.now();
    const iso = (t: number) => new Date(t).toISOString();
    const ins = db.prepare(
      `INSERT INTO tasks (source_type, source_id, repo, title, status, created_at, updated_at, closed_at)
       VALUES ('manual', ?, 'repo-0', ?, ?, ?, ?, ?)`,
    );
    ins.run("o1", "a b", "open", iso(now - 3 * DAY_MS).slice(0, 10), iso(now), null);
    ins.run("o2", "c d", "done", iso(now - 9 * DAY_MS), iso(now), iso(now - 2 * DAY_MS).replace("T", " ").slice(0, 19));
    ins.run("o3", "x", "in_progress", iso(now - 9 * DAY_MS), iso(now), iso(now - 2 * DAY_MS).slice(0, 10));
    for (const days of [7, 30]) {
      expect(insightsBurndown(db, days)).toEqual(insightsBurndownPerDay(db, days));
      expect(insightsFlowTimeseries(db, days)).toEqual(flowPerDay(db, days));
    }
    // Values JS cannot compare like SQLite (a number, a non-BMP char) force
    // the per-day fallback,
    // which must still give the same answer.
    db.exec(`UPDATE tasks SET created_at = 12345 WHERE source_id = 's1'`);
    db.exec(`UPDATE tasks SET closed_at = '${iso(now - DAY_MS)}\u{1F600}' WHERE source_id = 's2'`);
    for (const days of [7, 30]) {
      expect(insightsBurndown(db, days)).toEqual(insightsBurndownPerDay(db, days));
      expect(insightsFlowTimeseries(db, days)).toEqual(flowPerDay(db, days));
    }
    expect(insightsDuplicates(db, 0.5)).toEqual(duplicatesReference(db, 0.5));
  });
});
