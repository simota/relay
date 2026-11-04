import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SCHEMA_SQL } from "./schema.js";
import { heatmap, heatmapPerCell, heatmapSinglePass } from "./queries/aggregates.js";
import type { SourceType } from "../types.js";

// heatmapSinglePass must reproduce the per-cell SQL exactly (including
// repo order and the ratio rounding); heatmap() falls back to the SQL path
// whenever JS string comparison could disagree with SQLite's BINARY order.

const WEEK_MS = 7 * 86_400_000;
const BASE = Date.parse("2026-01-05T00:00:00.000Z");

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function seededDb(seed: number, repoNames: string[]): Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA_SQL);
  const rand = rng(seed);
  const ins = db.prepare(
    `INSERT INTO tasks (source_type, source_id, repo, title, status, created_at, updated_at, closed_at)
     VALUES (?, ?, ?, 't', ?, ?, ?, ?)`,
  );
  const types: SourceType[] = ["code_todo", "github_pr", "manual"];
  for (let i = 0; i < 600; i++) {
    const created = BASE + Math.floor(rand() * 20 * WEEK_MS) - 4 * WEEK_MS;
    const statusRoll = rand();
    const status = statusRoll < 0.45 ? "done" : statusRoll < 0.6 ? "snoozed" : "open";
    // Some done rows lack closed_at, some open rows carry a stale one.
    const closed =
      (status === "done" && rand() < 0.9) || rand() < 0.05
        ? new Date(created + Math.floor(rand() * 6 * WEEK_MS)).toISOString()
        : null;
    // Exact week boundaries exercise the < / >= edges.
    const createdIso = rand() < 0.1
      ? new Date(BASE + Math.floor(rand() * 16) * WEEK_MS).toISOString()
      : new Date(created).toISOString();
    ins.run(
      types[i % types.length]!,
      `id-${i}`,
      repoNames[Math.floor(rand() * repoNames.length)]!,
      status,
      createdIso,
      createdIso,
      closed,
    );
  }
  return db;
}

function weeks(startOffset: number, count: number) {
  const weekStarts: string[] = [];
  for (let i = 0; i < count; i++) weekStarts.push(new Date(BASE + (startOffset + i) * WEEK_MS).toISOString());
  const weekEnds = weekStarts.map((w) => new Date(Date.parse(w) + WEEK_MS).toISOString());
  return { weekStarts, weekEnds };
}

const RANGES = [weeks(0, 1), weeks(2, 5), weeks(-3, 14), weeks(-30, 104), weeks(40, 3), { weekStarts: [], weekEnds: [] }];
const SOURCES: SourceType[][] = [[], ["code_todo"], ["github_pr", "manual"]];

describe("heatmap single-pass", () => {
  test("matches per-cell SQL for ASCII data across ranges and source filters", () => {
    for (const seed of [1, 7, 42]) {
      const db = seededDb(seed, ["alpha", "Beta", "beta", "_x", "zeta-2", "0num"]);
      for (const range of RANGES) {
        for (const sources of SOURCES) {
          const fast = heatmapSinglePass(db, range, sources);
          expect(fast).not.toBeNull();
          expect(JSON.stringify(fast)).toBe(JSON.stringify(heatmapPerCell(db, range, sources)));
        }
      }
      db.close();
    }
  });

  test("falls back to SQL when strings may sort differently in JS", () => {
    // U+FF21 (fullwidth A) sorts after an astral emoji in UTF-16 but before
    // it in UTF-8 byte order.
    const db = seededDb(3, ["repo-Ａ", "repo-\u{1F600}", "plain"]);
    const range = weeks(0, 6);
    expect(heatmapSinglePass(db, range, [])).toBeNull();
    const viaHeatmap = heatmap(db, range, []);
    expect(JSON.stringify(viaHeatmap)).toBe(JSON.stringify(heatmapPerCell(db, range, [])));
    expect(viaHeatmap.repos).toEqual(["plain", "repo-Ａ", "repo-\u{1F600}"]);
    db.close();
  });
});
