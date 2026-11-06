import { Hono } from "hono";
import { RelayDB } from "../db/client.js";
import { applyRulesToOpenTasks, rulesOverview } from "../commands/rules.js";

/**
 * Triage rules (`[[rules]]` in config.toml). Rules are edited in the config
 * file; the API lists them (with live match counts) and applies them to
 * open tasks. `dry_run` previews; a real apply is one undo entry.
 */
export function createRulesApi() {
  const app = new Hono();

  app.get("/", (c) => {
    using db = new RelayDB();
    return c.json(rulesOverview(db));
  });

  app.post("/apply", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { dry_run?: unknown } | null;
    const dryRun = body?.dry_run === true || c.req.query("dry_run") === "1";
    using db = new RelayDB();
    return c.json(applyRulesToOpenTasks(db, dryRun));
  });

  return app;
}
