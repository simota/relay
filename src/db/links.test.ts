import "../test-setup.js";
import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyUndo } from "../api/undo.js";
import { buildPrompt, formatPrerequisites } from "../executor/index.js";
import { normalizeTag, normalizeTags } from "../lib/tags.js";
import { DB_PATH } from "../paths.js";
import { buildApp } from "../web/server.js";
import type { TaskInput } from "../types.js";
import { RelayDB } from "./client.js";

let seq = 0;

beforeEach(() => {
  new RelayDB().close();
  const raw = new Database(DB_PATH);
  raw.exec("DELETE FROM task_deps; DELETE FROM tasks; DELETE FROM undo_log; DELETE FROM views;");
  raw.close();
});

function input(overrides: Partial<TaskInput> = {}): TaskInput {
  seq += 1;
  return {
    source_type: "code_todo",
    source_id: `links-repo:src/a.ts:${seq}`,
    repo: "links-repo",
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

function insert(overrides: Partial<TaskInput> = {}): number {
  const t = input(overrides);
  using db = new RelayDB();
  db.upsertTasks([t]);
  return db.getTaskBySourceId(t.source_type, t.source_id)!.id;
}

async function call(path: string, method = "GET", body?: unknown) {
  const res = await buildApp().request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("schema v12", () => {
  test("records v12 with tasks.tags and task_deps", () => {
    const raw = new Database(DB_PATH);
    const v = raw.prepare(`SELECT MAX(version) AS v FROM schema_version`).get() as { v: number };
    expect(v.v).toBeGreaterThanOrEqual(12);
    const cols = raw.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "tags")).toBe(true);
    const deps = raw.prepare(`PRAGMA table_info(task_deps)`).all() as Array<{ name: string }>;
    expect(deps.map((c) => c.name)).toEqual(["task_id", "depends_on_id", "created_at"]);
    raw.close();
  });

  test("a pre-v12 DB gains tasks.tags on open", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-v12-"));
    const path = join(dir, "db.sqlite");
    const raw = new Database(path);
    raw.exec(`CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      repo TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      assignee TEXT NOT NULL DEFAULT 'self', priority INTEGER NOT NULL DEFAULT 50, prompt TEXT, files TEXT,
      context_hash TEXT, session_id TEXT, due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      closed_at TEXT, UNIQUE (source_type, source_id))`);
    raw.exec(`INSERT INTO tasks (source_type, source_id, repo, title, created_at, updated_at)
              VALUES ('manual', 'm:1', 'r', 'old', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
    raw.close();
    const db = new RelayDB(path);
    const task = db.listAllTasks()[0]!;
    expect(task.tags).toEqual([]);
    expect(db.setTags(task.id, ["legacy"])?.after).toEqual(["legacy"]);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("tags", () => {
  test("normalizeTag lowercases, strips #, and rejects junk", () => {
    expect(normalizeTag("  #Billing ")).toBe("billing");
    expect(normalizeTag("release/v2.1")).toBe("release/v2.1");
    expect(normalizeTag("顧客A")).toBe("顧客a");
    expect(normalizeTag("has space")).toBeNull();
    expect(normalizeTag("-leading")).toBeNull();
    expect(normalizeTag("x".repeat(41))).toBeNull();
    expect(normalizeTags(["A", "a", "#b", "bad tag"])).toEqual({ tags: ["a", "b"], invalid: ["bad tag"] });
  });

  test("set / bulk edit / filter / counts", () => {
    const a = insert();
    const b = insert();
    const c = insert({ status: "done" });
    using db = new RelayDB();
    expect(db.setTags(a, ["Billing", "urgent"])?.after).toEqual(["billing", "urgent"]);
    const changes = db.bulkEditTags([a, b, c], { add: ["billing"], remove: ["urgent"] });
    expect(changes.map((ch) => ch.id).sort()).toEqual([a, b, c].sort());
    expect(db.getTask(a)!.tags).toEqual(["billing"]);
    expect(db.listTasks({ tag: "billing" }).map((t) => t.id).sort()).toEqual([a, b].sort());
    expect(db.listTasks({ tag: "billing", status: "all" })).toHaveLength(3);
    expect(db.listTagCounts()).toEqual([{ tag: "billing", open: 2, total: 3 }]);
    // No-op edits write nothing.
    expect(db.bulkEditTags([a], { add: ["billing"] })).toEqual([]);
  });

  test("tags survive an adapter re-sync of the same task", () => {
    const t = input({ title: "upstream v1" });
    using db = new RelayDB();
    db.upsertTasks([t]);
    const id = db.getTaskBySourceId(t.source_type, t.source_id)!.id;
    db.setTags(id, ["keep-me"]);
    db.upsertTasks([{ ...t, title: "upstream v2" }]);
    const after = db.getTask(id)!;
    expect(after.title).toBe("upstream v2");
    expect(after.tags).toEqual(["keep-me"]);
  });

  test("saved views filter by tag", () => {
    const a = insert();
    insert();
    using db = new RelayDB();
    db.setTags(a, ["focus"]);
    const view = db.createView({ name: "focus", filter: { tag: "#Focus" } });
    expect(view.filter).toEqual({ tag: "focus" });
    expect(view.count).toBe(1);
  });

  test("API: PUT tags, bulk tags, filter, /api/tags, and undo/redo", async () => {
    const a = insert();
    const b = insert();
    const put = await call(`/api/tasks/${a}/tags`, "PUT", { tags: ["ops", "#Q4"] });
    expect(put.status).toBe(200);
    expect(put.json.tags).toEqual(["ops", "q4"]);
    expect((await call(`/api/tasks/${a}/tags`, "PUT", { tags: ["bad tag"] })).status).toBe(400);
    const bulk = await call(`/api/tasks/bulk/tags`, "POST", { ids: [a, b], add: ["ops"], remove: ["q4"] });
    expect(bulk.json).toEqual({ ok: true, count: 2 });
    const list = await call(`/api/tasks?tag=ops`);
    expect(list.json.map((t: { id: number }) => t.id).sort()).toEqual([a, b].sort());
    expect((await call(`/api/tags`)).json).toEqual([{ tag: "ops", open: 2, total: 2 }]);

    using db = new RelayDB();
    const undone = applyUndo(db, false);
    expect(undone).toMatchObject({ ok: true, op_kind: "tags", undone: true });
    expect(db.getTask(a)!.tags).toEqual(["ops", "q4"]);
    expect(db.getTask(b)!.tags).toEqual([]);
    applyUndo(db, true);
    expect(db.getTask(a)!.tags).toEqual(["ops"]);
    expect(db.getTask(b)!.tags).toEqual(["ops"]);
  });
});

describe("dependencies", () => {
  test("rejects self, unknown ids, and cycles (with the cycle path)", () => {
    const a = insert();
    const b = insert();
    const c = insert();
    using db = new RelayDB();
    expect(db.addDependency(a, a)).toMatchObject({ ok: false, error: "self" });
    expect(db.addDependency(a, 999_999)).toMatchObject({ ok: false, error: "not_found" });
    expect(db.addDependency(b, a)).toEqual({ ok: true, added: true });
    expect(db.addDependency(c, b)).toEqual({ ok: true, added: true });
    expect(db.addDependency(c, b)).toEqual({ ok: true, added: false });
    const cycle = db.addDependency(a, c);
    expect(cycle).toMatchObject({ ok: false, error: "cycle" });
    if (!cycle.ok) expect(cycle.path).toEqual([c, b, a]);
  });

  test("Today hides dependency-blocked tasks until the blocker is done", () => {
    const blocker = insert({ title: "migrate schema", priority: 40 });
    const dependent = insert({ title: "ship UI", priority: 90 });
    using db = new RelayDB();
    db.addDependency(dependent, blocker);
    expect(db.today(50).map((t) => t.id)).toEqual([blocker]);
    expect(db.viewCounts()).toMatchObject({ today: 1, open: 2, dep_blocked: 1 });
    expect(db.blockedTasks(10).map((t) => t.id)).toContain(dependent);
    expect(db.selfDrivenTasks(10).map((t) => t.id)).toEqual([blocker]);
    expect(db.listTasks({ blocked: true }).map((t) => t.id)).toEqual([dependent]);
    expect([...db.openBlockerMap()]).toEqual([[dependent, [blocker]]]);
    db.setStatus(blocker, "done");
    expect(db.today(50).map((t) => t.id)).toEqual([dependent]);
    expect(db.viewCounts().dep_blocked).toBe(0);
    expect(db.openBlockerMap().size).toBe(0);
  });

  test("deleting a task drops its edges", () => {
    const a = insert();
    const b = insert();
    using db = new RelayDB();
    db.addDependency(b, a);
    db.batchDeleteTasks([a]);
    expect(db.blockerIdsOf(b)).toEqual([]);
  });

  test("API: add / list / remove, cycle → 409, undo / redo", async () => {
    const a = insert();
    const b = insert();
    const c = insert();
    const added = await call(`/api/tasks/${b}/deps`, "POST", { depends_on: [a] });
    expect(added.status).toBe(200);
    expect(added.json.blocked_by.map((t: { id: number }) => t.id)).toEqual([a]);
    expect(added.json.open_blocker_ids).toEqual([a]);
    await call(`/api/tasks/${c}/deps`, "POST", { depends_on: b });
    const cycle = await call(`/api/tasks/${a}/deps`, "POST", { depends_on: c });
    expect(cycle.status).toBe(409);
    expect(cycle.json.code).toBe("cycle");
    expect((await call(`/api/tasks/${a}/deps`, "POST", { depends_on: a })).status).toBe(400);
    expect((await call(`/api/tasks/${a}/deps`, "POST", { depends_on: 999_999 })).status).toBe(404);

    const info = await call(`/api/tasks/${b}/deps`);
    expect(info.json.blocks.map((t: { id: number }) => t.id)).toEqual([c]);
    const blocked = await call(`/api/deps/blocked`);
    expect(blocked.json).toEqual({ [b]: [a], [c]: [b] });

    const removed = await call(`/api/tasks/${b}/deps/${a}`, "DELETE");
    expect(removed.json.removed).toBe(true);
    expect(removed.json.blocked_by).toEqual([]);

    using db = new RelayDB();
    expect(applyUndo(db, false)).toMatchObject({ op_kind: "deps", undone: true, count: 1 });
    expect(db.blockerIdsOf(b)).toEqual([a]);
    expect(applyUndo(db, true)).toMatchObject({ op_kind: "deps", redone: true, count: 1 });
    expect(db.blockerIdsOf(b)).toEqual([]);
  });

  test("POST /api/tasks accepts tags and blocked_by", async () => {
    const blocker = insert();
    const created = await call(`/api/tasks`, "POST", {
      repo: "links-repo",
      title: "follow-up",
      tags: ["Launch"],
      blocked_by: [blocker],
    });
    expect(created.status).toBe(201);
    expect(created.json.tags).toEqual(["launch"]);
    using db = new RelayDB();
    expect(db.blockerIdsOf(created.json.id)).toEqual([blocker]);
    expect((await call(`/api/tasks`, "POST", { repo: "r", title: "x", blocked_by: [999_999] })).status).toBe(404);
  });

  test("prerequisites are rendered into the agent prompt", () => {
    const text = formatPrerequisites(
      [
        { id: 3, title: "migrate schema", repo: "api", status: "done" },
        { id: 4, title: "seed data", repo: "web", status: "open" },
      ],
      "api",
    );
    expect(text).toContain("- #3 [done] migrate schema");
    expect(text).toContain("- #4 [not done: open] seed data (repo: web)");
    const prompt = buildPrompt("do it", undefined, undefined, text)!;
    expect(prompt.startsWith("# Prerequisite tasks")).toBe(true);
    expect(prompt.endsWith("do it")).toBe(true);
    expect(formatPrerequisites([], "api")).toBe("");
  });
});

describe("snapshot export / import", () => {
  test("tags and dependencies round-trip by source key", async () => {
    const a = insert({ source_type: "manual", source_id: "manual:snap:a" });
    const b = insert({ source_type: "manual", source_id: "manual:snap:b" });
    {
      using db = new RelayDB();
      db.setTags(a, ["snap"]);
      db.addDependency(b, a);
    }
    const dir = mkdtempSync(join(tmpdir(), "relay-snap-"));
    const file = join(dir, "snap.json");
    const { runExport } = await import("../commands/export.js");
    const log = console.log;
    console.log = () => {};
    try {
      runExport({ file });
      const payload = JSON.parse(readFileSync(file, "utf8"));
      expect(payload.dependencies).toEqual([
        {
          task: { source_type: "manual", source_id: "manual:snap:b" },
          depends_on: { source_type: "manual", source_id: "manual:snap:a" },
        },
      ]);
      const raw = new Database(DB_PATH);
      raw.exec("DELETE FROM task_deps; DELETE FROM tasks;");
      raw.close();
      const { runImport } = await import("../commands/import.js");
      await runImport({ from: "relay", file });
    } finally {
      console.log = log;
      rmSync(dir, { recursive: true, force: true });
    }
    using db = new RelayDB();
    const na = db.getTaskBySourceId("manual", "manual:snap:a")!;
    const nb = db.getTaskBySourceId("manual", "manual:snap:b")!;
    expect(na.tags).toEqual(["snap"]);
    expect(db.blockerIdsOf(nb.id)).toEqual([na.id]);
  });
});
