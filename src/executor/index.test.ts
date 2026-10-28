import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task } from "../types.js";
import { resolveCommand, resolveReviewUrl, runResultFromExit, runTask } from "./index.js";

function task(overrides: Partial<Task>): Task {
  return {
    id: 1,
    source_type: "github_pr",
    source_id: "https://github.com/acme/widgets/pull/42",
    repo: "widgets",
    title: "Add widget",
    body: "",
    status: "open",
    assignee: "human-review",
    priority: 65,
    prompt: null,
    files: [],
    context_hash: null,
    session_id: null,
    due_at: null,
    wait_on: "self",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

describe("human-review launch", () => {
  test("opens the PR URL from source_id, not the PR description", () => {
    const t = task({ body: "This PR adds a widget.\n\n---\nlabels: enhancement" });
    expect(resolveReviewUrl(t)).toBe("https://github.com/acme/widgets/pull/42");
    const { args } = resolveCommand(t, { task: t, repoRoot: "/tmp" });
    expect(args).toEqual(["https://github.com/acme/widgets/pull/42"]);
  });

  test("never forwards a flag-shaped body to the opener", () => {
    const t = task({ body: "-aCalculator" });
    const { args } = resolveCommand(t, { task: t, repoRoot: "/tmp" });
    expect(args).toEqual(["https://github.com/acme/widgets/pull/42"]);
  });

  test("falls back to the first http(s) URL in the body for manual tasks", () => {
    const t = task({
      source_type: "manual",
      source_id: "manual:1:abc",
      body: "please look at https://example.com/review/7 before Friday",
    });
    expect(resolveReviewUrl(t)).toBe("https://example.com/review/7");
  });

  test("drops trailing sentence punctuation from a body URL", () => {
    const t = task({ source_type: "manual", source_id: "manual:1:abc", body: "Please review https://example.com/reviews/7." });
    expect(resolveReviewUrl(t)).toBe("https://example.com/reviews/7");
  });

  test("throws instead of launching when there is no URL", () => {
    const t = task({ source_type: "manual", source_id: "manual:1:abc", body: "-a Terminal file:///etc/passwd" });
    expect(resolveReviewUrl(t)).toBeNull();
    expect(() => resolveCommand(t, { task: t, repoRoot: "/tmp" })).toThrow(/no http\(s\) URL/);
  });
});

describe("run exit mapping", () => {
  test("a signal-killed agent is interrupted with a non-zero exit code", () => {
    expect(runResultFromExit(null, "SIGTERM")).toEqual({ status: "interrupted", exitCode: 143 });
    expect(runResultFromExit(null, "SIGINT")).toEqual({ status: "interrupted", exitCode: 130 });
    expect(runResultFromExit(null, null)).toEqual({ status: "interrupted", exitCode: 1 });
  });

  test("normal exits keep their code", () => {
    expect(runResultFromExit(0, null)).toEqual({ status: "success", exitCode: 0 });
    expect(runResultFromExit(2, null)).toEqual({ status: "failed", exitCode: 2 });
  });

  test("runTask reports a self-terminated child as interrupted", async () => {
    // `claude <prompt>` with claudeBin=/bin/sh runs the prompt as a script
    // in the repo root; the script kills itself the way a crashed agent dies.
    const repoRoot = mkdtempSync(join(tmpdir(), "relay-exec-"));
    writeFileSync(join(repoRoot, "die.sh"), "kill -TERM $$\n");
    const t = task({ assignee: "claude-code", prompt: "die.sh" });
    const result = await runTask({ task: t, repoRoot, claudeBin: "/bin/sh" });
    expect(result).toEqual({ status: "interrupted", exitCode: 143 });
  });
});
