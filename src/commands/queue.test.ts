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

describe("processQueue dependencies", () => {
  test("a dependent queued ahead of its blocker runs after the blocker succeeds", async () => {
    const blocker = seed("dep-blocker");
    const dependent = seed("dep-dependent");
    {
      using db = new RelayDB();
      expect(db.addDependency(dependent, blocker)).toEqual({ ok: true, added: true });
      db.addQueueItem(dependent);
      db.addQueueItem(blocker);
    }
    const fake = fakeExecutor({});
    const outcomes = await processQueue({}, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([blocker, dependent]);
    expect(outcomes.map((o) => o.kind)).toEqual(["success", "success"]);
    expect(queueTaskIds()).toEqual([]);
  });

  test("a dependent whose blocker failed is skipped, not launched", async () => {
    const blocker = seed("dep-fail-blocker");
    const dependent = seed("dep-fail-dependent");
    {
      using db = new RelayDB();
      db.addDependency(dependent, blocker);
      db.addQueueItem(blocker);
      db.addQueueItem(dependent);
    }
    const fake = fakeExecutor({ [blocker]: "failed" });
    const outcomes = await processQueue({ continueOnError: true }, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([blocker]);
    const skipped = outcomes.find((o) => o.taskId === dependent);
    expect(skipped?.kind).toBe("skipped");
    expect(skipped?.reason).toBe(`blocked by #${blocker}`);
    expect(queueTaskIds()).toEqual([blocker, dependent]);
  });

  test("a blocker outside the queue that is still open defers the dependent", async () => {
    const outside = seed("dep-outside");
    const dependent = seed("dep-outside-dependent");
    const free = seed("dep-free");
    {
      using db = new RelayDB();
      db.addDependency(dependent, outside);
      db.addQueueItem(dependent);
      db.addQueueItem(free);
    }
    const fake = fakeExecutor({});
    const outcomes = await processQueue({}, { cfg, execute: fake.execute, ...quiet });
    expect(fake.launched).toEqual([free]);
    expect(outcomes.find((o) => o.taskId === dependent)?.kind).toBe("skipped");
    // Once the outside blocker is done, the dependent becomes runnable.
    { using db = new RelayDB(); db.setStatus(outside, "done"); }
    const again = fakeExecutor({});
    await processQueue({}, { cfg, execute: again.execute, ...quiet });
    expect(again.launched).toEqual([dependent]);
  });

  test("dry-run plans in dependency order", async () => {
    const blocker = seed("dep-dry-blocker");
    const dependent = seed("dep-dry-dependent");
    {
      using db = new RelayDB();
      db.addDependency(dependent, blocker);
      db.addQueueItem(dependent);
      db.addQueueItem(blocker);
    }
    const outcomes = await processQueue({ dryRun: true }, { cfg, ...quiet });
    expect(outcomes.map((o) => [o.taskId, o.kind])).toEqual([[blocker, "planned"], [dependent, "planned"]]);
  });
});

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

describe("run change capture end-to-end", () => {
  test("a headless queue run records the files and commits the agent produced", async () => {
    const { spawnSync } = await import("node:child_process");
    const { executePrepared, prepareRun } = await import("./run.js");
    const repoRoot = join(ROOT, "qchanges");
    mkdirSync(repoRoot, { recursive: true });
    const sh = (...args: string[]) => spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
    sh("init", "-q");
    sh("config", "user.email", "t@example.com");
    sh("config", "user.name", "t");
    sh("config", "commit.gpgsign", "false");
    writeFileSync(join(repoRoot, "README.md"), "hello\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "init");

    const binDir = mkdtempSync(join(tmpdir(), "relay-agent-bin-"));
    const bin = join(binDir, "fake-claude");
    writeFileSync(
      bin,
      "#!/bin/sh\necho 'more' >> README.md\ngit commit -q -am 'agent edit'\necho 'x' > NEW.md\necho done\n",
    );
    chmodSync(bin, 0o755);
    const runCfg = ConfigSchema.parse({ scan: { roots: [ROOT] }, agents: { claude_bin: bin } });

    const id = seed("change capture", "claude-code", "qchanges");
    const task = (() => {
      using db = new RelayDB();
      return db.getTask(id)!;
    })();
    const prep = (() => {
      using db = new RelayDB();
      return prepareRun(db, task, runCfg, { noTemplate: true });
    })();
    if (!prep.ok) throw new Error(prep.error);
    const result = await executePrepared(prep.prepared, runCfg, { headless: true, echo: false });
    expect(result.status).toBe("success");
    expect(result.changes?.commits).toBe(1);
    expect(result.changes?.files.map((f) => f.path)).toEqual(["NEW.md", "README.md"]);

    using db = new RelayDB();
    const run = db.getRun(result.runId)!;
    expect(run.changes?.commits).toBe(1);
    expect(run.changes?.head_before).toBeTruthy();
    expect(db.listRunsForTask(id)[0]?.changes?.files).toHaveLength(2);
  });
});

describe("retry failed runs", () => {
  test("failedTaskIds: latest run failed/interrupted and task not done; --failed and the API queue them", async () => {
    const { runQueueAdd, sinceToIso } = await import("./queue.js");
    const { createQueueApi } = await import("../api/queue.js");
    const failed = seed("broke");
    const recovered = seed("broke then fixed");
    const interrupted = seed("ctrl-c");
    const closed = seed("failed but closed");
    {
      using db = new RelayDB();
      db.finishRun(db.insertRun(failed, "claude-code"), "failed", "boom");
      db.finishRun(db.insertRun(recovered, "claude-code"), "failed", "boom");
      db.finishRun(db.insertRun(recovered, "claude-code"), "success");
      db.finishRun(db.insertRun(interrupted, "claude-code"), "interrupted");
      db.finishRun(db.insertRun(closed, "claude-code"), "failed");
      db.setStatus(closed, "done");
      const ids = db.failedTaskIds();
      expect(ids).toContain(failed);
      expect(ids).toContain(interrupted);
      expect(ids).not.toContain(recovered);
      expect(ids).not.toContain(closed);
      expect(db.failedTaskIds(new Date(Date.now() + 60_000).toISOString())).toEqual([]);
    }

    const app = createQueueApi();
    const preview = (await (await app.request("/retry-failed")).json()) as { count: number };
    expect(preview.count).toBeGreaterThanOrEqual(2);

    const log = console.log;
    console.log = () => {};
    try {
      runQueueAdd([], { failed: true, since: "1d" });
    } finally {
      console.log = log;
    }
    expect(queueTaskIds()).toContain(failed);
    expect(queueTaskIds()).toContain(interrupted);
    // already queued → the API adds nothing new
    const res = await app.request("/retry-failed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(((await res.json()) as { count: number }).count).toBe(0);

    expect(sinceToIso("bogus")).toBeNull();
    expect(Date.parse(sinceToIso("2h")!)).toBeLessThan(Date.now());
  });
});

describe("parallel queue runs", () => {
  /** Executor that records concurrency and finishes each task after `ms`. */
  function timedExecutor(ms: number, outcomes: Record<number, ExecuteResult["status"]> = {}) {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const execute = async (prepared: PreparedRun): Promise<ExecuteResult> => {
      running += 1;
      peak = Math.max(peak, running);
      order.push(`start ${prepared.task.id}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${prepared.task.id}`);
      running -= 1;
      const status = outcomes[prepared.task.id] ?? "success";
      return { runId: 0, status, exitCode: status === "success" ? 0 : 1, summary: null, logPath: null, closed: false };
    };
    return { execute: execute as never, order, peak: () => peak };
  }

  for (const repo of ["pa", "pb", "pc"]) mkdirSync(join(ROOT, repo), { recursive: true });

  test("runs different repos concurrently, but one task per repo at a time", async () => {
    const a1 = seed("a1", "claude-code", "pa");
    const a2 = seed("a2", "claude-code", "pa");
    const b1 = seed("b1", "claude-code", "pb");
    const c1 = seed("c1", "codex", "pc");
    {
      using db = new RelayDB();
      for (const id of [a1, a2, b1, c1]) db.addQueueItem(id);
    }
    const exec = timedExecutor(40);
    const outcomes = await processQueue({ headless: true, parallel: 3 }, { cfg, execute: exec.execute, ...quiet });
    expect(outcomes.map((o) => o.kind)).toEqual(["success", "success", "success", "success"]);
    expect(exec.peak()).toBe(3);
    // a2 waits for a1 (same repo) even though a slot is free
    expect(exec.order.indexOf(`start ${a2}`)).toBeGreaterThan(exec.order.indexOf(`end ${a1}`));
    expect(queueTaskIds()).toEqual([]);
  });

  test("a dependent waits for its in-flight blocker instead of being skipped", async () => {
    const blocker = seed("blocker", "claude-code", "pa");
    const dependent = seed("dependent", "claude-code", "pb");
    {
      using db = new RelayDB();
      db.addDependency(dependent, blocker);
      for (const id of [blocker, dependent]) db.addQueueItem(id);
    }
    const exec = timedExecutor(20);
    const outcomes = await processQueue({ headless: true, parallel: 4 }, { cfg, execute: exec.execute, ...quiet });
    expect(outcomes.map((o) => [o.taskId, o.kind])).toEqual([
      [blocker, "success"],
      [dependent, "success"],
    ]);
    expect(exec.order).toEqual([`start ${blocker}`, `end ${blocker}`, `start ${dependent}`, `end ${dependent}`]);
  });

  test("a failure stops new launches but lets in-flight runs finish", async () => {
    const bad = seed("bad", "claude-code", "pa");
    const slow = seed("slow", "claude-code", "pb");
    const later = seed("later", "claude-code", "pc");
    {
      using db = new RelayDB();
      for (const id of [bad, slow, later]) db.addQueueItem(id);
    }
    const exec = timedExecutor(10, { [bad]: "failed" });
    const outcomes = await processQueue({ headless: true, parallel: 2 }, { cfg, execute: exec.execute, ...quiet });
    expect(outcomes.map((o) => o.taskId).sort()).toEqual([bad, slow].sort());
    expect(exec.order).not.toContain(`start ${later}`);
    expect(queueTaskIds()).toEqual([bad, later]);
  });

  test("parallel is ignored for interactive runs", async () => {
    const x = seed("x", "claude-code", "pa");
    const y = seed("y", "claude-code", "pb");
    {
      using db = new RelayDB();
      for (const id of [x, y]) db.addQueueItem(id);
    }
    const exec = timedExecutor(10);
    await processQueue({ parallel: 4 }, { cfg, execute: exec.execute, ...quiet });
    expect(exec.peak()).toBe(1);
  });
});
