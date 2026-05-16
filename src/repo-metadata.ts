import { spawnSync } from "node:child_process";

export interface RepoMetadata {
  remoteUrl: string | null;
  githubUrl: string | null;
  defaultBranch: string | null;
  lastCommitSha: string | null;
  lastCommitAt: string | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { meta: RepoMetadata; expiresAt: number }>();

export function readRepoMetadata(repoPath: string | null): RepoMetadata {
  const empty: RepoMetadata = {
    remoteUrl: null,
    githubUrl: null,
    defaultBranch: null,
    lastCommitSha: null,
    lastCommitAt: null,
  };
  if (!repoPath) return empty;

  const cached = cache.get(repoPath);
  if (cached && cached.expiresAt > Date.now()) return cached.meta;

  const remoteUrl = git(repoPath, ["remote", "get-url", "origin"]);
  const githubUrl = remoteUrl ? normalizeGithubUrl(remoteUrl) : null;
  // `symbolic-ref` is local-only; for repos without a remote HEAD set,
  // falls back to whatever branch is currently checked out via `branch --show-current`.
  const defaultBranch =
    git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.replace(/^origin\//, "") ??
    git(repoPath, ["branch", "--show-current"]);
  const lastCommitSha = git(repoPath, ["log", "-1", "--format=%H"])?.slice(0, 10) ?? null;
  const lastCommitUnix = git(repoPath, ["log", "-1", "--format=%ct"]);
  const lastCommitAt = lastCommitUnix
    ? new Date(Number(lastCommitUnix) * 1000).toISOString()
    : null;

  const meta: RepoMetadata = {
    remoteUrl: remoteUrl ?? null,
    githubUrl,
    defaultBranch,
    lastCommitSha,
    lastCommitAt,
  };
  cache.set(repoPath, { meta, expiresAt: Date.now() + CACHE_TTL_MS });
  return meta;
}

export function deriveGithubUrlFromSourceId(sourceId: string): string | null {
  const m = sourceId.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/(issues|pull)\/\d+/);
  return m ? (m[1] ?? null) : null;
}

import { existsSync } from "node:fs";
import { join } from "node:path";

// Returns the subset of `candidates` whose directory does not exist under
// any configured scan root. Used to filter missing-repo tasks out of
// Today's queue / `relay today` without mutating their DB status — the
// task is preserved in case the repo gets re-cloned.
export function findMissingRepos(candidates: string[], roots: string[]): string[] {
  if (candidates.length === 0 || roots.length === 0) return [];
  return candidates.filter((name) => !roots.some((root) => existsSync(join(root, name))));
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

function git(cwd: string, args: string[]): string | null {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 2000 });
  if (proc.status !== 0) return null;
  const out = proc.stdout?.trim() ?? "";
  return out.length > 0 ? out : null;
}
