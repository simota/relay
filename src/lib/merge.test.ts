import "../test-setup.js";
import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { applyUndo } from "../api/undo.js";
import { RelayDB } from "../db/client.js";
import { DB_PATH } from "../paths.js";
import { buildApp } from "../web/server.js";
import type { TaskInput } from "../types.js";
import { mergeTasks } from "./merge.js";

let seq = 0;

beforeEach(() => {
  new RelayDB().close();
  const raw = new Database(DB_PATH);
  raw.exec("DELETE FROM task_notes; DELETE FROM task_deps; DELETE FROM queue_items; DELETE FROM tasks; DELETE FROM undo_log;");
  raw.close();
});

function insert(overrides: Partial<TaskInput> = {}): number {
  seq += 1;
  const t: TaskInput = {
    source_type: "code_todo",
    source_id: `merge-${seq}-${Math.random().toString(36).slice(2)}`,
    repo: "merge-repo",
    title: `fix login redirect ${seq}`,
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

describe("mergeTasks", () => {
  test("closes duplicates and moves tags, dependencies, notes and queue state onto the survivor", () => {
    const keep = insert({ source_type: "github_issue" });
    const dup = insert();
    const blocker = insert({ title: "upgrade auth lib" });
    const waiter = insert({ title: "ship release" });
    using db = new RelayDB();
    db.setTags(keep, ["auth"]);
    db.setTags(dup, ["auth", "urgent"]);
    db.addDependency(dup, blocker); // dup waits on blocker
    db.addDependency(waiter, dup); // waiter waits on dup
    db.addNote(dup, "repro: log in with SSO");
    db.addQueueItem(dup);

    const result = mergeTasks(db, keep, [dup]);
    expect(result).toMatchObject({ ok: true, merged: [dup], tags_added: ["urgent"], deps_moved: 2, notes_copied: 1, dequeued: 1 });
    expect(db.getTask(dup)!.status).toBe("done");
    expect(db.getTask(keep)!.tags).toEqual(["auth", "urgent"]);
    expect(db.blockerIdsOf(keep)).toEqual([blocker]);
    // The waiter must stay blocked: it now waits on the survivor.
    expect(db.openBlockerMap().get(waiter)).toEqual([keep]);
    const notes = db.listNotes(keep).map((n) => n.body);
    expect(notes[0]).toBe(`[from #${dup}] repro: log in with SSO`);
    expect(notes[1]).toContain(`#${dup} `);
    expect(db.listQueueItems()).toEqual([]);
  });

  test("one undo reverts the merge; redo re-applies it", () => {
    const keep = insert();
    const dup = insert();
    const waiter = insert();
    using db = new RelayDB();
    db.addDependency(waiter, dup);
    db.setTags(dup, ["x"]);
    mergeTasks(db, keep, [dup]);

    expect(applyUndo(db, false)).toMatchObject({ ok: true, op_kind: "merge", undone: true });
    expect(db.getTask(dup)!.status).toBe("open");
    expect(db.getTask(keep)!.tags).toEqual([]);
    expect(db.listNotes(keep)).toEqual([]);
    expect(db.openBlockerMap().get(waiter)).toEqual([dup]);

    expect(applyUndo(db, true)).toMatchObject({ ok: true, op_kind: "merge", redone: true });
    expect(db.getTask(dup)!.status).toBe("done");
    expect(db.getTask(keep)!.tags).toEqual(["x"]);
    expect(db.listNotes(keep)).toHaveLength(1);
    expect(db.openBlockerMap().get(waiter)).toEqual([keep]);
  });

  test("rejects bad input and skips cyclic dependency moves", () => {
    const keep = insert();
    const dup = insert();
    using db = new RelayDB();
    expect(mergeTasks(db, 999_999, [dup])).toMatchObject({ ok: false, status: 404 });
    expect(mergeTasks(db, keep, [keep])).toMatchObject({ ok: false, status: 400 });
    expect(mergeTasks(db, keep, [dup, 999_998])).toMatchObject({ ok: false, status: 404 });
    // dup waits on keep: moving that edge would be keep→keep; skipped.
    db.addDependency(dup, keep);
    expect(mergeTasks(db, keep, [dup])).toMatchObject({ ok: true, deps_moved: 0 });
  });

  test("POST /api/tasks/:id/merge", async () => {
    const keep = insert();
    const dup = insert();
    const app = buildApp();
    const post = (path: string, body: unknown) =>
      app.request(`http://127.0.0.1:7340${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post(`/api/tasks/${keep}/merge`, { ids: [] })).status).toBe(400);
    expect((await post(`/api/tasks/${keep}/merge`, { ids: [999_999] })).status).toBe(404);
    const res = await post(`/api/tasks/${keep}/merge`, { ids: [dup] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, keep, merged: [dup], task: { id: keep } });
  });
});
