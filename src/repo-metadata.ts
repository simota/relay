import { execFile, spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";

export interface RepoMetadata {
  remoteUrl: string | null;
  githubUrl: string | null;
  defaultBranch: string | null;
  lastCommitSha: string | null;
  lastCommitAt: string | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { meta: RepoMetadata; expiresAt: number }>();

const EMPTY_METADATA: RepoMetadata = {
  remoteUrl: null,
  githubUrl: null,
  defaultBranch: null,
  lastCommitSha: null,
  lastCommitAt: null,
};

const REMOTE_URL = ["remote", "get-url", "origin"];
const REMOTE_HEAD = ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"];
const CURRENT_BRANCH = ["branch", "--show-current"];
// One `git log` for both fields ("<sha>\n<committer unix time>"); they
// succeed or fail together, as the two separate calls did.
const LAST_COMMIT = ["log", "-1", "--format=%H%n%ct"];

/** Derive RepoMetadata from the raw (trimmed, null-on-failure) git outputs. */
function buildMetadata(
  remoteUrl: string | null,
  defaultBranch: string | null,
  lastCommitOut: string | null,
): RepoMetadata {
  const lastCommit = lastCommitOut?.split("\n") ?? null;
  const lastCommitSha = lastCommit?.[0]?.slice(0, 10) || null;
  const lastCommitUnix = lastCommit?.[1] || null;
  return {
    remoteUrl: remoteUrl ?? null,
    githubUrl: remoteUrl ? normalizeGithubUrl(remoteUrl) : null,
    defaultBranch,
    lastCommitSha,
    lastCommitAt: lastCommitUnix ? new Date(Number(lastCommitUnix) * 1000).toISOString() : null,
  };
}

function cachedMetadata(repoPath: string): RepoMetadata | null {
  const cached = cache.get(repoPath);
  return cached && cached.expiresAt > Date.now() ? cached.meta : null;
}

function storeMetadata(repoPath: string, meta: RepoMetadata): RepoMetadata {
  cache.set(repoPath, { meta, expiresAt: Date.now() + CACHE_TTL_MS });
  return meta;
}

export function readRepoMetadata(repoPath: string | null): RepoMetadata {
  if (!repoPath) return { ...EMPTY_METADATA };
  const cached = cachedMetadata(repoPath);
  if (cached) return cached;
  const remoteUrl = git(repoPath, REMOTE_URL);
  // `symbolic-ref` is local-only; for repos without a remote HEAD set,
  // falls back to whatever branch is currently checked out via `branch --show-current`.
  const defaultBranch =
    git(repoPath, REMOTE_HEAD)?.replace(/^origin\//, "") ?? git(repoPath, CURRENT_BRANCH);
  return storeMetadata(repoPath, buildMetadata(remoteUrl, defaultBranch, git(repoPath, LAST_COMMIT)));
}

// Upper bound on git processes prefetchRepoMetadata keeps running at once.
const GIT_CONCURRENCY = Math.max(2, Math.min(8, availableParallelism() * 2));
let gitRunning = 0;
const gitWaiters: Array<() => void> = [];

async function gitLimited(cwd: string, args: string[]): Promise<string | null> {
  // A finishing command hands its slot straight to the next waiter, so the
  // running count never exceeds GIT_CONCURRENCY.
  if (gitRunning >= GIT_CONCURRENCY) await new Promise<void>((r) => gitWaiters.push(r));
  else gitRunning++;
  try {
    return await gitAsync(cwd, args);
  } finally {
    const next = gitWaiters.shift();
    if (next) next();
    else gitRunning--;
  }
}

const inflight = new Map<string, Promise<void>>();

async function fetchMetadata(repoPath: string): Promise<void> {
  // The three lookups are independent read-only commands, so they run side
  // by side; the branch fallback runs only when there is no remote HEAD,
  // exactly as in readRepoMetadata.
  const [remoteUrl, remoteHead, lastCommit] = await Promise.all([
    gitLimited(repoPath, REMOTE_URL),
    gitLimited(repoPath, REMOTE_HEAD),
    gitLimited(repoPath, LAST_COMMIT),
  ]);
  const defaultBranch =
    remoteHead?.replace(/^origin\//, "") ?? (await gitLimited(repoPath, CURRENT_BRANCH));
  storeMetadata(repoPath, buildMetadata(remoteUrl, defaultBranch, lastCommit));
}

/**
 * Warm the metadata cache for `repoPaths` (null / already-cached paths are
 * skipped) with the same git commands as readRepoMetadata, run concurrently
 * across repos (at most GIT_CONCURRENCY git processes at a time), so a
 * listing's later readRepoMetadata calls hit the cache instead of spawning
 * every command one after another. Concurrent callers share one lookup per
 * path. Never rejects: a failed command yields null as in readRepoMetadata.
 */
export async function prefetchRepoMetadata(repoPaths: Iterable<string | null>): Promise<void> {
  const jobs: Array<Promise<void>> = [];
  for (const repoPath of new Set(repoPaths)) {
    if (!repoPath || cachedMetadata(repoPath)) continue;
    let job = inflight.get(repoPath);
    if (!job) {
      job = fetchMetadata(repoPath).finally(() => inflight.delete(repoPath));
      inflight.set(repoPath, job);
    }
    jobs.push(job);
  }
  await Promise.all(jobs);
}

export function deriveGithubUrlFromSourceId(sourceId: string): string | null {
  const m = sourceId.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/(issues|pull)\/\d+/);
  return m ? (m[1] ?? null) : null;
}

import { basename } from "node:path";
import { repoExistsOnDisk, type Config } from "./config.js";
import { resolveRepoPath } from "./repo-resolver.js";

// Returns the subset of `candidates` that no longer exist on disk — neither
// under a scan root nor as a tracked_repos path (same rule as the sync
// sweep, see repoExistsOnDisk). Used to filter missing-repo tasks out of
// Today's queue / `relay today` without mutating their DB status — the
// task is preserved in case the repo gets re-cloned.
export function findMissingRepos(candidates: string[], cfg: Config): string[] {
  if (candidates.length === 0) return [];
  if (cfg.scan.roots.length === 0 && cfg.scan.tracked_repos.length === 0) return [];
  return candidates.filter((name) => !repoExistsOnDisk(name, cfg));
}

function normalizeGithubUrl(remote: string): string | null {
  // SSH form: git@github.com:owner/repo.git
  const ssh = remote.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;
  // HTTPS form: https://github.com/owner/repo[.git]
  const https = remote.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?(?:\/)?$/);
  if (https) return `https://github.com/${https[1]}/${https[2]}`;
  return null;
}

const GIT_TIMEOUT_MS = 2000;

function git(cwd: string, args: string[]): string | null {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  if (proc.status !== 0) return null;
  const out = proc.stdout?.trim() ?? "";
  return out.length > 0 ? out : null;
}

/** Async twin of git(): same command, timeout and null-on-failure rule. */
function gitAsync(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
      if (err) return resolve(null);
      const out = stdout.trim();
      resolve(out.length > 0 ? out : null);
    });
  });
}

/**
 * Directory lookup used by the repo listing and the headline repo count.
 * An explicit `scan.tracked_repos` pin wins over a same-named directory
 * under `scan.roots`, so both views agree on which checkout a card
 * describes. Keep `/api/repos` and `/api/counts` on this single rule.
 */
export function createRepoPathLookup(cfg: Config): (name: string) => string | null {
  const trackedByName = new Map<string, string>();
  for (const p of cfg.scan.tracked_repos) trackedByName.set(basename(p), p);
  return (name) => trackedByName.get(name) ?? resolveRepoPath(name, cfg);
}
