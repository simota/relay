// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { RELAY_HOME } from "../paths.js";
import type { TaskInput } from "../types.js";
import { RelayDB } from "./client.js";

// Query-plan regression guard for the schema v10 partial indexes. Without
// them, listContexts' per-row linked-task count and the startup contexts
// backfill full-scan `tasks` once per context row (seconds on a large DB).

const PATH = join(RELAY_HOME, "indexes-test.sqlite");

function plan(db: Database, sql: string, ...params: string[]): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)
    .map((r) => r.detail)
    .join(" | ");
}

function task(i: number, overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    source_type: "claude_session_todo",
    source_id: `idx-test:${i}`,
    repo: "idx-repo",
    title: `t${i}`,
    body: "",
    status: "open",
    assignee: "self",
    priority: 50,
    prompt: null,
    files: [],
    context_hash: null,
    session_id: null,
    due_at: null,
    wait_on: "self",
    ...overrides,
  };
}

let relay: RelayDB;
let raw: Database;

beforeAll(() => {
  relay = new RelayDB(PATH);
  raw = new Database(PATH);
});

afterAll(() => {
  raw.close();
  relay.close();
  rmSync(PATH, { force: true });
  rmSync(`${PATH}-wal`, { force: true });
  rmSync(`${PATH}-shm`, { force: true });
});

describe("schema v10 task indexes", () => {
  test("schema_version records v10", () => {
    const row = raw.prepare(`SELECT MAX(version) AS v FROM schema_version`).get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(10);
  });

  test("context_hash lookups use idx_tasks_context_hash", () => {
    expect(plan(raw, `SELECT COUNT(*) FROM tasks t WHERE t.context_hash = ?`, "x")).toContain(
      "idx_tasks_context_hash",
    );
    expect(
      plan(
        raw,
        `SELECT c.hash, (SELECT COUNT(*) FROM tasks t WHERE t.context_hash = c.hash)
           FROM contexts c ORDER BY c.created_at DESC LIMIT 50`,
      ),
    ).toContain("idx_tasks_context_hash");
  });

  test("session_id lookups use idx_tasks_session", () => {
    expect(
      plan(raw, `SELECT * FROM tasks WHERE source_type = ? AND session_id = ?`, "claude_session_todo", "s"),
    ).toContain("idx_tasks_session");
    expect(plan(raw, `SELECT * FROM tasks WHERE status != 'done' AND session_id = ?`, "s")).toContain(
      "idx_tasks_session",
    );
  });

  test("partial indexes keep NULL-keyed rows queryable and counts exact", () => {
    relay.upsertTasks([
      task(1, { context_hash: "ctx-a", session_id: "sess-1" }),
      task(2, { context_hash: "ctx-a" }),
      task(3, { session_id: "sess-1" }),
      task(4),
    ]);
    relay.insertContext({
      hash: "ctx-a",
      repo: "idx-repo",
      branch: "main",
      headSha: "abc",
      dirtyFiles: [],
      summary: "",
    });
    const ctx = relay.listContexts("idx-repo", 10).find((c) => c.hash === "ctx-a");
    expect(ctx?.linkedTasksCount).toBe(2);
    expect(relay.findBySession("claude_session_todo", "sess-1").map((t) => t.source_id)).toEqual([
      "idx-test:1",
      "idx-test:3",
    ]);
    const nullCount = raw
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE source_id LIKE 'idx-test:%' AND context_hash IS NULL`)
      .get() as { n: number };
    expect(nullCount.n).toBe(2);
  });
});

describe("repoNames", () => {
  test("returns exactly the repoStats name set, sorted", () => {
    relay.upsertTasks([
      task(100, { repo: "zeta" }),
      task(101, { repo: "alpha", status: "done" }),
      task(102, { repo: "Mid" }),
      task(103, { repo: "alpha" }),
    ]);
    const fromStats = relay.repoStats().map((r) => r.name);
    const names = relay.repoNames();
    expect(names).toEqual([...fromStats].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("alpha");
  });
});
