import "../test-setup.js";
import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyUndo } from "../api/undo.js";
import { buildPrompt, formatNotes, resolveCommand, withResumeNotes } from "../executor/index.js";
import { resolveHeadlessCommand } from "../executor/headless.js";
import { runExport } from "../commands/export.js";
import { runImport } from "../commands/import.js";
import { runNote } from "../commands/notes.js";
import { DB_PATH, RELAY_HOME } from "../paths.js";
import { buildApp } from "../web/server.js";
import type { TaskInput } from "../types.js";
import { MAX_NOTE_LENGTH, RelayDB, normalizeNoteBody } from "./client.js";

let seq = 0;

beforeEach(() => {
  new RelayDB().close();
  const raw = new Database(DB_PATH);
  raw.exec("DELETE FROM task_notes; DELETE FROM queue_items; DELETE FROM tasks; DELETE FROM undo_log;");
  raw.close();
});

function insert(overrides: Partial<TaskInput> = {}): number {
  seq += 1;
  const t: TaskInput = {
    source_type: "manual",
    source_id: `notes-${seq}-${Math.random().toString(36).slice(2)}`,
    repo: "notes-repo",
    title: `task ${seq}`,
    body: "",
    status: "open",
    assignee: "claude-code",
    priority: 50,
    prompt: "fix the bug",
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

async function call(path: string, method = "GET", body?: unknown) {
  const res = await buildApp().request(`http://127.0.0.1:7340${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("schema v14", () => {
  test("records v14 and creates task_notes", () => {
    using db = new RelayDB();
    const raw = new Database(DB_PATH);
    const versions = (raw.prepare("SELECT version FROM schema_version").all() as Array<{ version: number }>).map((r) => r.version);
    const table = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_notes'").get();
    raw.close();
    expect(versions).toContain(14);
    expect(table).toBeTruthy();
    expect(db.listNotes(1)).toEqual([]);
  });
});

describe("task notes store", () => {
  test("adds, lists oldest-first, deletes, and cascades with the task", () => {
    const id = insert();
    using db = new RelayDB();
    const a = db.addNote(id, "first", new Date("2026-01-01T00:00:00Z"))!;
    const b = db.addNote(id, "second", new Date("2026-01-02T00:00:00Z"))!;
    expect(db.listNotes(id).map((n) => n.body)).toEqual(["first", "second"]);
    expect(db.noteCounts([id, 999_999]).get(id)).toBe(2);
    expect(db.deleteNote(a.id)?.body).toBe("first");
    expect(db.listNotes(id).map((n) => n.id)).toEqual([b.id]);
    expect(db.addNote(999_999, "orphan")).toBeNull();
    db.batchDeleteTasks([id]);
    expect(db.getNote(b.id)).toBeNull();
  });

  test("normalizeNoteBody trims, rejects blanks and caps length", () => {
    expect(normalizeNoteBody("  hi \r\n there  ")).toBe("hi \n there");
    expect(normalizeNoteBody("   \n ")).toBeNull();
    expect(normalizeNoteBody("x".repeat(MAX_NOTE_LENGTH + 50))?.length).toBe(MAX_NOTE_LENGTH);
  });

  test("undo restores a deleted note with its id; redo deletes it again", () => {
    const id = insert();
    runNote(id, { text: "keep me" });
    using db = new RelayDB();
    const [note] = db.listNotes(id);
    runNote(id, { text: "", remove: note!.id });
    expect(db.listNotes(id)).toEqual([]);
    expect(applyUndo(db, false)).toMatchObject({ ok: true, op_kind: "notes", undone: true });
    expect(db.listNotes(id)).toEqual([note!]);
    expect(applyUndo(db, true)).toMatchObject({ ok: true, op_kind: "notes", redone: true });
    expect(db.listNotes(id)).toEqual([]);
    // Undo the delete, then undo the add: the note is gone again.
    applyUndo(db, false);
    expect(applyUndo(db, false)).toMatchObject({ op_kind: "notes", undone: true });
    expect(db.listNotes(id)).toEqual([]);
  });

  test("relay note --queue queues open tasks but never done ones", () => {
    const open = insert();
    const done = insert({ status: "done" });
    runNote(open, { text: "retry with the fixture", queue: true });
    runNote(done, { text: "too late", queue: true });
    using db = new RelayDB();
    expect(db.listQueueItems().map((q) => q.task_id)).toEqual([open]);
    expect(db.listNotes(done)).toHaveLength(1);
  });
});

describe("notes in the agent prompt", () => {
  test("formatNotes keeps the newest notes, oldest first, and indents multi-line notes", () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({
      body: i === 11 ? "line one\nline two" : `note ${i}`,
      created_at: `2026-01-${String(i + 1).padStart(2, "0")}T09:30:00.000Z`,
    }));
    const text = formatNotes(notes);
    expect(text).toContain("(2 older notes omitted)");
    expect(text).not.toContain("note 1\n");
    expect(text).toContain("- [2026-01-03 09:30] note 2");
    expect(text).toContain("- [2026-01-12 09:30] line one\n  line two");
    expect(formatNotes([])).toBe("");
  });

  test("buildPrompt puts notes after the task prompt", () => {
    const prompt = buildPrompt("do the thing", undefined, "TEMPLATE", undefined, "NOTES");
    expect(prompt).toBe("TEMPLATE\n\n---\n\ndo the thing\n\n---\n\n# Notes from the user\n\nNOTES");
    expect(buildPrompt(null, undefined, undefined, undefined, "only notes")).toContain("only notes");
    expect(withResumeNotes(null, undefined)).toBeNull();
    expect(withResumeNotes("go", "n")).toBe("go\n\n---\n\n# Notes from the user\n\nn");
  });

  test("interactive and headless launches carry notes, including resumes", () => {
    using db = new RelayDB();
    const task = db.getTask(insert({ session_id: "sess-1", assignee: "codex" }))!;
    const resumed = resolveCommand(task, { task, repoRoot: "/tmp", notes: "N1" });
    expect(resumed.args).toEqual(["resume", "sess-1", "fix the bug\n\n---\n\n# Notes from the user\n\nN1"]);
    const fresh = resolveCommand(task, { task, repoRoot: "/tmp", notes: "N1", noResume: true });
    expect(fresh.args[0]).toContain("# Notes from the user\n\nN1");
    const headless = resolveHeadlessCommand({ ...task, assignee: "claude-code" }, { task, repoRoot: "/tmp", notes: "N2" });
    expect(headless.args.at(-1)).toContain("# Notes from the user\n\nN2");
  });
});

test("a task without its own prompt still tells the agent what the task is when notes exist", () => {
  using db = new RelayDB();
  const task = db.getTask(insert({ prompt: null, title: "rotate webhook secret" }))!;
  expect(resolveCommand(task, { task, repoRoot: "/tmp" }).args).toEqual([]);
  const [prompt] = resolveCommand(task, { task, repoRoot: "/tmp", notes: "use vault" }).args;
  expect(prompt).toContain("Work on this task in the current repository: rotate webhook secret");
  expect(prompt).toContain("# Notes from the user\n\nuse vault");
});

describe("notes API", () => {
  test("POST / GET / DELETE round-trip with validation and queue", async () => {
    const id = insert();
    expect((await call(`/api/tasks/${id}/notes`, "POST", { body: "   " })).status).toBe(400);
    expect((await call(`/api/tasks/${id}/notes`, "POST", {})).status).toBe(400);
    expect((await call(`/api/tasks/999999/notes`, "POST", { body: "x" })).status).toBe(404);

    const created = await call(`/api/tasks/${id}/notes`, "POST", { body: " try pkg/x ", queue: true });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ task_id: id, body: "try pkg/x", queued: true });

    const list = await call(`/api/tasks/${id}/notes`);
    expect(list.json.map((n: { body: string }) => n.body)).toEqual(["try pkg/x"]);
    {
      using db = new RelayDB();
      expect(db.listQueueItems().map((q) => q.task_id)).toEqual([id]);
    }

    const other = insert();
    expect((await call(`/api/tasks/${other}/notes/${created.json.id}`, "DELETE")).status).toBe(404);
    const removed = await call(`/api/tasks/${id}/notes/${created.json.id}`, "DELETE");
    expect(removed.json).toMatchObject({ ok: true });
    expect((await call(`/api/tasks/${id}/notes`)).json).toEqual([]);
  });
});

describe("notes in snapshots", () => {
  test("export → import carries notes and re-import does not duplicate", () => {
    const id = insert({ source_id: "notes-snapshot-task" });
    runNote(id, { text: "carried across machines" });
    const file = join(RELAY_HOME, "notes-snapshot.json");
    runExport({ file });
    const payload = JSON.parse(readFileSync(file, "utf8"));
    expect(payload.notes).toHaveLength(1);

    {
      const raw = new Database(DB_PATH);
      raw.exec("DELETE FROM task_notes;");
      raw.close();
    }
    writeFileSync(file, JSON.stringify(payload));
    runImport({ from: "relay", file });
    runImport({ from: "relay", file });
    using db = new RelayDB();
    expect(db.listNotes(id).map((n) => n.body)).toEqual(["carried across machines"]);
  });
});
