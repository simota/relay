// /api/repos/agent-journals — gives the /repos screen a per-repo summary
// of `.agents/*.md` activity (file count + recent dated entries + agent
// names). Unlike the agents_note adapter, this surface counts journal
// entries, not task checkboxes, so users whose `.agents/` are dated
// journals (not GitHub-style task lists) still get a meaningful signal.

import { Hono } from "hono";
import {
  buildJournalOptionsFromConfig,
  computeRepoAgentJournals,
  type RepoAgentJournalSummary,
} from "../lib/repo-agent-journals.js";

export interface RepoAgentJournalsResponse {
  summaries: RepoAgentJournalSummary[];
  lookback_days: number;
}

export function createReposJournalsApi() {
  const app = new Hono();

  app.get("/agent-journals", async (c) => {
    const daysQ = Number(c.req.query("days") ?? "");
    const lookback_days =
      Number.isFinite(daysQ) && daysQ > 0 ? Math.min(90, Math.round(daysQ)) : 14;

    const opts = buildJournalOptionsFromConfig(lookback_days);
    const summaries = await computeRepoAgentJournals(opts);
    return c.json<RepoAgentJournalsResponse>({
      summaries,
      lookback_days,
    });
  });

  return app;
}
