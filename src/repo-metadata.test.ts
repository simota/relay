import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefetchRepoMetadata, readRepoMetadata } from "./repo-metadata.js";

function git(cwd: string, ...args: string[]): string {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_COMMITTER_DATE: "2024-05-06T07:08:09Z", GIT_AUTHOR_DATE: "2024-05-06T07:08:09Z" },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

describe("readRepoMetadata", () => {
  test("reads remote, branch and last commit from a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-meta-"));
    try {
      git(dir, "init", "-q", "-b", "trunk");
      git(dir, "remote", "add", "origin", "git@github.com:acme/widgets.git");
      writeFileSync(join(dir, "a.txt"), "a\n");
      git(dir, "add", ".");
      git(dir, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init");
      const sha = git(dir, "rev-parse", "HEAD");
      // A global `url.<base>.insteadOf` may rewrite the stored URL; both
      // spellings normalize to the same github_url.
      const remote = git(dir, "remote", "get-url", "origin");

      expect(readRepoMetadata(dir)).toEqual({
        remoteUrl: remote,
        githubUrl: "https://github.com/acme/widgets",
        defaultBranch: "trunk",
        lastCommitSha: sha.slice(0, 10),
        lastCommitAt: "2024-05-06T07:08:09.000Z",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a repo without commits has no last-commit fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-meta-"));
    try {
      git(dir, "init", "-q", "-b", "main");
      const meta = readRepoMetadata(dir);
      expect(meta.lastCommitSha).toBeNull();
      expect(meta.lastCommitAt).toBeNull();
      expect(meta.remoteUrl).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("null path yields empty metadata", () => {
    expect(readRepoMetadata(null)).toEqual({
      remoteUrl: null,
      githubUrl: null,
      defaultBranch: null,
      lastCommitSha: null,
      lastCommitAt: null,
    });
  });
});

describe("prefetchRepoMetadata", () => {
  // Builds byte-identical repos at two paths (fixed dates and author), so
  // the sync reader and the async prefetch can each see an uncached path.
  type Variant = "remote-head" | "branch-fallback" | "no-commits" | "not-git";
  function makeRepo(variant: Variant): string {
    const dir = mkdtempSync(join(tmpdir(), "relay-prefetch-"));
    if (variant === "not-git") return dir;
    git(dir, "init", "-q", "-b", "feature");
    if (variant === "no-commits") return dir;
    git(dir, "remote", "add", "origin", "https://github.com/acme/gadgets.git");
    writeFileSync(join(dir, "a.txt"), "a\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init");
    if (variant === "remote-head") {
      git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
      git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    }
    return dir;
  }

  for (const variant of ["remote-head", "branch-fallback", "no-commits", "not-git"] as const) {
    test(`warms the cache with what readRepoMetadata reads (${variant})`, async () => {
      const syncDir = makeRepo(variant);
      const asyncDir = makeRepo(variant);
      try {
        const expected = readRepoMetadata(syncDir);
        await prefetchRepoMetadata([asyncDir, null, asyncDir]);
        expect(readRepoMetadata(asyncDir)).toEqual(expected);
        if (variant === "remote-head") expect(expected.defaultBranch).toBe("main");
        if (variant === "branch-fallback") expect(expected.defaultBranch).toBe("feature");
      } finally {
        rmSync(syncDir, { recursive: true, force: true });
        rmSync(asyncDir, { recursive: true, force: true });
      }
    });
  }

  test("a missing directory resolves to empty metadata instead of rejecting", async () => {
    const gone = join(tmpdir(), `relay-prefetch-missing-${process.pid}`);
    await prefetchRepoMetadata([gone]);
    expect(readRepoMetadata(gone)).toEqual(readRepoMetadata(null));
  });

  test("many repos at once all resolve (bounded concurrency)", async () => {
    const dirs = Array.from({ length: 12 }, () => makeRepo("branch-fallback"));
    try {
      await prefetchRepoMetadata(dirs);
      for (const d of dirs) expect(readRepoMetadata(d).defaultBranch).toBe("feature");
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });
});
