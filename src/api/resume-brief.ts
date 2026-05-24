import { Hono } from "hono";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";
import { buildResumeBrief } from "../lib/resume-brief.js";
import { findMissingRepos } from "../repo-metadata.js";

export function createResumeBriefApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const cfg = loadConfig();
    const flag_enabled = cfg.features.daily_resume_brief;
    if (!flag_enabled) {
      return c.json({
        flag_enabled,
        generated_at: new Date().toISOString(),
        candidate: null,
      });
    }

    const db = new RelayDB();
    try {
      const roots = resolveScanRoots(cfg);
      const repoNames = db.repoStats().map((r) => r.name);
      const missing = findMissingRepos(repoNames, roots);
      const tasks = db.today(30, missing, cfg.ui.priority_decay_days);
      const brief = buildResumeBrief(db, { candidates: tasks });
      return c.json({ flag_enabled, ...brief });
    } finally {
      db.close();
    }
  });

  return app;
}
