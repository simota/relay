import { Hono } from "hono";
import { RelayDB, type TaskStatusSnapshot } from "../db/client.js";
import type { Task } from "../types.js";

interface UndoPayload {
  tasks: TaskStatusSnapshot[];
}

interface DeleteDoneUndoPayload {
  tasks: Task[];
}

interface UndoListItem {
  id: number;
  op_kind: string;
  created_at: string;
  status: "active" | "undone";
}

const VALID_STATUSES = new Set<Task["status"]>(["open", "in_progress", "blocked", "snoozed", "done"]);

export function createUndoApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const limit = Number(c.req.query("limit") ?? 20);
    const db = new RelayDB();
    const rows: UndoListItem[] = db.listUndo(limit).map((row) => ({
      id: row.id,
      op_kind: row.op_kind,
      created_at: row.created_at,
      status: row.status,
    }));
    db.close();
    return c.json(rows);
  });

  app.post("/", (c) => {
    const redo = c.req.query("redo") === "1" || c.req.query("mode") === "redo";
    const db = new RelayDB();
    const row = db.latestUndo(redo ? "undone" : "active");
    if (!row) {
      db.close();
      return c.json({ ok: true, undone: false, redone: false });
    }

    // prune_delete_done: undo = restore physically deleted tasks
    //                     redo = re-delete them
    if (row.op_kind === "prune_delete_done") {
      if (redo) {
        // redo: re-delete the tasks listed in payload.ids
        const redoPayload = parseDeleteDoneRedoPayload(row.payload);
        if (!redoPayload) {
          db.close();
          return c.json({ error: "undo payload is invalid" }, 500);
        }
        const snapshots = db.batchDeleteTasks(redoPayload.ids);
        db.markUndoStatus(row.id, "active");
        db.close();
        return c.json({ ok: true, id: row.id, op_kind: row.op_kind, count: snapshots.length, undone: false, redone: true });
      } else {
        // undo: restore from inverse.tasks snapshots
        const inversePayload = parseDeleteDoneUndoPayload(row.inverse);
        if (!inversePayload) {
          db.close();
          return c.json({ error: "undo payload is invalid" }, 500);
        }
        const count = db.restoreDeletedTasks(inversePayload.tasks);
        db.markUndoStatus(row.id, "undone");
        db.close();
        return c.json({ ok: true, id: row.id, op_kind: row.op_kind, count, undone: true, redone: false });
      }
    }

    const payload = parseUndoPayload(redo ? row.payload : row.inverse);
    if (!payload) {
      db.close();
      return c.json({ error: "undo payload is invalid" }, 500);
    }

    const count = db.applyTaskStates(payload.tasks);
    db.markUndoStatus(row.id, redo ? "active" : "undone");
    db.close();
    return c.json({ ok: true, id: row.id, op_kind: row.op_kind, count, undone: !redo, redone: redo });
  });

  app.delete("/", (c) => {
    const olderThan = c.req.query("older_than");
    const days = parseOlderThanDays(olderThan);
    if (days === null) return c.json({ error: "older_than must look like 30d" }, 400);

    const db = new RelayDB();
    const count = db.pruneUndoOlderThan(days);
    db.close();
    return c.json({ ok: true, count });
  });

  return app;
}

function parseDeleteDoneUndoPayload(value: string): DeleteDoneUndoPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.tasks)) return null;
    const tasks = record.tasks as Task[];
    // Minimal validation: each item needs at minimum an id
    if (tasks.some((t) => typeof t !== "object" || t === null || typeof (t as Record<string, unknown>).id !== "number")) return null;
    return { tasks };
  } catch {
    return null;
  }
}

function parseDeleteDoneRedoPayload(value: string): { ids: number[] } | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.ids)) return null;
    if (record.ids.some((id) => typeof id !== "number")) return null;
    return { ids: record.ids as number[] };
  } catch {
    return null;
  }
}

function parseOlderThanDays(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d+)d$/);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isInteger(days) && days > 0 ? days : null;
}

function parseUndoPayload(value: string): UndoPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.tasks)) return null;
    const tasks = record.tasks.map(parseSnapshot);
    if (tasks.some((task) => task === null)) return null;
    return { tasks: tasks as TaskStatusSnapshot[] };
  } catch {
    return null;
  }
}

function parseSnapshot(value: unknown): TaskStatusSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "number" ? record.id : Number(record.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (typeof record.status !== "string" || !VALID_STATUSES.has(record.status as Task["status"])) {
    return null;
  }
  const dueAt = record.due_at === null || typeof record.due_at === "string" ? record.due_at : null;
  const closedAt = record.closed_at === null || typeof record.closed_at === "string" ? record.closed_at : null;
  return {
    id,
    status: record.status as Task["status"],
    due_at: dueAt,
    closed_at: closedAt,
  };
}
