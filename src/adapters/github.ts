import { spawn, spawnSync } from "node:child_process";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput, WaitOn } from "../types.js";

/**
 * Safety window subtracted from the last-sync cursor before passing it to
 * `--updated >=<ts>`. GitHub Search indexes can lag by a few minutes, so we
 * pull back 30 minutes to avoid missing items that were updated just before
 * the previous sync ended.
 */
const SAFETY_WINDOW_MS = 30 * 60 * 1000;

// gh search supports a different json field set for issues vs prs.
// `isDraft` is PR-only (issues sweep rejects it with "Unknown JSON field");
// `labels` is supported by both. `reviewDecision` is intentionally not
// requested here: `gh search prs --json` does not expose it (only
// `gh pr view <url> --json reviewDecision` does), so collecting it would
// require an extra per-PR API call. Tracked as a v2 follow-up.
const ISSUE_JSON_FIELDS =
  "repository,number,title,body,url,updatedAt,assignees,author,state,labels";
const PR_JSON_FIELDS =
  "repository,number,title,body,url,updatedAt,assignees,author,state,labels,isDraft";
const SEARCH_LIMIT = "200";
const ORG_SEARCH_LIMIT = "100";

// Priority order used when the same URL is returned by multiple sweeps.
// 'self' wins because if any sweep evidence says the task is on me, I want
// it on top of Today regardless of what other sweeps say.
const WAIT_ON_RANK: Record<WaitOn, number> = {
  self: 3,
  reviewer: 2,
  scheduled: 1,
  external: 0,
};

