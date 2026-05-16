import { spawn, spawnSync } from "node:child_process";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

// Repo-list and run-list limits. The combined fetch budget for a sync is
// roughly `repos × 2` gh calls (one failure sweep + one success sweep in
// fetchResolved). For a 40-repo personal portfolio that's 80 requests per
// sync — well inside the gh REST budget (5000/hour for authenticated calls)
// even with daemon runs every 5 minutes.
const REPO_LIST_LIMIT = "200";
const RUN_LIST_LIMIT = "20";

// `gh run list --json` field set. `databaseId` is the numeric run id used
// by `gh run view`; `name` is the workflow display name (e.g. "CI", "Deploy").
// `headBranch` and `headSha` are needed for source_id stability and title;
// `event` and `conclusion` aren't strictly required but make the body
// metadata easier to scan when debugging.
const RUN_JSON_FIELDS =
  "databaseId,name,headBranch,headSha,event,conclusion,updatedAt,url";

// stale grace before bumping priority. A failing workflow that hasn't moved
// in 3+ days is more likely to need attention than one that failed an hour
// ago and might already be getting retried in CI.
const STALE_AFTER_DAYS = 3;

// Hard upper bound on stored body bytes. The `log-failed` output from a
// large test suite can be megabytes; we cap to ~8 KB so the SQLite row
// stays small and the web UI render stays responsive. 8 KB is enough to
// surface the failing assertion and a short stack trace.
const LOG_BODY_MAX_BYTES = 8 * 1024;

// `log-failed` retrieval has two costs: an extra gh call per failing run
// (rate-limit pressure) and the chance of capturing private values in
// stored bodies (build logs occasionally leak tokens / paths). Default OFF
// — users who want it must opt in via config and accept the trade-off.
const DEFAULT_STORE_BODY = false;

interface RunRow {
  databaseId: number;
  name: string;
  headBranch: string;
  headSha?: string;
  event?: string;
  conclusion?: string;
  updatedAt: string;
  url?: string;
}

interface RepoRow {
  name: string;
  defaultBranchRef?: { name?: string } | null;
}

interface OwnerScope {
  owner: string;
}

export const ghRunFailureAdapter: Adapter = {
  name: "gh_run_failure",

  precheck(ctx: AdapterContext): { skip: true; reason: string } | null {
    // Re-use the existing gh login the rest of the GitHub-side adapters
    // already depend on. If `gh auth status` is failing the user has bigger
    // problems than missing CI failures, so skip rather than throw.
    const res = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
    if (res.error || res.status !== 0) {
      return { skip: true, reason: "gh CLI not authenticated" };
    }
    // Need at least one owner scope. Without `github.user` or `github.orgs`
    // we can't tell whose repos to sweep, and we explicitly do NOT want to
    // ingest CI failures from arbitrary third-party repos the user has
    // happened to clone — those aren't actionable for them.
    if (!ctx.githubUser && (!ctx.githubOrgs || ctx.githubOrgs.length === 0)) {
      return {
        skip: true,
        reason: "github.user / github.orgs not configured in ~/.relay/config.toml",
      };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const scopes = ownerScopes(ctx);
    if (scopes.length === 0) return [];

    // Enumerate repos once and remember each repo's default branch so the
    // priority boost for `main`/`master` failures works for repos that don't
    // happen to use the conventional name.
    const repos = await enumerateRepos(ctx, scopes);
    if (repos.length === 0) return [];

    const storeBody = ctx.ghRunFailure?.storeBody ?? DEFAULT_STORE_BODY;
    const sweeps = repos.map((repo) => fetchRepoRuns(repo, "failure"));
    const results = await Promise.all(sweeps);

    // Collapse (workflow_name, head_branch) duplicates: GitHub keeps a row
    // per run, but `relay today` only needs one task per failing workflow.
    // Keep the most-recently-updated run as the surviving representative.
    const byKey = new Map<string, { repo: RepoMeta; run: RunRow }>();
    for (const result of results) {
      for (const run of result.runs) {
        if (!run.name || !run.headBranch) continue;
        const key = sourceIdFor(result.repo.name, run.name, run.headBranch);
        const existing = byKey.get(key);
        if (!existing || isNewer(run.updatedAt, existing.run.updatedAt)) {
          byKey.set(key, { repo: result.repo, run });
        }
      }
    }

    const tasks: TaskInput[] = [];
    for (const { repo, run } of byKey.values()) {
      const body = storeBody ? await maybeFetchLog(repo, run, ctx) : metadataBody(run);
      tasks.push(rowToTask(repo, run, body));
    }
    return tasks;
  },

  // Resolved sweep: if the same (workflow, branch) pair has produced a
  // successful run more recently than the surviving failure, treat the task
  // as resolved. Anything we can't prove is fixed stays open — better to
  // keep a stale failing task than to silently auto-close one that's still
  // red on `main`.
  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    const scopes = ownerScopes(ctx);
    if (scopes.length === 0) return [];

    const repos = await enumerateRepos(ctx, scopes);
    if (repos.length === 0) return [];

    // Parallel success + failure sweeps so we can decide per-key which side
    // is newer. The success-only sweep is the cheaper fast-path (one extra
    // gh call per repo) compared to fetching every status and filtering
    // client-side.
    const [successSweep, failureSweep] = await Promise.all([
      Promise.all(repos.map((repo) => fetchRepoRuns(repo, "success"))),
      Promise.all(repos.map((repo) => fetchRepoRuns(repo, "failure"))),
    ]);

    const latestFailureAt = new Map<string, string>();
    for (const result of failureSweep) {
      for (const run of result.runs) {
        if (!run.name || !run.headBranch) continue;
        const key = sourceIdFor(result.repo.name, run.name, run.headBranch);
        const prev = latestFailureAt.get(key);
        if (!prev || isNewer(run.updatedAt, prev)) {
          latestFailureAt.set(key, run.updatedAt);
        }
      }
    }

    const resolved: ResolvedSource[] = [];
    for (const result of successSweep) {
      for (const run of result.runs) {
        if (!run.name || !run.headBranch) continue;
        const key = sourceIdFor(result.repo.name, run.name, run.headBranch);
        const failureAt = latestFailureAt.get(key);
        // No matching failure recorded → nothing to close.
        // Failure newer than success → workflow re-broke after the fix; keep open.
        if (failureAt && !isNewer(run.updatedAt, failureAt)) continue;
        resolved.push({ source_type: "gh_run_failure", source_id: key });
      }
    }
    return resolved;
  },
};

