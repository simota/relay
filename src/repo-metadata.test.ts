import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRepoMetadata } from "./repo-metadata.js";

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
