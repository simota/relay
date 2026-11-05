import "../test-setup.js";
import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createTasksApi } from "../api/tasks.js";
import { createUndoApi } from "../api/undo.js";
import { buildApp } from "../web/server.js";
import { parseWhenInput } from "../lib/due-date.js";
import { parseTaskEdit } from "../lib/task-edit.js";
import { DB_PATH } from "../paths.js";
import type { TaskInput } from "../types.js";
import { RelayDB } from "./client.js";

let seq = 0;

beforeEach(() => {
  new RelayDB().close();
  const raw = new Database(DB_PATH);
  raw.exec("DELETE FROM tasks; DELETE FROM undo_log; DELETE FROM runs;");
  raw.close();
});

function input(overrides: Partial<TaskInput> = {}): TaskInput {
  seq += 1;
  return {
    source_type: "code_todo",
    source_id: `edit-repo:src/a.ts:${seq}`,
    repo: "edit-repo",
    title: `todo ${seq}`,
    body: "upstream body",
    status: "open",
    assignee: "self",
    priority: 50,
    prompt: null,
    files: ["src/a.ts"],
    context_hash: null,
    session_id: null,
    due_at: null,
    wait_on: "self",
    ...overrides,
  };
}

function insert(t: TaskInput): number {
  using db = new RelayDB();
  db.upsertTasks([t]);
  return db.getTaskBySourceId(t.source_type, t.source_id)!.id;
}

function get(id: number) {
  using db = new RelayDB();
  return db.getTask(id)!;
}

