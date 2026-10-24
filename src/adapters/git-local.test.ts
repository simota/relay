import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterContext } from "../types.js";
import { gitDirtyWorktreeAdapter } from "./git-dirty-worktree.js";
import { gitStashAdapter } from "./git-stash.js";
import { orphanBranchAdapter } from "./orphan-branch.js";

// Local-git adapters close tasks for ids they no longer see. A repo they
// could not read (git error, offline scan root) must not count as "gone".

let tmp: string;
let root: string;
let repoDir: string;
const originalPath = process.env.PATH;

function git(...args: string[]): string {
  const res = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

/** Point `.git` at a missing gitdir so every git call in the repo exits 128. */
function breakRepo(): () => void {
  renameSync(join(repoDir, ".git"), join(tmp, "git-aside"));
  writeFileSync(join(repoDir, ".git"), "gitdir: /nonexistent/relay-test\n");
  return () => {
    rmSync(join(repoDir, ".git"));
    renameSync(join(tmp, "git-aside"), join(repoDir, ".git"));
  };
}

function ctx(known: Record<string, string[]>): AdapterContext {
  return { roots: [root], exclude: [], knownOpenSourceIds: (type: string) => known[type] ?? [] } as AdapterContext;
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "relay-git-"));
  // orphan_branch asks `gh` for PRs; keep the test offline.
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}:${originalPath}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  root = join(tmp, `root-${Math.random().toString(36).slice(2)}`);
  repoDir = join(root, "demo");
  mkdirSync(repoDir, { recursive: true });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(repoDir, "a.txt"), "1\n");
  git("add", "a.txt");
  git("commit", "-qm", "init");
});

describe("git_stash fetchResolved", () => {
  async function stashedId(): Promise<string> {
    writeFileSync(join(repoDir, "a.txt"), "2\n");
    git("stash", "push", "-qm", "wip");
    const [task] = await gitStashAdapter.fetch(ctx({}));
    return task!.source_id;
  }

  test("resolves a dropped stash", async () => {
    const id = await stashedId();
    git("stash", "drop", "-q");
    expect(await gitStashAdapter.fetchResolved!(ctx({ git_stash: [id] }))).toEqual([
      { source_type: "git_stash", source_id: id },
    ]);
  });

  test("keeps stashes of a repo git cannot read", async () => {
    const id = await stashedId();
    const restore = breakRepo();
    try {
      expect(await gitStashAdapter.fetchResolved!(ctx({ git_stash: [id] }))).toEqual([]);
    } finally {
      restore();
    }
  });

  test("keeps stashes under an offline scan root", async () => {
    const id = await stashedId();
    renameSync(root, `${root}-offline`);
    expect(await gitStashAdapter.fetchResolved!(ctx({ git_stash: [id] }))).toEqual([]);
  });
});

describe("orphan_branch fetchResolved", () => {
  test("keeps branches of a repo git cannot read", async () => {
    const id = "demo:orphan-branch:feat/x:abc1234";
    expect(await orphanBranchAdapter.fetchResolved!(ctx({ orphan_branch: [id] }))).toEqual([
      { source_type: "orphan_branch", source_id: id },
    ]);
    const restore = breakRepo();
    try {
      expect(await orphanBranchAdapter.fetchResolved!(ctx({ orphan_branch: [id] }))).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe("git_dirty_worktree fetchResolved", () => {
  test("a failing git status is not a clean worktree", async () => {
    expect(await gitDirtyWorktreeAdapter.fetchResolved!(ctx({}))).toEqual([
      { source_type: "git_dirty_worktree", source_id: "demo:dirty-worktree" },
    ]);
    const restore = breakRepo();
    try {
      expect(await gitDirtyWorktreeAdapter.fetchResolved!(ctx({}))).toEqual([]);
    } finally {
      restore();
    }
  });
});
