import { Hono } from "hono";
import { RelayDB } from "../db/client.js";
import { buildStandupReport } from "../commands/standup.js";

export function createStandupApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const since = c.req.query("since");
    const db = new RelayDB();
    try {
      const report = buildStandupReport(db, { since: since ?? undefined });
      return c.json(report);
    } finally {
      db.close();
    }
  });

  return app;
}