function request(app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, path: string, method: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("schema v11", () => {
  test("records v11 and migrates a pre-v11 tasks table by adding user_overrides", () => {
    const raw = new Database(DB_PATH);
    const v = raw.prepare(`SELECT MAX(version) AS v FROM schema_version`).get() as { v: number };
    expect(v.v).toBeGreaterThanOrEqual(11);
    const cols = raw.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "user_overrides")).toBe(true);
    raw.close();
  });

  test("an old DB without the column gains it on open", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "relay-v10-"));
    const path = join(dir, "db.sqlite");
    const old = new Database(path);
    old.exec(`CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      repo TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      assignee TEXT NOT NULL DEFAULT 'self', priority INTEGER NOT NULL DEFAULT 50, prompt TEXT, files TEXT,
      context_hash TEXT, session_id TEXT, due_at TEXT, wait_on TEXT NOT NULL DEFAULT 'self',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, UNIQUE (source_type, source_id))`);
    old.exec(`INSERT INTO tasks (source_type, source_id, repo, title, created_at, updated_at)
              VALUES ('manual', 'm:1', 'r', 'legacy', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
    old.close();
    {
      using db = new RelayDB(path);
      const task = db.getTaskBySourceId("manual", "m:1")!;
      expect(task.user_overrides).toEqual([]);
      db.editTask(task.id, { priority: 70 });
      expect(db.getTask(task.id)!.user_overrides).toEqual(["priority"]);
    }
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("parseWhenInput", () => {
  // Wednesday 2026-11-04 15:30 local time.
  const now = new Date(2026, 10, 4, 15, 30);
  const midnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

  test("understands day shorthands as local midnight", () => {
    expect(parseWhenInput("today", now)).toBe(midnight(2026, 11, 4));
    expect(parseWhenInput("tomorrow", now)).toBe(midnight(2026, 11, 5));
    expect(parseWhenInput("+3d", now)).toBe(midnight(2026, 11, 7));
    expect(parseWhenInput("2w", now)).toBe(midnight(2026, 11, 18));
    expect(parseWhenInput("next-week", now)).toBe(midnight(2026, 11, 9));
    expect(parseWhenInput("fri", now)).toBe(midnight(2026, 11, 6));
    // Same weekday means next week, never today.
    expect(parseWhenInput("Wednesday", now)).toBe(midnight(2026, 11, 11));
  });

  test("hours are relative to now, absolute dates still work, junk is rejected", () => {
    expect(parseWhenInput("+4h", now)).toBe(new Date(now.getTime() + 4 * 3_600_000).toISOString());
    expect(parseWhenInput("2026-12-24", now)).toBe(midnight(2026, 12, 24));
    expect(parseWhenInput("month", now)).toBeNull();
    expect(parseWhenInput("someday", now)).toBeNull();
    expect(parseWhenInput("", now)).toBeNull();
  });
});

describe("parseTaskEdit", () => {
  const adapterTask = { source_type: "code_todo" as const };

  test("normalizes values and rejects unknown or dedicated fields", () => {
    const ok = parseTaskEdit({ title: "  New  ", priority: 140, files: "a.ts, b.ts,,a.ts", prompt: "  " }, adapterTask);
    expect(ok).toEqual({ ok: true, patch: { title: "New", priority: 100, files: ["a.ts", "b.ts"], prompt: null }, reset: [] });
    expect(parseTaskEdit({ priorty: 1 }, adapterTask)).toMatchObject({ ok: false });
    expect(parseTaskEdit({ status: "done" }, adapterTask)).toMatchObject({ ok: false });
    expect(parseTaskEdit({ title: "" }, adapterTask)).toMatchObject({ ok: false });
    expect(parseTaskEdit({ wait_on: "nobody" }, adapterTask)).toMatchObject({ ok: false });
    expect(parseTaskEdit({ due_at: "someday" }, adapterTask)).toMatchObject({ ok: false });
    expect(parseTaskEdit({}, adapterTask)).toMatchObject({ ok: false, error: "nothing to change" });
  });

  test("repo is only editable on manual tasks; set and reset of one field conflict", () => {
    expect(parseTaskEdit({ repo: "other" }, adapterTask)).toMatchObject({ ok: false });
    expect(parseTaskEdit({ repo: "other" }, { source_type: "manual" })).toMatchObject({ ok: true });
    expect(parseTaskEdit({ title: "x", reset: ["title"] }, adapterTask)).toMatchObject({ ok: false });
    expect(parseTaskEdit({ reset: "title,priority" }, adapterTask)).toMatchObject({ ok: true, reset: ["title", "priority"] });
  });
});

describe("PATCH /api/tasks/:id", () => {
  test("edits fields, locks them, and survives a re-sync of the same source", async () => {
    const t = input();
    const id = insert(t);
    const res = await request(createTasksApi(), `/${id}`, "PATCH", {
      title: "Rewritten by me",
      priority: 90,
      prompt: "fix the race in a.ts",
      wait_on: "external",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { changed: string[] };
    expect(json.changed.sort()).toEqual(["priority", "prompt", "title", "wait_on"]);

    // Upstream changes title + body; only the unlocked body should follow.
    using db = new RelayDB();
    const result = db.upsertTasks([{ ...t, title: "upstream title v2", body: "upstream body v2" }]);
    expect(result.updated).toBe(1);
    const after = db.getTask(id)!;
    expect(after.title).toBe("Rewritten by me");
    expect(after.priority).toBe(90);
    expect(after.prompt).toBe("fix the race in a.ts");
    expect(after.wait_on).toBe("external");
    expect(after.body).toBe("upstream body v2");
    expect(after.user_overrides?.sort()).toEqual(["priority", "prompt", "title", "wait_on"]);

    // A re-sync that only repeats locked-over values is a no-op.
    expect(db.upsertTasks([{ ...t, title: "upstream title v2", body: "upstream body v2" }]).unchanged).toBe(1);
  });

  test("reset hands a field back to the adapter on the next sync", async () => {
    const t = input();
    const id = insert(t);
    await request(createTasksApi(), `/${id}`, "PATCH", { title: "mine" });
    const res = await request(createTasksApi(), `/${id}`, "PATCH", { reset: ["title"] });
    expect(res.status).toBe(200);
    expect(get(id).user_overrides).toEqual([]);
    using db = new RelayDB();
    db.upsertTasks([{ ...t, title: "upstream again" }]);
    expect(db.getTask(id)!.title).toBe("upstream again");
  });

  test("undo and redo restore the edited fields and their locks", async () => {
    const id = insert(input({ priority: 40 }));
    await request(createTasksApi(), `/${id}`, "PATCH", { priority: 85, files: ["x.ts"] });
    expect(get(id)).toMatchObject({ priority: 85, files: ["x.ts"], user_overrides: ["priority", "files"] });

    const undo = await request(createUndoApi(), "/", "POST");
    expect(await undo.json()).toMatchObject({ undone: true, op_kind: "edit" });
    expect(get(id)).toMatchObject({ priority: 40, files: ["src/a.ts"], user_overrides: [] });

    const redo = await request(createUndoApi(), "/?redo=1", "POST");
    expect(await redo.json()).toMatchObject({ redone: true });
    expect(get(id)).toMatchObject({ priority: 85, files: ["x.ts"], user_overrides: ["priority", "files"] });
  });

  test("a no-op edit writes nothing and records no undo entry", async () => {
    const id = insert(input());
    const before = get(id);
    const res = await request(createTasksApi(), `/${id}`, "PATCH", { title: before.title });
    expect(((await res.json()) as { changed: string[] }).changed).toEqual([]);
    using db = new RelayDB();
    expect(db.listUndo(5)).toHaveLength(0);
    expect(db.getTask(id)!.updated_at).toBe(before.updated_at);
  });

  test("validation errors and missing tasks", async () => {
    const id = insert(input());
    expect((await request(createTasksApi(), `/${id}`, "PATCH", { priority: "high" })).status).toBe(400);
    expect((await request(createTasksApi(), `/${id}`, "PATCH", { repo: "elsewhere" })).status).toBe(400);
    expect((await request(createTasksApi(), `/999999`, "PATCH", { title: "x" })).status).toBe(404);
    expect((await request(createTasksApi(), `/abc`, "PATCH", { title: "x" })).status).toBe(400);
  });

  test("is reachable through the full app (CORS / host guards allow PATCH)", async () => {
    const id = insert(input());
    const app = buildApp();
    const res = await app.request(`http://127.0.0.1:7340/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ due_at: "tomorrow" }),
    });
    expect(res.status).toBe(200);
    expect(get(id).due_at).toBe(parseWhenInput("tomorrow"));
  });
});

