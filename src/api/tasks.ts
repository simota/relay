import { Hono } from "hono";
import { RelayDB } from "../db/client.js";
import type { Task } from "../types.js";

interface BulkBody {
  ids?: unknown;
  until?: unknown;
}

export function createTasksApi() {
  const app = new Hono();

  app.post("/bulk/snooze", async (c) => {
    const body = (await c.req.json().catch(() => null)) as BulkBody | null;
    const ids = parseIds(body?.ids);
    const until = typeof body?.until === "string" ? body.until : "";
    if (!ids) return c.json({ error: "ids must be positive integers" }, 400);
    if (!until || Number.isNaN(Date.parse(until))) {
      return c.json({ error: "until must be a valid date string" }, 400);
    }

    const db = new RelayDB();
    const tasks = db.getTasksByIds(ids);
    const count = db.bulkSnooze(ids, until);
    if (count > 0) {
      db.recordUndo({
        op_kind: "bulk_snooze",
        payload: { tasks: tasks.map((task) => ({ ...snapshotTask(task), status: "snoozed", due_at: until, closed_at: null })) },
        inverse: { tasks: tasks.map(reopenSnapshot) },
      });
    }
    db.close();
    return c.json({ ok: true, count });
  });

  app.post("/bulk/close", async (c) => {
    const body = (await c.req.json().catch(() => null)) as BulkBody | null;
    const ids = parseIds(body?.ids);
    if (!ids) return c.json({ error: "ids must be positive integers" }, 400);

    const db = new RelayDB();
    const tasks = db.getTasksByIds(ids);
    const count = db.bulkClose(ids);
    if (count > 0) {
      const now = new Date().toISOString();
      db.recordUndo({
        op_kind: "bulk_close",
        payload: { tasks: tasks.map((task) => ({ ...snapshotTask(task), status: "done", closed_at: now })) },
        inverse: { tasks: tasks.map(reopenSnapshot) },
      });
    }
    db.close();
    return c.json({ ok: true, count });
  });

  return app;
}

function snapshotTask(task: Task) {
  return {
    id: task.id,
    status: task.status,
    due_at: task.due_at,
    closed_at: task.closed_at,
  };
}

function reopenSnapshot(task: Task) {
  return {
    id: task.id,
    status: "open" as const,
    due_at: null,
    closed_at: null,
  };
}

function parseIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((id) => (typeof id === "number" ? id : Number(id)));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
  return Array.from(new Set(ids));
}
