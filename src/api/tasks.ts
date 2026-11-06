import { Hono } from "hono";
import { RelayDB } from "../db/client.js";
import { parseWhenInput, WHEN_INPUT_HINT } from "../lib/due-date.js";
import { parseTaskEdit } from "../lib/task-edit.js";
import { Assignee, type Task } from "../types.js";

interface BulkBody {
  ids?: unknown;
  until?: unknown;
}

export function createTasksApi() {
  const app = new Hono();

  app.post("/bulk/snooze", async (c) => {
    const body = (await c.req.json().catch(() => null)) as BulkBody | null;
    const ids = parseIds(body?.ids);
    const until = typeof body?.until === "string" ? parseWhenInput(body.until) : null;
    if (!ids) return c.json({ error: "ids must be positive integers" }, 400);
    if (!until) {
      return c.json({ error: `until must be ${WHEN_INPUT_HINT}` }, 400);
    }

    using db = new RelayDB();
    // bulkSnooze skips done rows and rows already snoozed until `until`;
    // snapshot exactly the rows it changes.
    const tasks = db
      .getTasksByIds(ids)
      .filter((task) => task.status !== "done" && !(task.status === "snoozed" && task.due_at === until));
    const count = db.bulkSnooze(ids, until);
    if (count > 0) {
      db.recordUndo({
        op_kind: "bulk_snooze",
        payload: { tasks: tasks.map((task) => ({ ...snapshotTask(task), status: "snoozed", due_at: until, closed_at: null })) },
        inverse: { tasks: tasks.map(snapshotTask) },
      });
    }
    return c.json({ ok: true, count });
  });

  app.post("/bulk/close", async (c) => {
    const body = (await c.req.json().catch(() => null)) as BulkBody | null;
    const ids = parseIds(body?.ids);
    if (!ids) return c.json({ error: "ids must be positive integers" }, 400);

    using db = new RelayDB();
    // bulkClose skips already-done rows; snapshot exactly the rows it changes.
    const tasks = db.getTasksByIds(ids).filter((task) => task.status !== "done");
    const count = db.bulkClose(ids);
    if (count > 0) {
      const now = new Date().toISOString();
      db.recordUndo({
        op_kind: "bulk_close",
        payload: { tasks: tasks.map((task) => ({ ...snapshotTask(task), status: "done", closed_at: now })) },
        inverse: { tasks: tasks.map(snapshotTask) },
      });
    }
    return c.json({ ok: true, count });
  });

  // Assign many tasks to one agent (e.g. hand a batch of TODOs to codex
  // before queueing them). One undo entry restores every previous assignee.
  app.post("/bulk/assign", async (c) => {
    const body = (await c.req.json().catch(() => null)) as (BulkBody & { assignee?: unknown }) | null;
    const ids = parseIds(body?.ids);
    if (!ids) return c.json({ error: "ids must be positive integers" }, 400);
    const assignee = Assignee.safeParse(body?.assignee);
    if (!assignee.success) {
      return c.json({ error: `assignee must be one of: ${Assignee.options.join(", ")}` }, 400);
    }
    using db = new RelayDB();
    const tasks = db.getTasksByIds(ids).filter((task) => task.assignee !== assignee.data);
    for (const task of tasks) db.setAssignee(task.id, assignee.data);
    if (tasks.length > 0) {
      db.recordUndo({
        op_kind: "reassign",
        payload: { tasks: tasks.map((task) => ({ id: task.id, assignee: assignee.data })) },
        inverse: { tasks: tasks.map((task) => ({ id: task.id, assignee: task.assignee })) },
      });
    }
    return c.json({ ok: true, count: tasks.length });
  });

  // --- Edit ------------------------------------------------------------
  // Partial update of the user-editable fields. Edited fields are recorded
  // in tasks.user_overrides so the next adapter sync keeps the user's value;
  // `reset: ["title"]` drops a lock so upstream wins again on the next sync.
  app.patch("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "bad id" }, 400);
    const body = (await c.req.json().catch(() => null)) as unknown;
    using db = new RelayDB();
    const task = db.getTask(id);
    if (!task) return c.json({ error: "not found" }, 404);
    const parsed = parseTaskEdit(body, task);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const result = db.editTask(id, parsed.patch, { unlock: parsed.reset });
    if (!result) return c.json({ error: "not found" }, 404);
    if (result.changed.length > 0 || result.overridesChanged) {
      db.recordUndo({ op_kind: "edit", payload: { tasks: [result.after] }, inverse: { tasks: [result.before] } });
    }
    return c.json({ task: db.getTask(id), changed: result.changed, reset: parsed.reset });
  });

  // --- Snooze (optionally until a date) ---------------------------------
  // `{ "until": "tomorrow" }` snoozes until that local day; the task wakes
  // back to open on its own once until passes. No body = indefinite.
  app.post("/:id/snooze", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "bad id" }, 400);
    const body = (await c.req.json().catch(() => null)) as { until?: unknown } | null;
    let until: string | null = null;
    if (body && body.until != null && body.until !== "") {
      until = typeof body.until === "string" ? parseWhenInput(body.until) : null;
      if (!until) return c.json({ error: `until must be ${WHEN_INPUT_HINT}` }, 400);
      if (Date.parse(until) <= Date.now()) return c.json({ error: "until must be in the future" }, 400);
    }
    using db = new RelayDB();
    const task = db.getTask(id);
    if (!task) return c.json({ error: "not found" }, 404);
    if (task.status === "snoozed" && (until === null || task.due_at === until)) return c.json(task);
    db.snoozeTask(id, until);
    const updated = db.getTask(id);
    if (updated) {
      db.recordUndo({
        op_kind: "snooze",
        payload: { tasks: [snapshotTask(updated)] },
        inverse: { tasks: [snapshotTask(task)] },
      });
    }
    return c.json(updated);
  });

  // --- Run history ------------------------------------------------------
  app.get("/:id/runs", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "bad id" }, 400);
    const limitQ = Number(c.req.query("limit") ?? "");
    const limit = Number.isFinite(limitQ) && limitQ > 0 ? Math.min(200, Math.round(limitQ)) : 20;
    using db = new RelayDB();
    if (!db.getTask(id)) return c.json({ error: "not found" }, 404);
    return c.json(db.listRunsForTask(id, limit));
  });

  return app;
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function snapshotTask(task: Task) {
  return {
    id: task.id,
    status: task.status,
    due_at: task.due_at,
    closed_at: task.closed_at,
  };
}

// Matches the /api/tasks list cap, so "select all visible" always fits and
// the `IN (...)` lists stay well under SQLite's bound-parameter limit.
const MAX_BULK_IDS = 2000;

function parseIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_BULK_IDS) return null;
  const ids = value.map((id) => (typeof id === "number" ? id : Number(id)));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
  return Array.from(new Set(ids));
}
