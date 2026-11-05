import { Hono } from "hono";
import { RelayDB } from "../db/client.js";
import { readRunLog } from "../executor/headless.js";

const RUN_STATUSES = new Set(["running", "success", "failed", "interrupted"]);

/**
 * Agent run history across tasks (`relay runs` parity) and the captured
 * output of headless runs. Read-only: runs are written by the CLI.
 */
export function createRunsApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const status = c.req.query("status") || undefined;
    if (status && !RUN_STATUSES.has(status)) return c.json({ error: "bad status" }, 400);
    const taskQ = c.req.query("task_id");
    const taskId = taskQ ? Number(taskQ) : undefined;
    if (taskId !== undefined && (!Number.isInteger(taskId) || taskId <= 0)) {
      return c.json({ error: "bad task_id" }, 400);
    }
    const limitQ = Number(c.req.query("limit") ?? "");
    const limit = Number.isFinite(limitQ) && limitQ > 0 ? Math.min(500, Math.round(limitQ)) : 50;
    using db = new RelayDB();
    const rows = db.listRuns({ status, agent: c.req.query("agent") || undefined, taskId, limit });
    return c.json(rows.map((row) => ({ ...row, has_log: readRunLog(row.id) !== null })));
  });

  app.get("/:id/log", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad id" }, 400);
    using db = new RelayDB();
    const run = db.getRun(id);
    if (!run) return c.json({ error: "not found" }, 404);
    const log = readRunLog(id);
    if (!log) return c.json({ error: "no log captured for this run" }, 404);
    return c.json({ run, ...log });
  });

  return app;
}
