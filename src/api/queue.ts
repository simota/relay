import { Hono } from "hono";
import { RelayDB } from "../db/client.js";

export function createQueueApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const db = new RelayDB();
    const items = db.listQueueItems();
    db.close();
    return c.json(items);
  });

  app.post("/items", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const taskId = typeof body?.task_id === "number" ? body.task_id : Number(body?.task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return c.json({ error: "task_id required" }, 400);
    }

    const db = new RelayDB();
    const id = db.addQueueItem(taskId);
    db.close();
    if (id === null) return c.json({ error: "task not found" }, 404);
    return c.json({ id }, 201);
  });

  app.delete("/items/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad id" }, 400);
    const db = new RelayDB();
    db.deleteQueueItem(id);
    db.close();
    return c.json({ ok: true });
  });

  app.delete("/", (c) => {
    const db = new RelayDB();
    db.clearQueue();
    db.close();
    return c.json({ ok: true });
  });

  return app;
}
