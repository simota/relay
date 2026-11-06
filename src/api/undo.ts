import { Hono } from "hono";
import { RelayDB, type TaskEditSnapshot, type TaskStatusSnapshot } from "../db/client.js";
import { Assignee, EDITABLE_FIELDS, type Task } from "../types.js";

interface UndoPayload {
  tasks: TaskStatusSnapshot[];
}

interface DeleteDoneUndoPayload {
  // Legacy rows (schema_version <= 5 producers): full Task snapshots saved so
  // we can fully restore on undo.
  tasks?: Task[];
  // New rows (schema_version 6 producers): only the deleted ids are kept; the
  // snapshots were dropped because they ballooned undo_log past 400 MB. Undo
  // for these rows is reported as `unrecoverable`.
  ids?: number[];
  unrecoverable?: boolean;
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
    const limitQ = Number(c.req.query("limit") ?? "");
    const limit = Number.isFinite(limitQ) && limitQ > 0 ? Math.min(200, Math.round(limitQ)) : 20;
    using db = new RelayDB();
    const rows: UndoListItem[] = db.listUndo(limit).map((row) => ({
      id: row.id,
      op_kind: row.op_kind,
      created_at: row.created_at,
      status: row.status,
    }));
    return c.json(rows);
  });

  app.post("/", (c) => {
    const redo = c.req.query("redo") === "1" || c.req.query("mode") === "redo";
    using db = new RelayDB();
    const outcome = applyUndo(db, redo);
    if ("error" in outcome) return c.json(outcome, 500);
    return c.json(outcome);
  });

  app.delete("/", (c) => {
    const olderThan = c.req.query("older_than");
    const days = parseOlderThanDays(olderThan);
    if (days === null) return c.json({ error: "older_than must look like 30d" }, 400);

    using db = new RelayDB();
    const count = db.pruneUndoOlderThan(days);
    return c.json({ ok: true, count });
  });

  return app;
}

export type UndoOutcome =
  | {
      ok: true;
      id?: number;
      op_kind?: string;
      count?: number;
      undone: boolean;
      redone: boolean;
      unrecoverable?: boolean;
      message?: string;
    }
  | { error: string };

/**
 * Undo (or, with `redo`, redo) the newest eligible undo_log entry. Shared by
 * `POST /api/undo` and `relay undo` so both surfaces walk the same log.
 */
export function applyUndo(db: RelayDB, redo: boolean): UndoOutcome {
  const row = db.latestUndo(redo ? "undone" : "active");
  if (!row) {
    return { ok: true, undone: false, redone: false };
  }

  // prune_delete_done: undo = restore physically deleted tasks
  //                     redo = re-delete them
  if (row.op_kind === "prune_delete_done") {
    if (redo) {
      // redo: re-delete the tasks listed in payload.ids
      const redoPayload = parseDeleteDoneRedoPayload(row.payload);
      if (!redoPayload) {
        return { error: "undo payload is invalid" };
      }
      const snapshots = db.batchDeleteTasks(redoPayload.ids);
      db.markUndoStatus(row.id, "active");
      return { ok: true, id: row.id, op_kind: row.op_kind, count: snapshots.length, undone: false, redone: true };
    } else {
      // undo: restore from inverse.tasks snapshots
      const inversePayload = parseDeleteDoneUndoPayload(row.inverse);
      if (!inversePayload) {
        return { error: "undo payload is invalid" };
      }
      // schema_version 6+ rows persist only ids + unrecoverable flag. We
      // mark the undo as consumed so it disappears from the log, but cannot
      // restore the rows because full snapshots were never written.
      if (inversePayload.unrecoverable === true) {
        db.markUndoStatus(row.id, "undone");
        return {
          ok: true,
          id: row.id,
          op_kind: row.op_kind,
          count: 0,
          undone: true,
          redone: false,
          unrecoverable: true,
          message:
            "physical deletion is not undoable; task IDs were recorded but full snapshots were not persisted",
        };
      }
      // Legacy rows: full snapshots present — restore as before.
      const tasks = inversePayload.tasks ?? [];
      const count = db.restoreDeletedTasks(tasks);
      db.markUndoStatus(row.id, "undone");
      return { ok: true, id: row.id, op_kind: row.op_kind, count, undone: true, redone: false };
    }
  }

  // reassign rows carry `{ id, assignee }` snapshots (no status), so they
  // must not go through the status snapshot parser below.
  if (row.op_kind === "reassign") {
    const assignees = parseAssigneePayload(redo ? row.payload : row.inverse);
    if (!assignees) {
      return { error: "undo payload is invalid" };
    }
    for (const a of assignees) db.setAssignee(a.id, a.assignee);
    db.markUndoStatus(row.id, redo ? "active" : "undone");
    return { ok: true, id: row.id, op_kind: row.op_kind, count: assignees.length, undone: !redo, redone: redo };
  }

  // edit rows carry `{ id, fields, user_overrides }` before/after images
  // of exactly the edited fields (see editTask).
  if (row.op_kind === "edit") {
    const edits = parseEditPayload(redo ? row.payload : row.inverse);
    if (!edits) {
      return { error: "undo payload is invalid" };
    }
    let count = 0;
    for (const snapshot of edits) if (db.restoreTaskEdit(snapshot)) count++;
    db.markUndoStatus(row.id, redo ? "active" : "undone");
    return { ok: true, id: row.id, op_kind: row.op_kind, count, undone: !redo, redone: redo };
  }

  // tags rows carry `{ tasks: [{ id, tags }] }` — the full tag list to
  // restore, so undo/redo are exact regardless of add/remove semantics.
  if (row.op_kind === "tags") {
    const lists = parseTagListPayload(redo ? row.payload : row.inverse);
    if (!lists) {
      return { error: "undo payload is invalid" };
    }
    const count = db.applyTagLists(lists);
    db.markUndoStatus(row.id, redo ? "active" : "undone");
    return { ok: true, id: row.id, op_kind: row.op_kind, count, undone: !redo, redone: redo };
  }

  // deps rows carry `{ add: [edge], remove: [edge] }`; the inverse swaps
  // the two lists. Edges whose tasks were deleted since are skipped.
  if (row.op_kind === "deps") {
    const change = parseDepsPayload(redo ? row.payload : row.inverse);
    if (!change) {
      return { error: "undo payload is invalid" };
    }
    let count = 0;
    for (const edge of change.remove) if (db.removeDependency(edge.task_id, edge.depends_on_id)) count++;
    for (const edge of change.add) {
      const added = db.addDependency(edge.task_id, edge.depends_on_id);
      if (added.ok && added.added) count++;
    }
    db.markUndoStatus(row.id, redo ? "active" : "undone");
    return { ok: true, id: row.id, op_kind: row.op_kind, count, undone: !redo, redone: redo };
  }

  const payload = parseUndoPayload(redo ? row.payload : row.inverse);
  if (!payload) {
    return { error: "undo payload is invalid" };
  }

  const count = db.applyTaskStates(payload.tasks);
  db.markUndoStatus(row.id, redo ? "active" : "undone");
  return { ok: true, id: row.id, op_kind: row.op_kind, count, undone: !redo, redone: redo };
}

