import "../test-setup.js";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyUndo } from "../api/undo.js";
import { runSync } from "../commands/sync.js";
import { ConfigSchema, type Config } from "../config.js";
import { RelayDB } from "../db/client.js";
import { CONFIG_PATH, DB_PATH, RELAY_HOME } from "../paths.js";
import { buildApp } from "../web/server.js";
import type { TaskInput } from "../types.js";
import { applyRules, compileRules, globToRegExp, resolveActions } from "./rules.js";

let seq = 0;
let originalConfig: string | null = null;

beforeAll(() => {
  originalConfig = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : null;
});

afterAll(() => {
  if (originalConfig !== null) writeFileSync(CONFIG_PATH, originalConfig);
  else writeFileSync(CONFIG_PATH, "");
});

beforeEach(() => {
  new RelayDB().close();
  const raw = new Database(DB_PATH);
  raw.exec("DELETE FROM queue_items; DELETE FROM tasks; DELETE FROM undo_log;");
  raw.close();
});

function rules(raw: unknown[]): Config["rules"] {
  return ConfigSchema.parse({ rules: raw }).rules;
}

function insert(overrides: Partial<TaskInput> = {}): number {
  seq += 1;
  const t: TaskInput = {
    source_type: "code_todo",
    source_id: `rules-${seq}-${Math.random().toString(36).slice(2)}`,
    repo: "billing-api",
    title: `TODO thing ${seq}`,
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
  using db = new RelayDB();
  db.upsertTasks([t]);
  return db.getTaskBySourceId(t.source_type, t.source_id)!.id;
}

describe("compileRules", () => {
  test("accepts string-or-list fields and reports bad rules without throwing", () => {
    const compiled = compileRules(
      rules([
        { name: "ok", repo: "billing-*", source: ["code_todo"], title: "FIXME", tag: "Security", assign: "codex" },
        { name: "bad regex", title: "(", tag: "x" },
        { name: "bad assignee", source: "code_todo", assign: "robot" },
        { name: "no match", tag: "x" },
        { name: "no action", title: "x" },
        { name: "unknown source", source: "jira", tag: "x" },
        { name: "off", enabled: false, title: "x", tag: "x" },
      ]),
    );
    expect(compiled.rules.map((r) => r.name)).toEqual(["ok"]);
    expect(compiled.rules[0]!.actions.tags).toEqual(["security"]);
    expect(compiled.errors.map((e) => e.name)).toEqual(["bad regex", "bad assignee", "no match", "no action", "unknown source"]);
    expect(compiled.errors.find((e) => e.name === "bad assignee")?.message).toContain("assign");
    expect(compiled.disabled).toBe(1);
  });

  test("globToRegExp anchors and escapes", () => {
    expect(globToRegExp("billing-*").test("billing-api")).toBe(true);
    expect(globToRegExp("billing-*").test("old-billing-api")).toBe(false);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
    expect(globToRegExp("ap?").test("API")).toBe(true);
  });

  test("resolveActions merges in order: later scalars win, tags union, stop halts", () => {
    const { rules: compiled } = compileRules(
      rules([
        { repo: "*", tag: ["a"], priority: 60 },
        { title: "urgent", tag: ["b"], priority: 90, stop: true },
        { repo: "*", tag: ["c"], assign: "codex" },
      ]),
    );
    const urgent = resolveActions(compiled, { repo: "x", source_type: "code_todo", title: "Urgent fix", body: "" });
    expect(urgent.actions).toMatchObject({ tags: ["a", "b"], priority: 90 });
    expect(urgent.actions.assign).toBeUndefined();
    const normal = resolveActions(compiled, { repo: "x", source_type: "code_todo", title: "later", body: "" });
    expect(normal.actions).toMatchObject({ tags: ["a", "c"], priority: 60, assign: "codex" });
  });
});

describe("applyRules", () => {
  const compiled = () =>
    compileRules(
      rules([
        { name: "fixme", repo: "billing-*", title: "FIXME", tag: ["security"], assign: "codex", priority: 85, queue: true },
        { name: "external", body: "waiting on vendor", wait_on: "external" },
      ]),
    ).rules;

  test("dry run reports changes without writing; real run writes, locks and is idempotent", () => {
    const hit = insert({ title: "FIXME: sanitize input" });
    const vendor = insert({ repo: "other", title: "ping", body: "waiting on vendor reply" });
    const miss = insert({ repo: "other", title: "FIXME elsewhere" });
    const done = insert({ title: "FIXME old", status: "done" });

    using db = new RelayDB();
    const all = () => db.getTasksByIds([hit, vendor, miss, done]);
    const dry = applyRules(db, compiled(), all(), { dryRun: true });
    expect(dry.changes.map((c) => c.id)).toEqual([hit, vendor]);
    expect(dry.totals).toEqual({ tagged: 1, assigned: 1, reprioritized: 1, wait_on: 1, queued: 1 });
    expect(db.getTask(hit)!.assignee).toBe("self");
    expect(db.listQueueItems()).toEqual([]);

    const real = applyRules(db, compiled(), all(), { recordUndo: true });
    expect(real.changes).toHaveLength(2);
    const t = db.getTask(hit)!;
    expect(t).toMatchObject({ assignee: "codex", priority: 85, tags: ["security"] });
    expect(t.user_overrides).toContain("priority");
    expect(db.getTask(vendor)!.wait_on).toBe("external");
    expect(db.listQueueItems().map((q) => q.task_id)).toEqual([hit]);

    // Second pass: nothing left to change.
    expect(applyRules(db, compiled(), all(), { recordUndo: true }).changes).toEqual([]);

    // A re-sync keeps the rule's priority (locked like a user edit).
    db.upsertTasks([{ ...(t as unknown as TaskInput), priority: 50 }]);
    expect(db.getTask(hit)!.priority).toBe(85);
  });

  test("one undo reverts the whole application; redo re-applies it", () => {
    const hit = insert({ title: "FIXME: sanitize" });
    using db = new RelayDB();
    applyRules(db, compiled(), db.getTasksByIds([hit]), { recordUndo: true });
    expect(applyUndo(db, false)).toMatchObject({ ok: true, op_kind: "rules_apply", undone: true });
    expect(db.getTask(hit)).toMatchObject({ assignee: "self", priority: 50, tags: [] });
    expect(db.getTask(hit)!.user_overrides ?? []).not.toContain("priority");
    expect(applyUndo(db, true)).toMatchObject({ ok: true, op_kind: "rules_apply", redone: true });
    expect(db.getTask(hit)).toMatchObject({ assignee: "codex", priority: 85, tags: ["security"] });
  });
});

describe("rules in sync and the API", () => {
  test("sync triages only the tasks it newly ingests", async () => {
    const root = join(RELAY_HOME, "rules-roots");
    mkdirSync(join(root, "billing-web", ".agents"), { recursive: true });
    writeFileSync(join(root, "billing-web", ".agents", "plan.md"), "- [ ] FIXME rotate the webhook secret\n- [ ] write docs\n");
    writeFileSync(
      CONFIG_PATH,
      [
        "[scan]",
        `roots = [${JSON.stringify(root)}]`,
        "[[rules]]",
        'name = "fixme"',
        'repo = "billing-*"',
        'title = "FIXME"',
        'tag = ["security"]',
        'assign = "codex"',
        "[[rules]]",
        'name = "broken"',
        'title = "("',
        'tag = "x"',
        "",
      ].join("\n"),
    );
    // A pre-existing task that matches must not be touched by sync.
    const old = insert({ repo: "billing-web", title: "FIXME pre-existing", source_type: "manual" });

    const report = await runSync({ source: "agents_note", silent: true });
    expect(report.rules).toMatchObject({ changed: 1, errors: 1, totals: { tagged: 1, assigned: 1 } });
    using db = new RelayDB();
    const tasks = db.listTasks({ repo: "billing-web" });
    const fixme = tasks.find((t) => t.title.includes("rotate"))!;
    expect(fixme).toMatchObject({ assignee: "codex", tags: ["security"] });
    expect(tasks.find((t) => t.title === "write docs")!.assignee).not.toBe("codex");
    expect(db.getTask(old)!.assignee).toBe("self");

    // GET /api/rules lists live match counts; POST /apply catches the old task.
    const app = buildApp();
    const overview = (await (await app.request("http://127.0.0.1:7340/api/rules")).json()) as any;
    expect(overview.rules[0]).toMatchObject({ name: "fixme", matching: 2 });
    expect(overview.errors[0].name).toBe("broken");
    const post = (dryRun: boolean) =>
      app.request("http://127.0.0.1:7340/api/rules/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
    const preview = (await (await post(true)).json()) as any;
    expect(preview.changes.map((c: { id: number }) => c.id)).toEqual([old]);
    expect(db.getTask(old)!.assignee).toBe("self");
    const applied = (await (await post(false)).json()) as any;
    expect(applied.changes).toHaveLength(1);
    expect(db.getTask(old)!.assignee).toBe("codex");
  });
});
