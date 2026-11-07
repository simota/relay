// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelayDB } from "../db/client.js";
import type { Adapter, AdapterContext, SourceType, TaskInput } from "../types.js";
import { autoCloseResolvedRemoteTasks } from "./sync.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function task(source_type: SourceType, source_id: string): TaskInput {
  return {
    source_type,
    source_id,
    repo: "r",
    title: source_id,
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
  };
}

function adapter(
  name: SourceType,
  delayMs: number,
  resolved: string[] | Error,
  timeline: string[],
): Adapter {
  return {
    name,
    fetch: async () => [],
    fetchResolved: async () => {
      timeline.push(`start ${name}`);
      await sleep(delayMs);
      timeline.push(`end ${name}`);
      if (resolved instanceof Error) throw resolved;
      return resolved.map((source_id) => ({ source_type: name, source_id }));
    },
  };
}

describe("autoCloseResolvedRemoteTasks", () => {
  test("runs the sweeps concurrently but closes and logs in adapter order", async () => {
    using db = new RelayDB(join(mkdtempSync(join(tmpdir(), "relay-sync-")), "db.sqlite"));
    db.upsertTasks([
      task("github_issue", "i1"),
      task("github_issue", "i2"),
      task("gh_notification", "n1"),
      task("gh_run_failure", "f1"),
    ]);
    const timeline: string[] = [];
    const adapters: Adapter[] = [
      // The slowest sweep comes first: a sequential run would finish it
      // before even starting the others.
      adapter("github_issue", 120, ["i2", "i1"], timeline),
      { name: "manual", fetch: async () => [] }, // no fetchResolved: skipped
      adapter("gh_review_request", 10, new Error("gh down"), timeline),
      adapter("gh_notification", 40, ["n1", "missing"], timeline),
      adapter("gh_run_failure", 5, ["f1"], timeline),
    ];
    const logs: string[] = [];
    const started = performance.now();
    await autoCloseResolvedRemoteTasks(adapters, {} as AdapterContext, db, (m) => logs.push(m));
    const elapsed = performance.now() - started;

    // Concurrent: every sweep started before the slowest one finished.
    expect(timeline.slice(0, 4).every((e) => e.startsWith("start "))).toBe(true);
    expect(elapsed).toBeLessThan(120 + 10 + 40 + 5);

    // Closed set and undo payload follow adapter order, then item order.
    const undo = db.listUndo(1)[0]!;
    expect(undo.op_kind).toBe("sync_auto_close_resolved_remote");
    const closedIds = (JSON.parse(undo.inverse) as { tasks: Array<{ id: number }> }).tasks.map((t) => t.id);
    const idOf = (type: string, sid: string) => db.getTaskBySourceId(type, sid)!.id;
    expect(closedIds).toEqual([
      idOf("github_issue", "i2"),
      idOf("github_issue", "i1"),
      idOf("gh_notification", "n1"),
      idOf("gh_run_failure", "f1"),
    ]);
    for (const id of closedIds) expect(db.getTask(id)!.status).toBe("done");

    // A failed sweep is logged (once, with its adapter name) and does not
    // stop the others.
    expect(logs.filter((l) => l.includes("resolved sweep for"))).toHaveLength(1);
    expect(logs.find((l) => l.includes("resolved sweep for"))).toContain("gh_review_request failed: gh down");
    expect(logs.findIndex((l) => l.includes("auto-closed 4 task(s)"))).toBeGreaterThan(-1);
  });

  test("no adapter with fetchResolved / nothing resolved leaves the DB alone", async () => {
    using db = new RelayDB(join(mkdtempSync(join(tmpdir(), "relay-sync-")), "db.sqlite"));
    db.upsertTasks([task("github_issue", "i1")]);
    const logs: string[] = [];
    await autoCloseResolvedRemoteTasks(
      [{ name: "manual", fetch: async () => [] }, adapter("github_issue", 1, [], [])],
      {} as AdapterContext,
      db,
      (m) => logs.push(m),
    );
    expect(db.listUndo(5)).toHaveLength(0);
    expect(db.getTaskBySourceId("github_issue", "i1")!.status).toBe("open");
    expect(logs).toEqual([]);
  });
});
