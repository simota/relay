// First import: guarantees a throwaway RELAY_HOME (see src/test-setup.ts).
import "../test-setup.js";
import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createTasksApi } from "../api/tasks.js";
import { createUndoApi } from "../api/undo.js";
import { runClose, runReopen } from "../commands/mutate.js";
import { runSnoozeUntil } from "../commands/edit.js";
import { DB_PATH } from "../paths.js";
import { buildApp } from "../web/server.js";
import type { TaskInput } from "../types.js";
import { RelayDB } from "./client.js";

let seq = 0;

beforeEach(() => {
  new RelayDB().close();
  const raw = new Database(DB_PATH);
  raw.exec("DELETE FROM tasks; DELETE FROM undo_log; DELETE FROM runs;");
  raw.close();
});

function insert(overrides: Partial<TaskInput> = {}, recurrence: string | null = null, tags: string[] = []): number {
  seq += 1;
  const t: TaskInput = {
    source_type: "manual",
    source_id: `manual:test:${seq}`,
    repo: "chores",
    title: `chore ${seq}`,
    body: "check the thing",
    status: "open",
    assignee: "codex",
    priority: 70,
    prompt: "bump deps",
    files: ["package.json"],
    context_hash: null,
    session_id: null,
    due_at: null,
    wait_on: "self",
    ...overrides,
  };
  using db = new RelayDB();
  db.upsertTasks([t]);
  const id = db.getTaskBySourceId(t.source_type, t.source_id)!.id;
  if (recurrence) db.editTask(id, { recurrence }, { lock: false });
  if (tags.length) db.setTags(id, tags);
  return id;
}

function all() {
  using db = new RelayDB();
  return db.listTasks({ status: "all", limit: 1000 } as never);
}

function seriesOf(rootId: number) {
  const raw = new Database(DB_PATH);
  const rows = raw
    .prepare(`SELECT id, status, due_at, recurrence, tags, prompt, assignee FROM tasks WHERE source_id LIKE ? ORDER BY id`)
    .all(`recur:${rootId}:%`) as Array<Record<string, unknown>>;
  raw.close();
  return rows;
}

