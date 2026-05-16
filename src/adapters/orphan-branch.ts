import { existsSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

/**
 * Sweep every repo under `scan.roots` (+ `tracked_repos`) for *orphan*
 * branches — local branches that have been pushed to a remote but never
 * landed in a PR. They are invisible to `github_pr` (no PR exists yet)
 * and to `code_todo` (the work is committed, not a TODO marker), so a
 * 40-repo home tree silently accumulates "finished but un-shipped" WIP
 * that decays out of the user's awareness.
 *
 * Companion to `git_stash` (PR #97) and `git_interrupted` (PR #96):
 * those catch stashed-but-forgotten and mid-rebase WIP; this one catches
 * the "pushed three commits, switched context, forgot to open the PR"
 * trap.
 *
 * Rate-limit strategy (the #1 design constraint):
 *  - We need `(repository.name, headRefName, state)` tuples for every
 *    PR the user has ever opened, in as few API calls as possible. The
 *    naive `gh pr list --head <branch>` would burn ~200 API calls on a
 *    40-repo × 5-branch tree and trip GitHub's secondary rate limit.
 *  - `gh search prs --json headRefName` is **not available** — the
 *    search API exposes only `assignees,author,...,url` and omits the
 *    head ref. Verified with `gh search prs --json head` ⇒ "Unknown
 *    JSON field". So search-based approaches don't work.
 *  - Solution: GraphQL `viewer.pullRequests` returns `headRefName`
 *    directly. We page 100 PRs per request via `endCursor`, capped at
 *    `MAX_PR_PAGES` × 100 PRs. That's ~10 calls for a power user with
 *    1000 lifetime PRs, vs 200+ for the per-branch approach.
 *  - The PR map is keyed by `${repo}/${headRefName}`; a branch hits if
 *    any PR (open OR closed/merged) ever existed for it. The git side
 *    is local-only — `git for-each-ref` is a single in-memory walk of
 *    `.git/refs/heads`, no network involved.
 */

// Priority decays linearly with age. Fresh orphan (today) lands at 65
// (between gh_run_failure default-branch=80 and git_stash fresh=70),
// then loses 2 points per day until it bottoms out at 40 — still above
// the generic code_todo baseline so a months-old orphan branch stays
// visible without dominating Today.
const PRIORITY_BASE = 65;
const PRIORITY_PER_DAY = 2;
const PRIORITY_FLOOR = 40;

// Branches younger than 1 day are skipped — fresh feature work in
// progress shouldn't be flagged as "orphan" the moment its first commit
// lands. Matches the AC ("age >= 1 day").
const MIN_AGE_DAYS = 1;

// GraphQL `viewer.pullRequests` page size and cap. 100 / page is the
// GitHub maximum; `MAX_PR_PAGES` × 100 = 1000 PR ceiling matches the
// `gh search prs` API cap so we keep the same "ships with a power-user
// roll-off after 1000 lifetime PRs" guarantee. Older closed PRs falling
// off only causes us to miss branches whose PR has already shipped —
// safe to drop from inbox surfacing.
const PR_PAGE_SIZE = 100;
const MAX_PR_PAGES = 10;

// `git log --oneline` body cap. 20 commits is plenty to remind the user
// what the branch was doing without bloating the SQLite row. body fetch
// is opt-in so the default sync stays light.
const BODY_LOG_MAX_LINES = 20;

// Per-call `git` subprocess time-bound. A pathological repo (huge ref
// table, slow filesystem) shouldn't stall the whole 40-repo sweep.
const GIT_CALL_TIMEOUT_MS = 1500;

// Concurrency cap for the per-branch `git rev-list --count` /
// `git log --oneline` fan-out. Each branch costs 1-2 git subprocess
// spawns (`countAhead`, optionally `readCommitLog`); on a 40-repo tree
// with 5-10 candidate branches each this is the dominant cost.
// 6 is the empirical sweet spot for local-disk SSD git on macOS/Linux —
// git subprocesses are I/O-bound (object DB reads), so saturation
// happens between 4-8 concurrent spawns; higher values trade off against
// fork overhead and disk queue contention.
const BRANCH_GIT_CONCURRENCY = 6;

// Default patterns to ignore. Release / hotfix branches are typically
// long-lived collaborative refs, not "I forgot to open a PR" candidates.
// Users can override via `[orphan_branch].exclude_patterns`.
const DEFAULT_EXCLUDE_PATTERNS = ["release/*", "hotfix/*"];

// `git for-each-ref refs/heads/` line layout — see FORMAT below.
//   %(refname:short)       → bare branch name (e.g. `feat/oauth-pkce`)
//   %(committerdate:iso8601) → committer date of the tip commit
//   %(upstream:short)      → tracking branch (`origin/feat/oauth-pkce`)
//                            or empty if `git push -u` was never run
//   %(objectname:short)    → 7-char abbreviated tip SHA — used in
//                            source_id so amend/rebase produces a new
//                            task (the old one closes via fetchResolved)
const REF_FORMAT = "%(refname:short)|%(committerdate:iso8601)|%(upstream:short)|%(objectname:short)";

interface LocalBranch {
  name: string;
  committerDate: string;
  upstream: string;
  tipShort: string;
}

interface PrEntry {
  // Lower-cased PR state: 'open' | 'closed' | 'merged'. GraphQL
  // returns UPPER_CASE enums; we normalise so the rest of the adapter
  // can compare case-insensitively.
  state: string;
  url: string;
}

export const orphanBranchAdapter: Adapter = {
  name: "orphan_branch",

  precheck(ctx: AdapterContext): { skip: true; reason: string } | null {
    // 1. git binary present? `git --version` is the cheapest probe;
    //    same shape as `git_stash` precheck for consistency.
    const gitProbe = spawnSync("git", ["--version"], { encoding: "utf8" });
    if (gitProbe.error || gitProbe.status !== 0) {
      return { skip: true, reason: "git CLI not found in PATH" };
    }
    // 2. gh authenticated? The whole PR-mapping half depends on it; we
    //    cannot reliably classify orphan vs PR-backed without the
    //    `gh search prs` call.
    const ghProbe = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
    if (ghProbe.error || ghProbe.status !== 0) {
      return { skip: true, reason: "gh CLI not authenticated" };
    }
    // 3. At least one git repo under scan.roots or tracked_repos.
    //    Shallow walk only — same pattern as git_stash / git_interrupted.
    for (const root of ctx.roots) {
      if (!existsSync(root)) continue;
      let entries: string[] = [];
      try {
        entries = readdirSync(root);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        if (existsSync(join(root, entry, ".git"))) return null;
      }
    }
    if (ctx.trackedRepos) {
      for (const trackedPath of ctx.trackedRepos) {
        if (existsSync(join(trackedPath, ".git"))) return null;
      }
    }
    return { skip: true, reason: "no .git directories found under scan.roots" };
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const { tasks } = await scanCurrent(ctx);
    return tasks;
  },

  /**
   * Diff the *currently-orphan* source_id set against the DB's open
   * `orphan_branch` source_ids. Anything the DB knows about but the
   * live sweep no longer flags as orphan has been resolved — either
   * the branch was deleted, the tip was amended/rebased (different
   * `tip_short_sha`), or a PR was opened for it. Emit those source_ids
   * so `autoCloseResolvedRemoteTasks` closes them (undo-able).
   *
   * If `ctx.knownOpenSourceIds` isn't wired (unit-test harness), we
   * degrade to a no-op: `fetch()` still ingests current orphans
   * idempotently, the user just has to close resolved tasks manually.
   */
  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    if (!ctx.knownOpenSourceIds) return [];

    const { liveSourceIds } = await scanCurrent(ctx);
    const known = ctx.knownOpenSourceIds("orphan_branch");
    if (known.length === 0) return [];

    const live = new Set(liveSourceIds);
    const resolved: ResolvedSource[] = [];
    for (const sourceId of known) {
      if (live.has(sourceId)) continue;
      resolved.push({ source_type: "orphan_branch", source_id: sourceId });
    }
    return resolved;
  },
};