interface RepoMeta {
  owner: string;
  name: string;
  defaultBranch: string | null;
}

interface RepoRunResult {
  repo: RepoMeta;
  runs: RunRow[];
}

function ownerScopes(ctx: AdapterContext): OwnerScope[] {
  const scopes: OwnerScope[] = [];
  if (ctx.githubUser) scopes.push({ owner: ctx.githubUser });
  for (const org of ctx.githubOrgs ?? []) scopes.push({ owner: org });
  return scopes;
}

async function enumerateRepos(
  ctx: AdapterContext,
  scopes: OwnerScope[],
): Promise<RepoMeta[]> {
  // `gh repo list <owner>` only lists repos owned by that user/org — exactly
  // the boundary we want. Forks the user contributes to but doesn't own are
  // excluded by design.
  const results = await Promise.all(
    scopes.map(async (scope) => {
      try {
        const rows = (await ghJson([
          "repo",
          "list",
          scope.owner,
          "--limit",
          REPO_LIST_LIMIT,
          "--json",
          "name,defaultBranchRef",
        ])) as RepoRow[];
        return rows.map((row) => ({
          owner: scope.owner,
          name: row.name,
          defaultBranch: row.defaultBranchRef?.name ?? null,
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.log?.(`gh_run_failure: repo list ${scope.owner} failed (${msg})`);
        return [] as RepoMeta[];
      }
    }),
  );
  return results.flat();
}

async function fetchRepoRuns(
  repo: RepoMeta,
  status: "failure" | "success",
): Promise<RepoRunResult> {
  try {
    const runs = (await ghJson([
      "run",
      "list",
      "--repo",
      `${repo.owner}/${repo.name}`,
      "--status",
      status,
      "--limit",
      RUN_LIST_LIMIT,
      "--json",
      RUN_JSON_FIELDS,
    ])) as RunRow[];
    return { repo, runs };
  } catch {
    // Permission errors or repos with Actions disabled show up here as
    // non-zero exits from `gh run list`. Swallow per-repo and continue —
    // a single broken repo shouldn't take down the whole sweep.
    return { repo, runs: [] };
  }
}

function rowToTask(repo: RepoMeta, run: RunRow, body: string): TaskInput {
  const sourceId = sourceIdFor(repo.name, run.name, run.headBranch);
  return {
    source_type: "gh_run_failure",
    source_id: sourceId,
    repo: repo.name,
    title: `CI failing: ${run.name} on ${repo.name}@${run.headBranch}`,
    body,
    status: "open",
    assignee: "self",
    priority: computePriority(repo, run),
    prompt: null,
    files: [],
    context_hash: null,
    session_id: null,
    due_at: null,
    wait_on: "self",
  };
}

export function sourceIdFor(repo: string, workflow: string, branch: string): string {
  return `${repo}:gh-run:${workflow}:${branch}`;
}

/**
 * Priority rules (clamped to [0, 100]):
 *  - default branch failure → 80 (red main, top of inbox)
 *  - any other branch (PR / topic / release) → 65
 *  - +10 if the failing run hasn't moved in `STALE_AFTER_DAYS` days
 *
 * `defaultBranch` may be null when the repo never had a push (or gh
 * couldn't resolve it). In that case we fall back to the conventional
 * `main`/`master` check so the boost still works for the common case.
 */
function computePriority(repo: RepoMeta, run: RunRow): number {
  const isDefault = isDefaultBranch(repo, run.headBranch);
  let priority = isDefault ? 80 : 65;
  if (isStale(run.updatedAt)) priority += 10;
  if (priority > 100) priority = 100;
  if (priority < 0) priority = 0;
  return priority;
}

function isDefaultBranch(repo: RepoMeta, branch: string): boolean {
  if (repo.defaultBranch) return repo.defaultBranch === branch;
  return branch === "main" || branch === "master";
}

function isStale(updatedAt: string): boolean {
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

function isNewer(a: string, b: string): boolean {
  const pa = Date.parse(a);
  const pb = Date.parse(b);
  if (!Number.isFinite(pa)) return false;
  if (!Number.isFinite(pb)) return true;
  return pa > pb;
}

function metadataBody(run: RunRow): string {
  // Cheap default body: just the metadata you'd want to triage at a glance.
  // No extra gh call, no risk of leaking log content.
  const lines = [`run: ${run.url ?? `#${run.databaseId}`}`];
  if (run.event) lines.push(`event: ${run.event}`);
  if (run.conclusion) lines.push(`conclusion: ${run.conclusion}`);
  if (run.headSha) lines.push(`sha: ${run.headSha.slice(0, 12)}`);
  lines.push(`updated_at: ${run.updatedAt}`);
  return lines.join("\n");
}

async function maybeFetchLog(
  repo: RepoMeta,
  run: RunRow,
  ctx: AdapterContext,
): Promise<string> {
  const base = metadataBody(run);
  try {
    const log = await ghText([
      "run",
      "view",
      String(run.databaseId),
      "--repo",
      `${repo.owner}/${repo.name}`,
      "--log-failed",
    ]);
    if (!log.trim()) return base;
    return `${base}\n\n${truncate(log, LOG_BODY_MAX_BYTES)}`;
  } catch (e) {
    // log-failed is best-effort. Some run types (skipped, cancelled) won't
    // have a failing-job log; fall back to the metadata body silently so a
    // log-fetch hiccup doesn't drop the whole task.
    const msg = e instanceof Error ? e.message : String(e);
    ctx.log?.(`gh_run_failure: log fetch failed for ${repo.name} #${run.databaseId} (${msg})`);
    return base;
  }
}

function truncate(text: string, maxBytes: number): string {
  // Byte-aware truncation: `text.length` would be wrong for multi-byte
  // characters in log lines (Japanese error messages, emoji from test
  // frameworks). Cut at maxBytes and append a marker so downstream readers
  // know the body was truncated rather than the workflow log ending there.
  const encoder = new TextEncoder();
  const buf = encoder.encode(text);
  if (buf.byteLength <= maxBytes) return text;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const sliced = decoder.decode(buf.subarray(0, maxBytes));
  return `${sliced}\n…[truncated ${buf.byteLength - maxBytes} bytes]`;
}

/**
 * Run `gh ...` and parse stdout as a JSON array. Mirrors the helper used in
 * `github.ts` / `gh-notification.ts` — kept local so a tweak to one
 * adapter's parsing semantics doesn't accidentally break the others.
 */
function ghJson(args: string[]): Promise<unknown[]> {
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
        reject(new Error(`gh exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) {
          reject(new Error("gh: expected JSON array response"));
          return;
        }
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// `gh run view --log-failed` returns plain text, not JSON; this is the
// text-mode counterpart.
function ghText(args: string[]): Promise<string> {
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
        reject(new Error(`gh exited ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}
