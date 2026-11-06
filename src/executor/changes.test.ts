import "../test-setup.js";
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureBaseline, computeChanges, formatChangeSummary, MAX_CHANGED_FILES, parseRunChanges } from "./changes.js";

function git(cwd: string, ...args: string[]) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout;
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-changes-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "dirty.txt"), "base\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

describe("run change capture", () => {
  test("outside a git work tree there is no baseline", () => {
    expect(captureBaseline(mkdtempSync(join(tmpdir(), "relay-nogit-")))).toBeNull();
  });

  test("records commits, uncommitted edits and new files; ignores untouched pre-existing dirt", () => {
    const dir = repo();
    writeFileSync(join(dir, "dirty.txt"), "base\nuser wip\n"); // dirty before the run
    const baseline = captureBaseline(dir)!;
    expect(baseline).not.toBeNull();

    // "agent" work: commit one edit, leave another uncommitted, add a file
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
    git(dir, "commit", "-q", "-m", "agent", "--", "a.txt");
    writeFileSync(join(dir, "b.txt"), "new\n");

    const changes = computeChanges(baseline)!;
    expect(changes.head_before).toBe(baseline.head);
    expect(changes.head_after).not.toBe(baseline.head);
    expect(changes.commits).toBe(1);
    const paths = changes.files.map((f) => f.path);
    expect(paths).toEqual(["a.txt", "b.txt"]);
    expect(changes.files[0]).toMatchObject({ added: 1, removed: 0 });
    expect(changes.files[1]).toMatchObject({ added: null, removed: null });
    expect(formatChangeSummary(changes)).toBe("2 files (+1 −0), 1 commit");
  });

  test("a pre-existing dirty file the agent edits further is reported", () => {
    const dir = repo();
    writeFileSync(join(dir, "dirty.txt"), "base\nuser wip\n");
    const baseline = captureBaseline(dir)!;
    writeFileSync(join(dir, "dirty.txt"), "base\nuser wip\nagent too\n");
    const changes = computeChanges(baseline)!;
    expect(changes.files.map((f) => f.path)).toEqual(["dirty.txt"]);
    expect(changes.commits).toBe(0);
  });

  test("no-op run", () => {
    const dir = repo();
    const changes = computeChanges(captureBaseline(dir)!)!;
    expect(changes.files).toEqual([]);
    expect(formatChangeSummary(changes)).toBe("no changes");
  });

  test("caps the stored list and counts the rest", () => {
    const dir = repo();
    const baseline = captureBaseline(dir)!;
    for (let i = 0; i < MAX_CHANGED_FILES + 5; i++) writeFileSync(join(dir, `gen-${String(i).padStart(3, "0")}.txt`), "x\n");
    const changes = computeChanges(baseline)!;
    expect(changes.files).toHaveLength(MAX_CHANGED_FILES);
    expect(changes.more).toBe(5);
  });

  test("parseRunChanges is defensive", () => {
    expect(parseRunChanges(null)).toBeNull();
    expect(parseRunChanges("{bad")).toBeNull();
    expect(parseRunChanges(JSON.stringify({ files: [{ path: "a" }, 3], commits: 2 }), "abc", null)).toEqual({
      head_before: "abc",
      head_after: null,
      commits: 2,
      files: [{ path: "a" } as never],
      more: 0,
    });
  });
});