export const githubAdapter: Adapter = {
  name: "github_issue",
  flagKeys: ["github_issue", "github_pr"] as const,
  emits: ["github_issue", "github_pr"] as const,

  precheck(ctx: AdapterContext): { skip: true; reason: string } | null {
    if (!ctx.githubUser) {
      return { skip: true, reason: "github.user not configured in ~/.relay/config.toml" };
    }
    // Verify the gh CLI is actually logged in before we spend a sync emitting
    // `Unexpected token …` JSON.parse errors. A stale token typically shows
    // up as an interactive `gh auth login` prompt on stdout, which then
    // makes `gh search --json` return non-JSON garbage to ghJson(). Mirror
    // the same check used by gh_notification / gh_run_failure so all
    // gh-backed adapters behave consistently when auth is broken.
    const res = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
    if (res.error || res.status !== 0) {
      return { skip: true, reason: "gh CLI not authenticated" };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const user = ctx.githubUser;
    const orgs = ctx.githubOrgs ?? [];
    // The registry collapses issues + PRs into one adapter name
    // (`github_issue`), so we re-read the granular flags here to honour
    // the user's intent when only one of the two is enabled. Default to
    // both-on so callers that don't populate `ctx.adapters` (tests)
    // get the historical behaviour.
    const issueEnabled = ctx.adapters?.github_issue ?? true;
    const prEnabled = ctx.adapters?.github_pr ?? true;

    // Incremental fetch: when a previous successful sync exists, restrict
    // each gh search query to items updated since (cursor - safety window).
    // On first sync (cursor is undefined) the filter is omitted → full sweep.
    const updatedSince = ctx.lastSyncCursor
      ? subtractMs(ctx.lastSyncCursor, SAFETY_WINDOW_MS)
      : undefined;

    // Parallel sweeps — assigned/authored × issues/PRs, plus configured orgs.
    // gh search returns the same URL across queries, so dedupe by source_id below.
    const sweeps: Array<Promise<GhSweep>> = [];

    if (user) {
      if (issueEnabled) {
        sweeps.push(
          ghSweep("issues", ["--assignee", user], "github_issue", "open", SEARCH_LIMIT, updatedSince),
          ghSweep("issues", ["--author", user], "github_issue", "open", SEARCH_LIMIT, updatedSince),
        );
      }
      if (prEnabled) {
        sweeps.push(
          ghSweep("prs", ["--assignee", user], "github_pr", "open", SEARCH_LIMIT, updatedSince),
          ghSweep("prs", ["--author", user], "github_pr", "open", SEARCH_LIMIT, updatedSince),
        );
      }
    }

    for (const org of orgs) {
      if (issueEnabled) {
        sweeps.push(
          ghSweep("issues", ["--owner", org], "github_issue", "open", ORG_SEARCH_LIMIT, updatedSince),
        );
      }
      if (prEnabled) {
        sweeps.push(
          ghSweep("prs", ["--owner", org], "github_pr", "open", ORG_SEARCH_LIMIT, updatedSince),
        );
      }
    }

    // `Promise.all([])` resolves to `[]` synchronously, so an all-disabled
    // setup (which shouldn't reach here — the registry filters that out)
    // would still return an empty task list rather than throwing.
    const results = await Promise.all(sweeps);

    const byUrl = new Map<string, TaskInput>();
    const collect = (rows: GhRow[], sourceType: "github_issue" | "github_pr") => {
      for (const row of rows) {
        const repo = row.repository?.name;
        if (!repo || !row.url) continue;
        const waitOn = inferWaitOn(row, sourceType, user);
        const existing = byUrl.get(row.url);
        if (existing) {
          // Same URL seen by another sweep: keep the strongest wait_on signal.
          if (WAIT_ON_RANK[waitOn] > WAIT_ON_RANK[existing.wait_on ?? "self"]) {
            existing.wait_on = waitOn;
          }
          continue;
        }
        byUrl.set(row.url, {
          source_type: sourceType,
          source_id: row.url,
          repo,
          title: row.title ?? "(no title)",
          body: appendGhFooter(row.body ?? "", formatGhFooter(row, sourceType)),
          status: "open",
          assignee: sourceType === "github_pr" ? "human-review" : "self",
          priority: sourceType === "github_pr" ? 65 : 55,
          prompt: null,
          files: [],
          context_hash: null,
          session_id: null,
          due_at: null,
          wait_on: waitOn,
        });
      }
    };

    for (const result of results) {
      collect(result.rows, result.sourceType);
    }

    return [...byUrl.values()];
  },

  // `gh search` returns closed PRs (merged + closed-without-merge) and closed
  // issues; sync uses the URL set to close matching DB tasks. Limited to the
  // most-recently-updated 200 per sweep — older closures roll off but we
  // catch them on the next sync if they bubble back up.
  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    const user = ctx.githubUser;
    const orgs = ctx.githubOrgs ?? [];
    if (!user && orgs.length === 0) return [];
    // Mirror the open-sweep gating so an issue-only or PR-only config
    // never auto-closes DB tasks of the disabled half.
    const issueEnabled = ctx.adapters?.github_issue ?? true;
    const prEnabled = ctx.adapters?.github_pr ?? true;

    // Use the same cursor as the open sweep so closed items are fetched
    // incrementally too. First sync (undefined cursor) → full sweep.
    const updatedSince = ctx.lastSyncCursor
      ? subtractMs(ctx.lastSyncCursor, SAFETY_WINDOW_MS)
      : undefined;

    const sweeps: Array<Promise<GhSweep>> = [];

    if (user) {
      if (issueEnabled) {
        sweeps.push(
          ghSweep("issues", ["--assignee", user], "github_issue", "closed", SEARCH_LIMIT, updatedSince),
          ghSweep("issues", ["--author", user], "github_issue", "closed", SEARCH_LIMIT, updatedSince),
        );
      }
      if (prEnabled) {
        sweeps.push(
          ghSweep("prs", ["--assignee", user], "github_pr", "closed", SEARCH_LIMIT, updatedSince),
          ghSweep("prs", ["--author", user], "github_pr", "closed", SEARCH_LIMIT, updatedSince),
        );
      }
    }

    for (const org of orgs) {
      if (issueEnabled) {
        sweeps.push(
          ghSweep("issues", ["--owner", org], "github_issue", "closed", ORG_SEARCH_LIMIT, updatedSince),
        );
      }
      if (prEnabled) {
        sweeps.push(
          ghSweep("prs", ["--owner", org], "github_pr", "closed", ORG_SEARCH_LIMIT, updatedSince),
        );
      }
    }

    const results = await Promise.all(sweeps);

    const seen = new Map<string, GhSourceType>();
    for (const result of results) {
      for (const row of result.rows) {
        if (!row.url) continue;
        if (seen.has(row.url)) continue;
        seen.set(row.url, result.sourceType);
      }
    }
    return [...seen.entries()].map(([url, sourceType]) => ({
      source_type: sourceType,
      source_id: url,
    }));
  },
};

type GhSourceType = "github_issue" | "github_pr";

interface GhSweep {
  rows: GhRow[];
  sourceType: GhSourceType;
}

interface GhRow {
  repository?: { name?: string };
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  updatedAt?: string;
  assignees?: Array<{ login?: string }>;
  author?: { login?: string };
  // gh search returns "open"/"closed" for both issues and PRs. PR merges
  // show up here as state="closed" (the same as a closed-without-merge),
  // so this field alone cannot distinguish merged from declined — that's
  // OK because both end states drop the task out of the "open" sweep and
  // into fetchResolved() where sync auto-closes them.
  state?: string;
  // gh CLI returns labels as objects ({name, color, description, id});
  // only `name` is surfaced in the body footer.
  labels?: Array<{ name?: string }>;
  // PR-only. issues sweep does not request this field.
  isDraft?: boolean;
}

