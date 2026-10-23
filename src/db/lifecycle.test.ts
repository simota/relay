// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { Database } from "bun:sqlite";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTasksApi } from "../api/tasks.js";
import { createUndoApi } from "../api/undo.js";
import { pruneMissingRepos } from "../commands/prune.js";
import { runSync } from "../commands/sync.js";
import { CONFIG_PATH, DB_PATH, RELAY_HOME } from "../paths.js";
import type { TaskInput } from "../types.js";
import { RelayDB } from "./client.js";

// RELAY_HOME points at a throwaway directory (src/test-setup.ts). Give it one
// scan root holding only `present-repo`, so any other repo is "missing".
beforeAll(() => {
  const root = join(RELAY_HOME, "roots");
  mkdirSync(join(root, "present-repo"), { recursive: true });
  writeFileSync(CONFIG_PATH, `[scan]\nroots = [${JSON.stringify(root)}]\n`);
});

const SNOOZE_UNTIL = "2099-12-01T00:00:00.000Z";
let seq = 0;

beforeEach(() => {
  new RelayDB().close(); // bootstrap the schema
  const raw = new Database(DB_PATH);
  raw.exec("DELETE FROM tasks; DELETE FROM undo_log;");
  raw.close();
});

function input(overrides: Partial<TaskInput> = {}): TaskInput {
  seq += 1;
  return {
    source_type: "code_todo",
    source_id: `gone-repo:src/a.ts:${seq}`,
    repo: "gone-repo",
    title: `todo ${seq}`,
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

function insert(t: TaskInput): number {
  const db = new RelayDB();
  db.upsertTasks([t]);
  const id = db.getTaskBySourceId(t.source_type, t.source_id)!.id;
  db.close();
  return id;
}

function state(id: number) {
  const db = new RelayDB();
  const t = db.getTask(id)!;
  db.close();
  return { status: t.status, due_at: t.due_at, closed_at: t.closed_at };
}

function snooze(ids: number[]) {
  const db = new RelayDB();
  db.bulkSnooze(ids, SNOOZE_UNTIL);
  db.close();
}

async function post(app: { request: (url: string, init?: RequestInit) => Response | Promise<Response> }, url: string, body?: unknown) {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("missing-repo auto-close", () => {
  test("sync keeps snoozed tasks and only closes open ones", async () => {
    const open = insert(input());
    const snoozed = insert(input());
    snooze([snoozed]);

    await runSync({ source: "manual", silent: true });

    expect(state(open).status).toBe("done");
    expect(state(snoozed)).toMatchObject({ status: "snoozed", due_at: SNOOZE_UNTIL });
  });

  test("the Web sync auto-prune can keep snoozed tasks too", () => {
    const snoozed = insert(input());
    snooze([snoozed]);
    pruneMissingRepos({ includeDone: false, execute: true, keepSnoozed: true });
    expect(state(snoozed).status).toBe("snoozed");
  });

  test("redo of a sync auto-close re-applies it instead of failing", async () => {
    const open = insert(input());
    await runSync({ source: "manual", silent: true });
    const undoApi = createUndoApi();

    expect((await post(undoApi, "/")).status).toBe(200);
    expect(state(open).status).toBe("open");
    const redo = await post(undoApi, "/?redo=1");
    expect(redo.status).toBe(200);
    expect(state(open).status).toBe("done");
  });
});

describe("Web bulk actions", () => {
  test("undo of bulk close restores each task's prior state", async () => {
    const done = insert(input({ repo: "present-repo" }));
    const snoozed = insert(input({ repo: "present-repo" }));
    const open = insert(input({ repo: "present-repo" }));
    const dbSetup = new RelayDB();
    dbSetup.setStatus(done, "done");
    dbSetup.close();
    snooze([snoozed]);
    const doneBefore = state(done);

    const res = await post(createTasksApi(), "/bulk/close", { ids: [done, snoozed, open] });
    expect(await res.json()).toMatchObject({ count: 2 });
    expect(state(done)).toEqual(doneBefore); // already-done task untouched

    await post(createUndoApi(), "/");
    expect(state(done)).toEqual(doneBefore);
    expect(state(snoozed)).toMatchObject({ status: "snoozed", due_at: SNOOZE_UNTIL });
    expect(state(open).status).toBe("open");
  });

  test("a new action after undo discards the stale redo entry", async () => {
    const id = insert(input({ repo: "present-repo" }));
    const tasksApi = createTasksApi();
    const undoApi = createUndoApi();

    await post(tasksApi, "/bulk/close", { ids: [id] });
    await post(undoApi, "/");
    await post(tasksApi, "/bulk/snooze", { ids: [id], until: SNOOZE_UNTIL });
    const redo = await post(undoApi, "/?redo=1");

    expect(await redo.json()).toMatchObject({ redone: false });
    expect(state(id)).toMatchObject({ status: "snoozed", due_at: SNOOZE_UNTIL });
  });

  test("rejects oversized id lists with 400 instead of a SQLite error", async () => {
    const ids = Array.from({ length: 2001 }, (_, i) => i + 1);
    const res = await post(createTasksApi(), "/bulk/close", { ids });
    expect(res.status).toBe(400);
  });
});

describe("re-sync ingest", () => {
  test("keeps a snoozed task's snooze date when upstream text changes", () => {
    const t = input({ repo: "present-repo" });
    const id = insert(t);
    snooze([id]);
    const db = new RelayDB();
    db.upsertTasks([{ ...t, title: "edited upstream" }]);
    db.close();
    expect(state(id)).toMatchObject({ status: "snoozed", due_at: SNOOZE_UNTIL });
  });

  test("still updates due_at from the adapter for non-snoozed tasks", () => {
    const t = input({ repo: "present-repo", due_at: "2099-01-01" });
    const id = insert(t);
    const db = new RelayDB();
    db.upsertTasks([{ ...t, title: "edited", due_at: "2099-02-02" }]);
    db.close();
    expect(state(id).due_at).toBe("2099-02-02");
  });
});
