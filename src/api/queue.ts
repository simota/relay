import { Hono } from "hono";
import { RelayDB } from "../db/client.js";

// Matches MAX_BULK_IDS in tasks.ts: "queue all visible" always fits.
const MAX_QUEUE_IDS = 2000;

export function createQueueApi() {
  const app = new Hono();

  app.get("/", (c) => {
    using db = new RelayDB();
    const items = db.listQueueItems();
    return c.json(items);
  });

  // `{ task_id }` queues one task; `{ task_ids: [...] }` queues several in
  // order. `front: true` puts them at the head. Re-queuing an already
  // queued task returns its existing item instead of duplicating it.
  app.post("/items", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const front = body?.front === true;
    if (Array.isArray(body?.task_ids)) {
      const ids = parseTaskIds(body.task_ids);
      if (!ids) return c.json({ error: "task_ids must be positive integers" }, 400);
      using db = new RelayDB();
      const ordered = front ? [...ids].reverse() : ids;
      const added: number[] = [];
      const missing: number[] = [];
      for (const taskId of ordered) {
        const itemId = db.addQueueItem(taskId, { front });
        if (itemId === null) missing.push(taskId);
        else added.push(taskId);
      }
      return c.json({ ok: true, count: added.length, missing }, 201);
    }
    const taskId = typeof body?.task_id === "number" ? body.task_id : Number(body?.task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return c.json({ error: "task_id required" }, 400);
    }

    using db = new RelayDB();
    const id = db.addQueueItem(taskId, { front });
    if (id === null) return c.json({ error: "task not found" }, 404);
    return c.json({ id }, 201);
  });

  // Retry what broke: queue every not-done task whose latest run failed or
  // was interrupted (`relay queue add --failed` parity). Already-queued
  // tasks are not duplicated. `{ front: true }` puts them at the head.
  app.post("/retry-failed", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { front?: unknown } | null;
    const front = body?.front === true;
    using db = new RelayDB();
    const queued = new Set(db.listQueueItems().map((item) => item.task_id));
    const ids = db.failedTaskIds().filter((id) => !queued.has(id));
    for (const taskId of front ? [...ids].reverse() : ids) db.addQueueItem(taskId, { front });
    return c.json({ ok: true, count: ids.length, task_ids: ids });
  });

  // How many failed runs could be retried (drives the tray's retry button).
  app.get("/retry-failed", (c) => {
    using db = new RelayDB();
    const queued = new Set(db.listQueueItems().map((item) => item.task_id));
    const ids = db.failedTaskIds().filter((id) => !queued.has(id));
    return c.json({ count: ids.length, task_ids: ids });
  });

  // Re-order: `{ direction: "up" | "down" | "front" }`.
  app.post("/items/:id/move", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad id" }, 400);
    const body = (await c.req.json().catch(() => null)) as { direction?: unknown } | null;
    const direction = body?.direction;
    if (direction !== "up" && direction !== "down" && direction !== "front") {
      return c.json({ error: "direction must be up, down or front" }, 400);
    }
    using db = new RelayDB();
    if (!db.listQueueItems().some((item) => item.id === id)) return c.json({ error: "not found" }, 404);
    const moved = direction === "front" ? db.moveQueueItemToFront(id) : db.moveQueueItem(id, direction);
    return c.json({ ok: true, moved });
  });

  app.delete("/items/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad id" }, 400);
    using db = new RelayDB();
    db.deleteQueueItem(id);
    return c.json({ ok: true });
  });

  app.delete("/", (c) => {
    using db = new RelayDB();
    db.clearQueue();
    return c.json({ ok: true });
  });

  return app;
}

function parseTaskIds(value: unknown[]): number[] | null {
  if (value.length === 0 || value.length > MAX_QUEUE_IDS) return null;
  const ids = value.map((id) => (typeof id === "number" ? id : Number(id)));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
  return Array.from(new Set(ids));
}
