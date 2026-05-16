import { Hono } from "hono";
import { RelayDB } from "../db/client.js";
import { buildAgendaReport } from "../commands/agenda.js";

// GET /api/agenda?days=7|14|30
// Returns the same shape as `relay agenda`, so the Web UI can render the
// calendar without re-deriving local-midnight bucketing on the client.
export function createAgendaApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const daysRaw = c.req.query("days");
    const daysNum = daysRaw === undefined ? undefined : Number(daysRaw);
    // Reject only obviously-malformed input. Out-of-set values fall back to
    // the default inside buildAgendaReport, matching CLI behaviour.
    if (daysRaw !== undefined && !Number.isFinite(daysNum)) {
      return c.json({ error: "days must be a number (7 | 14 | 30)" }, 400);
    }
    const db = new RelayDB();
    try {
      const report = buildAgendaReport(db, { days: daysNum, silent: true });
      return c.json(report);
    } finally {
      db.close();
    }
  });

  return app;
}
