// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../config.js";
import { RelayDB } from "../db/client.js";
import { fallbackPrompt, resolveHeadlessCommand, runTaskHeadless, summarizeOutput } from "../executor/headless.js";
import type { Assignee, Task } from "../types.js";
import { processQueue } from "./queue.js";
import type { ExecuteResult, PreparedRun } from "./run.js";

const ROOT = mkdtempSync(join(tmpdir(), "relay-queue-roots-"));
mkdirSync(join(ROOT, "qdemo"), { recursive: true });
const cfg = ConfigSchema.parse({ scan: { roots: [ROOT] } });

function seed(title: string, assignee: Assignee = "claude-code", repo = "qdemo"): number {
  using db = new RelayDB();
  const sourceId = `manual:queue-test:${Math.random().toString(36).slice(2)}`;
  db.upsertTasks([{
    source_type: "manual",
    source_id: sourceId,
    repo,
    title,
    body: "",
    status: "open",
    assignee,
    priority: 50,
    prompt: `do ${title}`,
    files: [],
    context_hash: null,
    session_id: null,
    due_at: null,
    wait_on: "self",
  }]);
  return db.getTaskBySourceId("manual", sourceId)!.id;
}

function queueTaskIds(): number[] {
  using db = new RelayDB();
  return db.listQueueItems().map((item) => item.task_id);
}

function fakeExecutor(outcomes: Record<number, ExecuteResult["status"]>) {
  const launched: number[] = [];
  const execute = async (prepared: PreparedRun): Promise<ExecuteResult> => {
    launched.push(prepared.task.id);
    const status = outcomes[prepared.task.id] ?? "success";
    return { runId: 0, status, exitCode: status === "success" ? 0 : 1, summary: null, logPath: null, closed: false };
  };
  return { launched, execute: execute as never };
}

const quiet = { log: () => {} };

beforeEach(() => {
  using db = new RelayDB();
  db.clearQueue();
});

describe("queue storage", () => {
  test("re-adding a queued task does not duplicate it", () => {
    const id = seed("dedupe");
    using db = new RelayDB();
    const first = db.addQueueItem(id);
    const second = db.addQueueItem(id);
    expect(second).toBe(first);
    expect(db.listQueueItems()).toHaveLength(1);
    expect(db.listQueueItems()[0]?.title).toBe("dedupe");
  });

  test("front and up/down re-order the queue", () => {
    const a = seed("a");
    const b = seed("b");
    const c = seed("c");
    using db = new RelayDB();
    for (const id of [a, b, c]) db.addQueueItem(id);
    db.addQueueItem(c, { front: true });
    expect(queueTaskIds()).toEqual([c, a, b]);
    const itemB = db.listQueueItems().find((item) => item.task_id === b)!;
    expect(db.moveQueueItem(itemB.id, "up")).toBe(true);
    expect(queueTaskIds()).toEqual([c, b, a]);
    const itemC = db.listQueueItems().find((item) => item.task_id === c)!;
    expect(db.moveQueueItem(itemC.id, "up")).toBe(false);
  });
});