/**
 * Build the body footer that surfaces gh-side metadata (`labels`,
 * `isDraft`) inside the stored task body. Returns null when there's
 * nothing to render so callers can short-circuit the separator.
 *
 * Footer shape:
 *
 *   labels: foo, bar
 *   isDraft: true   (PR only, when true)
 *
 * Notes:
 * - Empty labels arrays / false `isDraft` are omitted to keep noise low.
 * - `reviewDecision` is intentionally absent — see `PR_JSON_FIELDS`.
 * - This is a display-only appendix; `wait_on` inference reads the
 *   raw row, not the formatted footer, so adding/removing lines here
 *   has no effect on prioritisation.
 */
export function formatGhFooter(
  row: GhRow,
  sourceType: GhSourceType,
): string | null {
  const lines: string[] = [];
  const labelNames = (row.labels ?? [])
    .map((l) => l.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  if (labelNames.length > 0) {
    lines.push(`labels: ${labelNames.join(", ")}`);
  }
  if (sourceType === "github_pr" && row.isDraft === true) {
    lines.push("isDraft: true");
  }
  if (lines.length === 0) return null;
  return lines.join("\n");
}

function appendGhFooter(body: string, footer: string | null): string {
  if (!footer) return body;
  const base = body.length > 0 ? `${body}\n\n` : "";
  return `${base}---\n${footer}`;
}

/**
 * Decide who the task is currently waiting on, based on the GitHub row
 * and the configured GitHub user.
 *
 * Rules (first match wins):
 *   1. assignees include `user`  → 'self'
 *      I'm explicitly assigned; the ball is in my court regardless of
 *      whether I authored it or someone else did.
 *   2. github_pr AND author is `user` AND not already returned to me
 *      → 'reviewer'
 *      My own open PR is sitting in someone else's review queue.
 *   3. anything else (github_issue with no me-assignment, org sweep
 *      surfacing a third party's PR, etc.)
 *      → 'external'
 *
 * Merged / closed PRs never reach here: gh search with --state open
 * filters them out, and fetchResolved() picks them up to auto-close.
 */
function inferWaitOn(
  row: GhRow,
  sourceType: GhSourceType,
  user: string | undefined,
): WaitOn {
  if (!user) return "external";
  const assignees = row.assignees ?? [];
  const meAssigned = assignees.some((a) => a.login === user);
  if (meAssigned) return "self";
  if (sourceType === "github_pr" && row.author?.login === user) {
    return "reviewer";
  }
  return "external";
}

async function ghSweep(
  kind: "issues" | "prs",
  extra: string[],
  sourceType: GhSourceType,
  state: "open" | "closed" = "open",
  limit = SEARCH_LIMIT,
  updatedSince?: string,
): Promise<GhSweep> {
  const jsonFields = kind === "prs" ? PR_JSON_FIELDS : ISSUE_JSON_FIELDS;
  const updatedArgs = updatedSince ? ["--updated", `>=${updatedSince}`] : [];
  const rows = await ghJson([
    "search",
    kind,
    ...extra,
    "--state",
    state,
    "--limit",
    limit,
    ...updatedArgs,
    "--json",
    jsonFields,
  ]) as GhRow[];
  return { rows, sourceType };
}

/**
 * Subtracts `ms` milliseconds from an ISO 8601 timestamp string and returns
 * the result as an ISO 8601 UTC string. Accepts milliseconds so callers can
 * pass named constants (e.g. `SAFETY_WINDOW_MS`) without unit conversion.
 */
function subtractMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() - ms).toISOString();
}

function ghJson(args: string[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gh exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        // `gh` occasionally writes non-JSON to stdout — interactive login
        // prompts on a stale token, `gh: command not found`-style shim
        // errors from version managers, or upgrade nags. The raw V8 message
        // (`Unexpected token h in JSON at position 0`) hides the actual
        // cause; surface a slice of stderr so the sync error is
        // self-diagnosing instead of forcing the user to re-run by hand.
        const stderrSummary = stderr.trim().slice(0, 500) || "(empty)";
        const cause = e instanceof Error ? e.message : String(e);
        reject(new Error(`gh JSON parse failed: ${cause}; stderr: ${stderrSummary}`));
      }
    });
  });
}