interface ScanResult {
  tasks: TaskInput[];
  /** Source IDs visible *right now* — used by `fetchResolved` for the diff. */
  liveSourceIds: string[];
}

async function scanCurrent(ctx: AdapterContext): Promise<ScanResult> {
  const repos = await enumerateGitRepos(ctx);
  if (repos.length === 0) return { tasks: [], liveSourceIds: [] };

  const storeBody = ctx.orphanBranch?.storeBody ?? false;
  const excludePatterns =
    ctx.orphanBranch?.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
  const now = Date.now();

  // 1 step: one `gh search prs --author=@me` call covers every repo. The
  // result map keys are `${repo}/${headRefName}`, so a branch hit only
  // requires an O(1) lookup downstream — no per-branch API call.
  const prMap = await fetchPrMap(ctx);

  // 2 step: per-repo branch scan, fully parallel. Each repo costs three
  // local `git` calls (default branch, for-each-ref, and optionally
  // `rev-list --count` per orphan candidate) — no network, so the
  // wall-clock budget is dominated by `gh search prs` above.
  const perRepo = await Promise.all(
    repos.map(async (repoDir) => {
      const repo = basename(repoDir);
      const defaultBranch = await detectDefaultBranch(repoDir);
      const branches = await listLocalBranches(repoDir);
      return { repo, repoDir, defaultBranch, branches };
    }),
  );

  // 3 step: collect every (repo, branch) pair that passes the static
  // filters (1-5) — these are pure in-memory checks with no I/O. The
  // expensive per-branch git subprocess work (`countAhead`,
  // `readCommitLog`) is deferred to the parallel fan-out below so we
  // don't serialise N subprocess spawns across the whole sweep.
  interface Candidate {
    repo: string;
    repoDir: string;
    defaultBranch: string | null;
    branch: LocalBranch;
    ageDays: number;
  }
  const candidates: Candidate[] = [];

  for (const { repo, repoDir, defaultBranch, branches } of perRepo) {
    if (branches.length === 0) continue;

    for (const branch of branches) {
      // Filter 1: skip the default branch — never an orphan.
      if (defaultBranch && branch.name === defaultBranch) continue;
      // Filter 2: skip branches that were never pushed. `upstream:short`
      // is empty when `git push -u` has not been run, so the branch is
      // local-only WIP and not "PR-less pushed work".
      if (!branch.upstream) continue;
      // Filter 3: user-configurable protected patterns (`release/*`,
      // `hotfix/*` by default).
      if (matchesAnyPattern(branch.name, excludePatterns)) continue;
      // Filter 4: too-fresh branches. Today's commit on `feat/foo` is
      // not yet an orphan; raising the alarm at age 1d gives the user
      // a chance to open the PR naturally.
      const ageDays = computeAgeDays(now, branch.committerDate);
      if (ageDays < MIN_AGE_DAYS) continue;
      // Filter 5: skip if a PR exists for this `${repo}/${branch}`.
      //  - state === 'open'              → not orphan, ongoing review
      //  - state === 'closed' / 'merged' → resolved, no need to re-flag
      // The original issue specifies "skip" for both — once a PR has
      // existed, the work either shipped or was abandoned consciously,
      // and re-surfacing it weeks later as "orphan" is noise.
      const prKey = `${repo}/${branch.name}`;
      if (prMap.has(prKey)) continue;

      candidates.push({ repo, repoDir, defaultBranch, branch, ageDays });
    }
  }

  // 4 step: parallel fan-out — for each surviving candidate, spawn the
  // 1-2 git subprocesses (`rev-list --count`, optionally `log --oneline`)
  // that compute the ahead-count and body. These are I/O-bound and
  // independent, so we run them with a bounded concurrency
  // (`BRANCH_GIT_CONCURRENCY`) via a batched `Promise.all` — no new
  // npm dep, no semaphore library. `runGit` already swallows errors
  // (returns null), so one bad subprocess can't poison the batch.
  const computed = new Array<TaskInput>(candidates.length);
  for (let start = 0; start < candidates.length; start += BRANCH_GIT_CONCURRENCY) {
    const batch = candidates.slice(start, start + BRANCH_GIT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ repo, repoDir, defaultBranch, branch, ageDays }) => {
        const base = defaultBranch ?? "(unknown)";
        const ahead = defaultBranch
          ? await countAhead(repoDir, defaultBranch, branch.name)
          : null;

        const sourceId = sourceIdFor(repo, branch.name, branch.tipShort);
        const title = renderTitle(branch.name, ahead, base);
        const body = await renderBody(
          repoDir,
          branch,
          repo,
          base,
          ahead,
          ageDays,
          storeBody,
        );

        const task: TaskInput = {
          source_type: "orphan_branch",
          source_id: sourceId,
          repo,
          title,
          body,
          status: "open",
          assignee: "self",
          priority: computePriority(ageDays),
          prompt: null,
          files: [],
          context_hash: null,
          session_id: null,
          due_at: null,
          wait_on: "self",
        };
        return { sourceId, task };
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      computed[start + i] = r.task;
    }
  }

  const tasks: TaskInput[] = [];
  const liveSourceIds: string[] = [];
  for (const task of computed) {
    if (!task) continue;
    tasks.push(task);
    liveSourceIds.push(task.source_id);
  }

  return { tasks, liveSourceIds };
}

