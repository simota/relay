// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { RelayDB } from "../db/client.js";
import { DB_PATH } from "../paths.js";
import { recordRunOutcome } from "./run.js";

function seedRun(): { runId: number; taskId: number } {
  using db = new RelayDB();
  const sourceId = `manual:run-test:${Math.random().toString(36).slice(2)}`;
  db.upsertTasks([{
    source_type: "manual",
    source_id: sourceId,
    repo: "demo",
    title: "run outcome",
    body: "",
    status: "open",
    assignee: "codex",
    priority: 50,
    prompt: null,
    files: [],
    context_hash: null,
    session_id: null,
    due_at: null,
    wait_on: "self",
  }]);
  const task = db.getTaskBySourceId("manual", sourceId)!;
  return { runId: db.insertRun(task.id, task.assignee), taskId: task.id };
}

function runRow(runId: number): { status: string; ended_at: string | null; output_summary: string | null } {
  const raw = new Database(DB_PATH, { readonly: true });
  try {
    return raw.query("SELECT status, ended_at, output_summary FROM runs WHERE id = ?").get(runId) as {
      status: string;
      ended_at: string | null;
      output_summary: string | null;
    };
  } finally {
    raw.close();
  }
}

describe("recordRunOutcome", () => {
  test("a failing context snapshot does not turn a successful run into a failed one", () => {
    const { runId, taskId } = seedRun();
    const task = (() => { using db = new RelayDB(); return db.getTask(taskId)!; })();
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => { warnings.push(String(msg)); };
    try {
      recordRunOutcome(runId, task, "/nonexistent", "success", undefined, () => {
        throw new Error("git snapshot exploded");
      });
    } finally {
      console.warn = warn;
    }
    const row = runRow(runId);
    expect(row.status).toBe("success");
    expect(row.ended_at).not.toBeNull();
    expect(warnings.join("\n")).toContain("git snapshot exploded");
  });

  test("records the failure reason for a failed run", () => {
    const { runId, taskId } = seedRun();
    const task = (() => { using db = new RelayDB(); return db.getTask(taskId)!; })();
    recordRunOutcome(runId, task, "/nonexistent", "failed", "agent binary not found", () => {});
    const row = runRow(runId);
    expect(row.status).toBe("failed");
    expect(row.output_summary).toBe("agent binary not found");
  });
});