function req(app: { request: (url: string, init?: RequestInit) => Response | Promise<Response> }, url: string, method = "POST", body?: unknown) {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json", host: "127.0.0.1:7340" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("recurring tasks", () => {
  test("Web close spawns the next occurrence, snoozed until due, carrying fields and tags", async () => {
    const id = insert({}, "weekly", ["ops"]);
    const res = await req(buildApp(), `/api/tasks/${id}/close`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; next_occurrence?: { id: number; due_at: string } };
    expect(json.status).toBe("done");
    expect(json.next_occurrence).toBeDefined();

    const series = seriesOf(id);
    expect(series).toHaveLength(1);
    const next = series[0]!;
    expect(next.status).toBe("snoozed");
    expect(next.recurrence).toBe("weekly");
    expect(next.prompt).toBe("bump deps");
    expect(next.assignee).toBe("codex");
    expect(JSON.parse(next.tags as string)).toEqual(["ops"]);
    expect(Date.parse(next.due_at as string)).toBeGreaterThan(Date.now() + 6 * 86400_000);
  });

  test("undo drops the untouched occurrence; redo re-spawns it", async () => {
    const id = insert({}, "daily");
    await req(buildApp(), `/api/tasks/${id}/close`);
    expect(seriesOf(id)).toHaveLength(1);

    await req(createUndoApi(), "/");
    expect(seriesOf(id)).toHaveLength(0);
    using db = new RelayDB();
    expect(db.getTask(id)?.status).toBe("open");

    await req(createUndoApi(), "/?redo=1");
    expect(db.getTask(id)?.status).toBe("done");
    expect(seriesOf(id)).toHaveLength(1);
  });

  test("undo keeps an occurrence the user already touched", async () => {
    const id = insert({}, "daily");
    await req(buildApp(), `/api/tasks/${id}/close`);
    const next = seriesOf(id)[0]!.id as number;
    {
      using db = new RelayDB();
      db.editTask(next, { title: "edited" });
    }
    await req(createUndoApi(), "/");
    expect(seriesOf(id)).toHaveLength(1);
  });

  test("closing a spawned occurrence continues the same series (no duplicates on re-close)", async () => {
    const id = insert({}, "every:2d");
    await req(buildApp(), `/api/tasks/${id}/close`);
    // closing the root again (reopen → close) must not double-spawn the same day
    await req(buildApp(), `/api/tasks/${id}/reopen`);
    await req(buildApp(), `/api/tasks/${id}/close`);
    expect(seriesOf(id)).toHaveLength(1);

    const next = seriesOf(id)[0]!.id as number;
    {
      using db = new RelayDB();
      db.setStatus(next, "open");
    }
    await req(buildApp(), `/api/tasks/${next}/close`);
    expect(seriesOf(id).length).toBe(2);
  });

  test("bulk close spawns for recurring rows only and reports the count", async () => {
    const a = insert({}, "weekly");
    const b = insert();
    const res = await req(createTasksApi(), "/bulk/close", "POST", { ids: [a, b] });
    expect(await res.json()).toMatchObject({ ok: true, count: 2, spawned: 1 });
    expect(seriesOf(a)).toHaveLength(1);
    await req(createUndoApi(), "/");
    expect(seriesOf(a)).toHaveLength(0);
  });

  test("PATCH sets and clears recurrence without locking it against sync", async () => {
    const id = insert();
    const app = createTasksApi();
    const bad = await req(app, `/${id}`, "PATCH", { recurrence: "sometimes" });
    expect(bad.status).toBe(400);
    const ok = await req(app, `/${id}`, "PATCH", { recurrence: "mon,thu" });
    const json = (await ok.json()) as { task: { recurrence: string; user_overrides: string[] } };
    expect(json.task.recurrence).toBe("days:mon,thu");
    expect(json.task.user_overrides).not.toContain("recurrence");
    await req(app, `/${id}`, "PATCH", { recurrence: null });
    using db = new RelayDB();
    expect(db.getTask(id)?.recurrence).toBeNull();
  });

  test("POST /api/tasks accepts a recurrence rule", async () => {
    const res = await req(buildApp(), "/api/tasks", "POST", { repo: "chores", title: "weekly review", recurrence: "weekly" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { recurrence: string }).recurrence).toBe("weekly");
    const bad = await req(buildApp(), "/api/tasks", "POST", { repo: "chores", title: "x", recurrence: "often" });
    expect(bad.status).toBe(400);
  });

  test("non-recurring close spawns nothing", async () => {
    const id = insert();
    await req(buildApp(), `/api/tasks/${id}/close`);
    expect(all().filter((t) => t.source_id.startsWith("recur:"))).toHaveLength(0);
  });
});

describe("CLI bulk lifecycle", () => {
  test("relay close <ids...> closes all in one undo entry and spawns recurrences", async () => {
    const a = insert({}, "daily");
    const b = insert();
    const log = console.log;
    console.log = () => {};
    try {
      runClose([a, b]);
    } finally {
      console.log = log;
    }
    using db = new RelayDB();
    expect(db.getTask(a)?.status).toBe("done");
    expect(db.getTask(b)?.status).toBe("done");
    expect(seriesOf(a)).toHaveLength(1);
    expect(db.listUndo(1)[0]?.op_kind).toBe("bulk_close");

    await req(createUndoApi(), "/");
    expect(db.getTask(a)?.status).toBe("open");
    expect(db.getTask(b)?.status).toBe("open");
    expect(seriesOf(a)).toHaveLength(0);
  });

  test("relay snooze / reopen <ids...> are single undo entries", async () => {
    const a = insert();
    const b = insert();
    const log = console.log;
    console.log = () => {};
    try {
      runSnoozeUntil([a, b], "+3d");
      using db = new RelayDB();
      expect(db.getTask(a)?.status).toBe("snoozed");
      expect(db.getTask(b)?.status).toBe("snoozed");
      expect(db.listUndo(1)[0]?.op_kind).toBe("bulk_snooze");
      runReopen([a, b]);
      expect(db.getTask(a)?.status).toBe("open");
      expect(db.listUndo(1)[0]?.op_kind).toBe("bulk_reopen");
    } finally {
      console.log = log;
    }
    await req(createUndoApi(), "/");
    using db = new RelayDB();
    expect(db.getTask(a)?.status).toBe("snoozed");
    expect(db.getTask(b)?.status).toBe("snoozed");
  });
});
