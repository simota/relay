import { Hono } from "hono";
import { RelayDB, type ViewFilter } from "../db/client.js";

interface ViewBody {
  name?: unknown;
  filter?: unknown;
  pinned?: unknown;
}

interface DeleteViewBody {
  id?: unknown;
}

export function createViewsApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const db = new RelayDB();
    const views = db.listViews();
    db.close();
    return c.json(views);
  });

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as ViewBody | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "name required" }, 400);

    const filter = parseFilter(body?.filter);
    if (!filter) return c.json({ error: "filter must be an object" }, 400);

    const db = new RelayDB();
    const view = db.createView({ name, filter, pinned: body?.pinned !== false });
    db.close();
    return c.json(view, 201);
  });

  app.delete("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as DeleteViewBody | null;
    const id = Number(c.req.query("id") ?? body?.id);
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "id must be a positive integer" }, 400);

    const db = new RelayDB();
    const deleted = db.deleteView(id);
    db.close();
    if (!deleted) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}

function parseFilter(value: unknown): ViewFilter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    status: typeof record.status === "string" ? record.status : undefined,
    repo: typeof record.repo === "string" ? record.repo : undefined,
    source: typeof record.source === "string" ? record.source : undefined,
    age: typeof record.age === "string" ? record.age : undefined,
  };
}
