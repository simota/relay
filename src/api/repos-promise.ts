// /api/repos/promise-summary — feeds the "Unfinished Business" lane on
// /repos. Flag-gated: when `[features].promise_ledger = false`, returns
// `flag_enabled: false` with empty summaries so the UI can render an
// onboarding CTA instead of silently hiding the lane.

import { Hono } from "hono";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";
import {
  computeRepoPromiseSummaries,
  type RepoPromiseSummary,
} from "../lib/repo-promise-summary.js";

export interface RepoPromiseSummaryResponse {
  flag_enabled: boolean;
  summaries: RepoPromiseSummary[];
  /** Lookback window in days actually applied. */
  lookback_days: number;
}

export function createReposPromiseApi() {
  const app = new Hono();

  app.get("/promise-summary", async (c) => {
    const cfg = loadConfig();
    const flag_enabled = cfg.features.promise_ledger;

    // Lookback days — clamped to [1, 90]. Defaults to 14d (same as the
    // aggregator's internal default; kept in sync explicitly so the API
    // contract surfaces a number that matches what we computed).
    const daysQ = Number(c.req.query("days") ?? "");
    const lookback_days =
      Number.isFinite(daysQ) && daysQ > 0 ? Math.min(90, Math.round(daysQ)) : 14;

    if (!flag_enabled) {
      // Don't run the aggregator at all when the flag is off — the UI
      // only needs to know the flag state to render the CTA.
      return c.json<RepoPromiseSummaryResponse>({
        flag_enabled: false,
        summaries: [],
        lookback_days,
      });
    }

    const roots = resolveScanRoots(cfg);
    const db = new RelayDB();
    try {
      const summaries = await computeRepoPromiseSummaries(db, {
        lookbackDays: lookback_days,
        roots,
      });
      return c.json<RepoPromiseSummaryResponse>({
        flag_enabled: true,
        summaries,
        lookback_days,
      });
    } finally {
      db.close();
    }
  });

  return app;
}