describe("processQueue", () => {
  test("runs in order and drops successful items from the queue", async () => {
    const a = seed("run-a");
    const b = seed("run-b");
    { using db = new RelayDB(); db.addQueueItem(a); db.addQueueItem(b); }
    const fake = fakeExecutor({});
    const outcomes = await processQueue({}, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([a, b]);
    expect(outcomes.map((o) => o.kind)).toEqual(["success", "success"]);
    expect(queueTaskIds()).toEqual([]);
  });

  test("stops at the first failure and keeps the failed item queued", async () => {
    const a = seed("fail-a");
    const b = seed("fail-b");
    { using db = new RelayDB(); db.addQueueItem(a); db.addQueueItem(b); }
    const fake = fakeExecutor({ [a]: "failed" });
    await processQueue({}, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([a]);
    expect(queueTaskIds()).toEqual([a, b]);
  });

  test("--continue-on-error attempts every item once", async () => {
    const a = seed("cont-a");
    const b = seed("cont-b");
    { using db = new RelayDB(); db.addQueueItem(a); db.addQueueItem(b); }
    const fake = fakeExecutor({ [a]: "failed" });
    await processQueue({ continueOnError: true }, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([a, b]);
    expect(queueTaskIds()).toEqual([a]);
  });

  test("skips done tasks and agents without a headless mode", async () => {
    const done = seed("already-done");
    const human = seed("human", "self");
    const ok = seed("headless-ok", "codex");
    {
      using db = new RelayDB();
      db.setStatus(done, "done");
      for (const id of [done, human, ok]) db.addQueueItem(id);
    }
    const fake = fakeExecutor({});
    const outcomes = await processQueue({ headless: true }, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([ok]);
    expect(outcomes.map((o) => o.kind)).toEqual(["skipped", "skipped", "success"]);
    // done → removed; self stays for an interactive run.
    expect(queueTaskIds()).toEqual([human]);
  });

  test("--dry-run launches nothing and leaves the queue intact", async () => {
    const a = seed("dry-a");
    { using db = new RelayDB(); db.addQueueItem(a); }
    const fake = fakeExecutor({});
    const outcomes = await processQueue({ dryRun: true }, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([]);
    expect(outcomes.map((o) => o.kind)).toEqual(["planned"]);
    expect(queueTaskIds()).toEqual([a]);
  });

  test("a repo that cannot be resolved fails without launching", async () => {
    const lost = seed("lost", "claude-code", "no-such-repo");
    { using db = new RelayDB(); db.addQueueItem(lost); }
    const fake = fakeExecutor({});
    const outcomes = await processQueue({}, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([]);
    expect(outcomes[0]?.kind).toBe("failed");
    expect(outcomes[0]?.reason).toContain("no-such-repo");
  });

  test("--limit caps the number of launches", async () => {
    const a = seed("lim-a");
    const b = seed("lim-b");
    { using db = new RelayDB(); db.addQueueItem(a); db.addQueueItem(b); }
    const fake = fakeExecutor({});
    await processQueue({ limit: 1 }, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([a]);
    expect(queueTaskIds()).toEqual([b]);
  });
});

function task(overrides: Partial<Task>): Task {
  return {
    id: 7,
    source_type: "code_todo",
    source_id: "src/a.ts:10",
    repo: "qdemo",
    title: "TODO: handle empty input",
    body: "",
    status: "open",
    assignee: "claude-code",
    priority: 50,
    prompt: null,
    files: ["src/a.ts"],
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

describe("headless commands", () => {
  test("claude -p with extra args and a fallback prompt", () => {
    const t = task({});
    const { bin, args } = resolveHeadlessCommand(t, { task: t, repoRoot: "/r", claudeHeadlessArgs: ["--permission-mode", "acceptEdits"] });
    expect(bin).toBe("claude");
    expect(args.slice(0, 3)).toEqual(["-p", "--permission-mode", "acceptEdits"]);
    expect(args.at(-1)).toBe(fallbackPrompt(t));
    expect(args.at(-1)).toContain("src/a.ts");
  });

  test("codex exec resumes a known session", () => {
    const t = task({ assignee: "codex", session_id: "abc", prompt: "keep going" });
    const { args } = resolveHeadlessCommand(t, { task: t, repoRoot: "/r", codexHeadlessArgs: ["--full-auto"] });
    expect(args).toEqual(["exec", "--full-auto", "resume", "abc", "keep going"]);
  });

  test("agents without a headless mode are rejected", () => {
    const t = task({ assignee: "antigravity" });
    expect(() => resolveHeadlessCommand(t, { task: t, repoRoot: "/r" })).toThrow(/no headless mode/);
  });

  test("summarizeOutput keeps the tail and strips ANSI", () => {
    expect(summarizeOutput("\x1b[32mstart\x1b[0m\n\nline 2\nfinal answer\n")).toBe("start\nline 2\nfinal answer");
    expect(summarizeOutput("   \n")).toBeNull();
    expect(summarizeOutput("x".repeat(1000))!.length).toBeLessThanOrEqual(280);
  });

  test("runTaskHeadless logs output and maps the exit code", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "relay-headless-bin-"));
    const bin = join(binDir, "fake-claude");
    writeFileSync(bin, "#!/bin/sh\necho \"got: $2\"\necho oops >&2\nexit 4\n");
    chmodSync(bin, 0o755);
    const t = task({ prompt: "hello" });
    const result = await runTaskHeadless(
      { task: t, repoRoot: binDir, claudeBin: bin },
      { runId: 987654, echo: false },
    );
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(4);
    expect(result.summary).toBe("got: hello\noops");
    const log = readFileSync(result.logPath, "utf8");
    expect(log).toContain("got: hello");
    expect(log).toContain("failed (exit 4)");
  });

  test("runTaskHeadless enforces the timeout", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "relay-headless-bin-"));
    const bin = join(binDir, "slow-claude");
    writeFileSync(bin, "#!/bin/sh\nsleep 5\n");
    chmodSync(bin, 0o755);
    const t = task({ prompt: "slow" });
    const result = await runTaskHeadless({ task: t, repoRoot: binDir, claudeBin: bin }, { runId: 987655, timeoutMs: 200, echo: false });
    expect(result.timedOut).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("timed out");
  });
});