function sourceIdFor(repo: string, branch: string, tipShort: string): string {
  // tip short sha is part of the id on purpose: a `git commit --amend`
  // or rebase moves the tip → produces a new source_id → the old one
  // falls off `liveSourceIds` and gets closed by `fetchResolved`. This
  // mirrors the design choice in `git_stash` where the oid anchors
  // identity through reflog shuffling.
  return `${repo}:orphan-branch:${branch}:${tipShort}`;
}

function computePriority(days: number): number {
  const raw = PRIORITY_BASE - days * PRIORITY_PER_DAY;
  if (raw < PRIORITY_FLOOR) return PRIORITY_FLOOR;
  if (raw > 100) return 100;
  return raw;
}

function computeAgeDays(now: number, isoDate: string): number {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return 0;
  const ms = Math.max(0, now - parsed);
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function renderTitle(branch: string, ahead: number | null, base: string): string {
  // `Orphan: ${branch} (+${ahead} commits ahead of ${base})`. When ahead
  // count is unknown (no default branch detected, or rev-list failed),
  // fall back to the branch-only form to keep the title scannable.
  if (ahead === null || ahead < 0) {
    return `Orphan: ${branch}`;
  }
  const noun = ahead === 1 ? "commit" : "commits";
  return `Orphan: ${branch} (+${ahead} ${noun} ahead of ${base})`;
}

/**
 * Render the task body. Metadata is always present so `relay show` is
 * informative even when storeBody is off; the `git log --oneline` block
 * is gated on `[orphan_branch].store_body = true` because individual
 * commit subjects can leak local-only context (internal repo names,
 * customer identifiers, accidental WIP secrets).
 */
async function renderBody(
  repoDir: string,
  branch: LocalBranch,
  repo: string,
  base: string,
  ahead: number | null,
  ageDays: number,
  storeBody: boolean,
): Promise<string> {
  const lines: string[] = [];
  lines.push(`branch: ${branch.name}`);
  lines.push(`tip: ${branch.tipShort}`);
  lines.push(`upstream: ${branch.upstream}`);
  lines.push(`base: ${base}`);
  if (ahead !== null && ahead >= 0) lines.push(`ahead: ${ahead}`);
  lines.push(`age: ${ageDays}d (since ${branch.committerDate})`);
  lines.push(`repo: ${repo}`);

  if (storeBody && base !== "(unknown)") {
    const log = await readCommitLog(repoDir, base, branch.name);
    if (log) {
      lines.push("");
      lines.push("```");
      lines.push(log);
      lines.push("```");
    }
  }

  return lines.join("\n");
}

async function readCommitLog(
  repoDir: string,
  base: string,
  branch: string,
): Promise<string | null> {
  const out = await runGit(
    repoDir,
    [
      "log",
      "--oneline",
      "--no-merges",
      `--max-count=${BODY_LOG_MAX_LINES}`,
      `${base}..${branch}`,
    ],
    GIT_CALL_TIMEOUT_MS,
  );
  if (!out || out.trim() === "") return null;
  return out.trimEnd();
}

/**
 * Resolve the repo's default branch. Two probes, in order:
 *
 *   1. `git symbolic-ref --short refs/remotes/origin/HEAD`
 *      Works when `git remote set-head origin --auto` has been run (the
 *      common case for repos cloned recently or with a configured
 *      remote HEAD).
 *   2. `git rev-parse --abbrev-ref origin/HEAD`
 *      Same data, different surface — survives a few edge cases where
 *      symbolic-ref errors out (detached HEAD on the remote, partial
 *      clone). Returns e.g. `origin/main`.
 *
 * Both yield strings like `origin/main`; we strip the `origin/` prefix
 * so the caller can compare against bare local branch names. If neither
 * works (no `origin` remote, fresh clone with no fetch yet), we return
 * `null` and the caller falls back to "skip the default-branch filter
 * and report ahead=null".
 */
async function detectDefaultBranch(repoDir: string): Promise<string | null> {
  const probe1 = await runGit(
    repoDir,
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    GIT_CALL_TIMEOUT_MS,
  );
  const trimmed1 = probe1?.trim() ?? "";
  if (trimmed1.length > 0) {
    return trimmed1.replace(/^origin\//, "");
  }
  const probe2 = await runGit(
    repoDir,
    ["rev-parse", "--abbrev-ref", "origin/HEAD"],
    GIT_CALL_TIMEOUT_MS,
  );
  const trimmed2 = probe2?.trim() ?? "";
  if (trimmed2.length === 0 || trimmed2 === "origin/HEAD") return null;
  return trimmed2.replace(/^origin\//, "");
}

/**
 * `git for-each-ref refs/heads/ --format=<REF_FORMAT>`. Empty repos
 * (no commits yet) and corrupt repos both yield empty arrays —
 * silently, so one bad repo doesn't abort the 40-repo sweep.
 */
async function listLocalBranches(repoDir: string): Promise<LocalBranch[]> {
  const out = await runGit(
    repoDir,
    ["for-each-ref", "refs/heads/", `--format=${REF_FORMAT}`],
    GIT_CALL_TIMEOUT_MS,
  );
  if (out === null) return [];
  const lines = out.split("\n");
  const branches: LocalBranch[] = [];
  for (const line of lines) {
    if (line === "") continue;
    const parsed = parseRefLine(line);
    if (parsed) branches.push(parsed);
  }
  return branches;
}

/**
 * Split on `|` but stop after 3 separators so a branch name containing
 * `|` (rare but legal — `git check-ref-format` only forbids `~^:?*[\`,
 * spaces, and a few path-style sequences) round-trips intact. The 4th
 * field captures the rest verbatim. Mirrors `git_stash`'s splitFirstN.
 */
function parseRefLine(line: string): LocalBranch | null {
  const parts = splitFirstN(line, "|", 3);
  if (parts.length < 4) return null;
  const [name, date, upstream, tipShort] = parts;
  if (!name || !date || tipShort === undefined) return null;
  if (tipShort.length === 0) return null;
  return {
    name,
    committerDate: date,
    upstream: upstream ?? "",
    tipShort,
  };
}

function splitFirstN(s: string, sep: string, n: number): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < n; i++) {
    const idx = s.indexOf(sep, from);
    if (idx === -1) {
      out.push(s.slice(from));
      return out;
    }
    out.push(s.slice(from, idx));
    from = idx + sep.length;
  }
  out.push(s.slice(from));
  return out;
}

async function countAhead(
  repoDir: string,
  base: string,
  branch: string,
): Promise<number | null> {
  const out = await runGit(
    repoDir,
    ["rev-list", "--count", `${base}..${branch}`],
    GIT_CALL_TIMEOUT_MS,
  );
  if (out === null) return null;
  const n = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Glob-ish match. We deliberately *don't* pull in `minimatch`: the only
 * patterns we need to support are `prefix/*` (e.g. `release/*`,
 * `hotfix/*`, `wip/*`). A literal exact-match fallback (`pattern ===
 * name`) covers users who want to exclude a single named branch.
 *
 *   pattern = "release/*"  matches any name starting with "release/"
 *   pattern = "main"       matches the literal "main"
 *
 * Anything more elaborate is intentionally out of scope — if someone
 * needs character classes, they can list each branch by name.
 */
function matchesAnyPattern(name: string, patterns: ReadonlyArray<string>): boolean {
  for (const raw of patterns) {
    const p = raw.trim();
    if (p.length === 0) continue;
    if (p.endsWith("/*")) {
      const prefix = p.slice(0, -1); // keeps the trailing "/"
      if (name.startsWith(prefix)) return true;
    } else if (p === name) {
      return true;
    }
  }
  return false;
}

/**
 * Fetch the user's lifetime PR set via GraphQL `viewer.pullRequests`.
 *
 * Why not `gh search prs`? Because `--json headRefName` is rejected
 * with "Unknown JSON field" — the search API does not expose head
 * branch names. GraphQL `viewer.pullRequests.nodes.headRefName` does.
 *
 * Paging: 100 PRs per request via `endCursor`, capped at 10 pages =
 * 1000 PRs. Matches the `gh search prs` 1000-result historical cap.
 * A power user with >1000 lifetime PRs gets the oldest closed PRs
 * rolled off, which only causes us to miss branches whose PR has
 * already shipped (safe).
 *
 * On any failure (gh missing — though precheck should have caught it,
 * auth glitch, rate-limit), we return an empty map. With an empty map
 * every branch survives filter 5 → the adapter falls back to "report
 * every branch that passes filters 1-4". That's a graceful degrade,
 * not a silent regression: the user sees more orphan-branch tasks
 * than usual on the next sync, which is the correct alert behaviour
 * when the PR API is unavailable.
 */
async function fetchPrMap(
  ctx: AdapterContext,
): Promise<Map<string, PrEntry>> {
  const map = new Map<string, PrEntry>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PR_PAGES; page++) {
    let pageRows: GraphQlPrNode[];
    let endCursor: string | null;
    let hasNext: boolean;
    try {
      const result = await fetchPrPage(cursor);
      pageRows = result.nodes;
      endCursor = result.endCursor;
      hasNext = result.hasNext;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.log?.(`orphan_branch: gh graphql viewer.pullRequests failed (${msg})`);
      return map.size > 0 ? map : new Map();
    }
    for (const row of pageRows) {
      const repo = row.repository?.name;
      const branch = row.headRefName;
      const url = row.url;
      if (!repo || !branch || !url) continue;
      const key = `${repo}/${branch}`;
      const state = (row.state ?? "").toLowerCase();
      // If multiple PRs ever existed for the same branch, prefer the
      // 'open' record so we treat the branch as PR-backed (and don't
      // accidentally re-surface a branch with an open PR just because
      // an earlier merged PR shared the head ref). Otherwise first-
      // seen wins; either way we drop the branch from orphan
      // candidates.
      const existing = map.get(key);
      if (existing && existing.state === "open") continue;
      map.set(key, { state, url });
    }
    if (!hasNext || !endCursor) break;
    cursor = endCursor;
  }
  return map;
}

interface GraphQlPrNode {
  url?: string;
  headRefName?: string;
  state?: string;
  repository?: { name?: string };
}

interface PrPageResult {
  nodes: GraphQlPrNode[];
  endCursor: string | null;
  hasNext: boolean;
}

const VIEWER_PR_QUERY = `query($cursor: String, $pageSize: Int!) {
  viewer {
    pullRequests(first: $pageSize, after: $cursor, states: [OPEN, CLOSED, MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { url state headRefName repository { name } }
    }
  }
}`;

/**
 * Single GraphQL page. `gh api graphql` accepts `-f query=...` and
 * variables via `-F key=value` (integers) / `-f key=value` (strings).
 * We pass cursor only when non-null so the first page omits it.
 */
async function fetchPrPage(cursor: string | null): Promise<PrPageResult> {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${VIEWER_PR_QUERY}`,
    "-F",
    `pageSize=${PR_PAGE_SIZE}`,
  ];
  if (cursor !== null) {
    args.push("-f", `cursor=${cursor}`);
  }
  const raw = await ghApiText(args);
  const parsed = JSON.parse(raw) as GraphQlResponse;
  // Surface query errors so the caller can log and degrade. GraphQL
  // errors arrive in `errors[]` even when stdout is exit 0.
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const first = parsed.errors[0]?.message ?? "unknown error";
    throw new Error(`graphql: ${first}`);
  }
  const conn = parsed.data?.viewer?.pullRequests;
  return {
    nodes: conn?.nodes ?? [],
    endCursor: conn?.pageInfo?.endCursor ?? null,
    hasNext: conn?.pageInfo?.hasNextPage ?? false,
  };
}

interface GraphQlResponse {
  data?: {
    viewer?: {
      pullRequests?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: GraphQlPrNode[];
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

/**
 * Same shallow-walk pattern as `git_stash` / `git_interrupted`: one
 * level under each `scan.roots` entry plus any absolute paths in
 * `tracked_repos`. The Set dedupe means a tracked repo that also lives
 * under a root contributes exactly one entry.
 */
async function enumerateGitRepos(ctx: AdapterContext): Promise<string[]> {
  const repos = new Set<string>();

  for (const root of ctx.roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const repoDir = join(root, entry.name);
      if (existsSync(join(repoDir, ".git"))) {
        repos.add(repoDir);
      }
    }
  }

  if (ctx.trackedRepos) {
    for (const trackedPath of ctx.trackedRepos) {
      if (existsSync(join(trackedPath, ".git"))) {
        repos.add(trackedPath);
      }
    }
  }

  return [...repos];
}

/**
 * Spawn `git <args>` in `repoDir`. Returns stdout on exit 0 or `null`
 * on any failure. Stays silent on stderr by design: one corrupt repo
 * must not abort the whole sweep. Mirrors the helper in `git_stash`.
 */
function runGit(
  repoDir: string,
  args: string[],
  timeoutMs?: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, {
      cwd: repoDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore — child may already be dead
        }
        finish(null);
      }, timeoutMs);
    }
    proc.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    proc.on("error", () => {
      if (timer) clearTimeout(timer);
      finish(null);
    });
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(stdout);
    });
  });
}

/**
 * Spawn `gh <args>` and return stdout as a raw string. Throws on
 * non-zero exit. JSON parsing happens at the call site so each caller
 * picks the shape (`{ data, errors }` vs array). Same helper pattern
 * as `github.ts` / `gh-notification.ts` but text-based to accommodate
 * GraphQL's envelope.
 */
function ghApiText(args: string[]): Promise<string> {
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
