import { Hono } from "hono";
import { runSync } from "../commands/sync.js";
import { RelayDB } from "../db/client.js";

export function createSyncApi() {
  const app = new Hono();

  app.get("/history", (c) => {
    const limit = parseLimit(c.req.query("limit"));
    const adapter = c.req.query("adapter")?.trim();

    try {
      const db = new RelayDB();
      const rows = db.listSyncHistory({ adapter: adapter || undefined, limit });
      db.close();
      return c.json(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const locked = message.toLowerCase().includes("locked");
      return c.json({ error: locked ? "db locked" : "sync history unavailable" }, locked ? 503 : 500);
    }
  });

  app.post("/", async (c) => {
    const adapter = c.req.query("adapter")?.trim();
    const source = c.req.query("source")?.trim();

    try {
      const report = await runSync({ source: adapter || source || undefined });
      return c.json(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const locked = message.toLowerCase().includes("locked");
      return c.json({ error: locked ? "db locked" : message }, locked ? 503 : 500);
    }
  });

  return app;
}

function parseLimit(value: string | undefined): number {
  const parsed = Number(value ?? 50);
  if (!Number.isInteger(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 500);
}