describe("snooze until + auto-wake", () => {
  test("snoozes until a date and wakes once it passes", async () => {
    const id = insert(input());
    const res = await request(createTasksApi(), `/${id}/snooze`, "POST", { until: "+2d" });
    expect(res.status).toBe(200);
    const snoozed = get(id);
    expect(snoozed.status).toBe("snoozed");
    expect(snoozed.due_at).toBe(parseWhenInput("+2d"));

    using db = new RelayDB();
    expect(db.wakeSnoozed()).toEqual([]);
    expect(db.wakeSnoozed(new Date(Date.now() + 3 * 86_400_000))).toEqual([id]);
    expect(db.getTask(id)!.status).toBe("open");
  });

  test("indefinite snooze clears a past due date so it does not wake immediately", async () => {
    const id = insert(input({ due_at: "2020-01-01T00:00:00.000Z" }));
    await request(createTasksApi(), `/${id}/snooze`, "POST");
    using db = new RelayDB();
    expect(db.wakeSnoozed()).toEqual([]);
    expect(db.getTask(id)).toMatchObject({ status: "snoozed", due_at: null });
    // …and undo restores the original due date.
    const undo = await request(createUndoApi(), "/", "POST");
    expect(await undo.json()).toMatchObject({ undone: true });
    expect(db.getTask(id)).toMatchObject({ status: "open", due_at: "2020-01-01T00:00:00.000Z" });
  });

  test("rejects past or unparseable until values", async () => {
    const id = insert(input());
    expect((await request(createTasksApi(), `/${id}/snooze`, "POST", { until: "2020-01-01" })).status).toBe(400);
    expect((await request(createTasksApi(), `/${id}/snooze`, "POST", { until: "later" })).status).toBe(400);
    expect(get(id).status).toBe("open");
  });

  test("GET /api/today wakes expired snoozes before ranking", async () => {
    const id = insert(input());
    const raw = new Database(DB_PATH);
    raw.prepare(`UPDATE tasks SET status = 'snoozed', due_at = ? WHERE id = ?`).run("2020-01-01T00:00:00.000Z", id);
    raw.close();
    const res = await buildApp().request("http://127.0.0.1:7340/api/counts");
    expect(res.status).toBe(200);
    expect(get(id).status).toBe("open");
  });
});

describe("search + run history", () => {
  test("q matches title/body/prompt across statuses with status=all, and escapes LIKE wildcards", () => {
    const a = insert(input({ title: "Fix OAuth refresh" }));
    const b = insert(input({ title: "unrelated", prompt: "touch the oauth middleware" }));
    const c = insert(input({ title: "100% coverage" }));
    using db = new RelayDB();
    db.setStatus(b, "done");
    expect(db.listTasks({ q: "oauth" }).map((t) => t.id)).toEqual([a]);
    expect(db.listTasks({ q: "oauth", status: "all" }).map((t) => t.id).sort()).toEqual([a, b].sort());
    expect(db.listTasks({ q: "fix refresh" }).map((t) => t.id)).toEqual([a]);
    expect(db.listTasks({ q: "100%" }).map((t) => t.id)).toEqual([c]);
    expect(db.listTasks({ q: "%" }).map((t) => t.id)).toEqual([c]);
  });

  test("GET /api/tasks/:id/runs lists runs newest first", async () => {
    const id = insert(input());
    {
      using db = new RelayDB();
      const r1 = db.insertRun(id, "claude-code");
      db.finishRun(r1, "success", "done 1");
      db.insertRun(id, "codex");
    }
    const res = await request(createTasksApi(), `/${id}/runs`, "GET");
    const runs = (await res.json()) as Array<{ agent: string; status: string }>;
    expect(runs.map((r) => r.agent)).toEqual(["codex", "claude-code"]);
    expect(runs[1]?.status).toBe("success");
    expect((await request(createTasksApi(), `/999999/runs`, "GET")).status).toBe(404);
  });
});

describe("snapshot export/import carries overrides", () => {
  test("upsertSnapshot persists user_overrides", () => {
    using db = new RelayDB();
    const now = new Date().toISOString();
    db.upsertSnapshot([
      {
        source_type: "code_todo",
        source_id: "edit-repo:snap:1",
        repo: "edit-repo",
        title: "edited elsewhere",
        body: "",
        status: "open",
        assignee: "self",
        priority: 77,
        prompt: null,
        files: [],
        context_hash: null,
        session_id: null,
        due_at: null,
        wait_on: "self",
        created_at: now,
        updated_at: now,
        closed_at: null,
        user_overrides: ["title", "priority"],
      },
    ]);
    const task = db.getTaskBySourceId("code_todo", "edit-repo:snap:1")!;
    expect(task.user_overrides).toEqual(["title", "priority"]);
    db.upsertTasks([input({ source_id: "edit-repo:snap:1", title: "upstream", priority: 10 })]);
    expect(db.getTask(task.id)).toMatchObject({ title: "edited elsewhere", priority: 77 });
  });
});
