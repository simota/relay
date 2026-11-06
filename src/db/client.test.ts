// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskInput } from "../types.js";
import { RelayDB } from "./client.js";

describe("RelayDB connection lifecycle", () => {
  test("`using` closes the connection when the block throws", () => {
    let leaked: RelayDB | undefined;
    expect(() => {
      using db = new RelayDB();
      leaked = db;
      db.getTask(1); // connection is usable inside the block
      throw new Error("query failed");
    }).toThrow("query failed");
    // Closed: any further query fails instead of holding a WAL handle open.
    expect(() => leaked!.getTask(1)).toThrow();
  });

  test("`using` closes the connection on an early return", () => {
    let leaked: RelayDB | undefined;
    const run = (): string => {
      using db = new RelayDB();
      leaked = db;
      if (db.getTask(-1) === null) return "not found";
      return "found";
    };
    expect(run()).toBe("not found");
    expect(() => leaked!.getTask(1)).toThrow();
  });

  test("close() is idempotent, so an explicit close inside a `using` scope is safe", () => {
    expect(() => {
      using db = new RelayDB();
      db.close();
    }).not.toThrow();
    const db = new RelayDB();
    db.close();
    expect(() => db.close()).not.toThrow();
  });
});

describe("sourceCountsWithDelta7d", () => {
  test("matches sourceCounts() + sourceDelta7d()", () => {
    using db = new RelayDB(join(mkdtempSync(join(tmpdir(), "relay-counts-")), "db.sqlite"));
    expect(db.sourceCountsWithDelta7d()).toEqual({ sources: {}, delta7d: 0 });

    const day = 24 * 60 * 60 * 1000;
    const rows: Array<[string, string, number]> = [
      ["code_todo", "open", 1], ["code_todo", "open", 30], ["code_todo", "done", 1],
      ["github_issue", "snoozed", 2], ["github_issue", "in_progress", 8],
      ["manual", "done", 3], ["agents_note", "blocked", 0],
    ];
    const tasks: TaskInput[] = rows.map(([source_type, status], i) => ({
      source_type: source_type as TaskInput["source_type"],
      source_id: `src-${i}`,
      repo: "r",
      title: `t${i}`,
      body: "",
      status: status as TaskInput["status"],
      assignee: "self",
      priority: 50,
      prompt: null,
      files: [],
      context_hash: null,
      session_id: null,
      due_at: null,
      wait_on: "self",
    }));
    db.upsertTasks(tasks);
    // Backdate created_at per row (ingest stamps "now").
    const raw = (db as unknown as { db: Database }).db;
    rows.forEach(([, , ageDays], i) => {
      raw.prepare("UPDATE tasks SET created_at = ? WHERE source_id = ?").run(
        new Date(Date.now() - ageDays * day).toISOString(),
        `src-${i}`,
      );
    });
    const combined = db.sourceCountsWithDelta7d();
    expect(combined).toEqual({ sources: db.sourceCounts(), delta7d: db.sourceDelta7d() });
    expect(combined).toEqual({ sources: { agents_note: 1, code_todo: 2, github_issue: 2 }, delta7d: 3 });
    // Key order (source_type order) is unchanged too.
    expect(Object.keys(combined.sources)).toEqual(Object.keys(db.sourceCounts()));
  });
});