function parseDeleteDoneUndoPayload(value: string): DeleteDoneUndoPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;

    // New shape: { ids: number[], unrecoverable: true }
    if (record.unrecoverable === true) {
      const ids = Array.isArray(record.ids)
        ? (record.ids as unknown[]).filter((id): id is number => typeof id === "number")
        : [];
      return { unrecoverable: true, ids };
    }

    // Legacy shape: { tasks: Task[] }
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

function parseAssigneePayload(value: string): Array<{ id: number; assignee: Assignee }> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const tasks = (parsed as Record<string, unknown>).tasks;
    if (!Array.isArray(tasks)) return null;
    const out: Array<{ id: number; assignee: Assignee }> = [];
    for (const item of tasks) {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = record.id;
      const assignee = Assignee.safeParse(record.assignee);
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || !assignee.success) return null;
      out.push({ id, assignee: assignee.data });
    }
    return out;
  } catch {
    return null;
  }
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

function parseEditPayload(value: string): TaskEditSnapshot[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const tasks = (parsed as Record<string, unknown>).tasks;
    if (!Array.isArray(tasks)) return null;
    const out: TaskEditSnapshot[] = [];
    for (const item of tasks) {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = record.id;
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
      const fields = record.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
      const editable: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(fields as Record<string, unknown>)) {
        if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) return null;
        editable[key] = v;
      }
      const overrides = Array.isArray(record.user_overrides)
        ? record.user_overrides.filter((f): f is string => typeof f === "string")
        : [];
      out.push({ id, fields: editable as TaskEditSnapshot["fields"], user_overrides: overrides });
    }
    return out;
  } catch {
    return null;
  }
}

function parseTagListPayload(value: string): Array<{ id: number; tags: string[] }> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const tasks = (parsed as Record<string, unknown>).tasks;
    if (!Array.isArray(tasks)) return null;
    const out: Array<{ id: number; tags: string[] }> = [];
    for (const item of tasks) {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "number" || !Number.isInteger(record.id) || record.id <= 0) return null;
      if (!Array.isArray(record.tags)) return null;
      out.push({ id: record.id, tags: record.tags.filter((tag): tag is string => typeof tag === "string") });
    }
    return out;
  } catch {
    return null;
  }
}

interface DepEdge {
  task_id: number;
  depends_on_id: number;
}

function parseDepsPayload(value: string): { add: DepEdge[]; remove: DepEdge[] } | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const edges = (list: unknown): DepEdge[] | null => {
      if (list === undefined) return [];
      if (!Array.isArray(list)) return null;
      const out: DepEdge[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") return null;
        const edge = item as Record<string, unknown>;
        const taskId = edge.task_id;
        const dependsOn = edge.depends_on_id;
        if (typeof taskId !== "number" || !Number.isInteger(taskId) || taskId <= 0) return null;
        if (typeof dependsOn !== "number" || !Number.isInteger(dependsOn) || dependsOn <= 0) return null;
        out.push({ task_id: taskId, depends_on_id: dependsOn });
      }
      return out;
    };
    const add = edges(record.add);
    const remove = edges(record.remove);
    if (!add || !remove) return null;
    return { add, remove };
  } catch {
    return null;
  }
}
