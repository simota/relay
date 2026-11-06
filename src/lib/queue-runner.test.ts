import "../test-setup.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQueueApi } from "../api/queue.js";
import { processQueue, QueueBusyError } from "../commands/queue.js";
import type { ExecuteResult, PreparedRun } from "../commands/run.js";
import { ConfigSchema } from "../config.js";
import { RelayDB } from "../db/client.js";
import { acquireQueueLock, queueLockPath, readQueueLock } from "./queue-lock.js";
import { QueueRunner } from "./queue-runner.js";

const ROOT = mkdtempSync(join(tmpdir(), "relay-runner-roots-"));
mkdirSync(join(ROOT, "rdemo"), { recursive: true });
const cfg = ConfigSchema.parse({ scan: { roots: [ROOT] } });

function seed(title: string): number {
  using db = new RelayDB();
  const sourceId = `manual:runner-test:${Math.random().toString(36).slice(2)}`;
  db.upsertTasks([
    {
      source_type: "manual",
      source_id: sourceId,
      repo: "rdemo",
      title,
      body: "",
      status: "open",
      assignee: "claude-code",
      priority: 50,
      prompt: `do ${title}`,
      files: [],
      context_hash: null,
      session_id: null,
      due_at: null,
      wait_on: "self",
    },
  ]);
  return db.getTaskBySourceId("manual", sourceId)!.id;
}

/** Executor that blocks each task until `release()` is called. */
function gatedExecutor(outcomes: Record<number, ExecuteResult["status"]> = {}) {
  const launched: number[] = [];
  let gate: (() => void) | null = null;
  const execute = async (prepared: PreparedRun): Promise<ExecuteResult> => {
    launched.push(prepared.task.id);
    await new Promise<void>((resolve) => {
      gate = resolve;
    });
    const status = outcomes[prepared.task.id] ?? "success";
    return { runId: launched.length, status, exitCode: status === "success" ? 0 : 1, summary: null, logPath: null, closed: false };
  };
  return {
    launched,
    execute: execute as never,
    release: () => {
      const g = gate;
      gate = null;
      g?.();
    },
  };
}

async function until(fn: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  using db = new RelayDB();
  db.clearQueue();
});

describe("queue lock", () => {
  test("is exclusive, released explicitly, and a dead holder is taken over", () => {
    const first = acquireQueueLock("cli");
    expect(first.ok).toBe(true);
    const second = acquireQueueLock("web");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.heldBy.owner).toBe("cli");
    if (first.ok) first.release();
    expect(existsSync(queueLockPath())).toBe(false);

    // a lock file left behind by a process that no longer exists
    writeFileSync(queueLockPath(), JSON.stringify({ pid: 2 ** 22 + 12345, owner: "cli", started_at: "x" }));
    expect(readQueueLock()).toBeNull();
    const taken = acquireQueueLock("web");
    expect(taken.ok).toBe(true);
    if (taken.ok) taken.release();
  });

  test("processQueue refuses to run while another runner holds the lock", async () => {
    const id = seed("locked");
    {
      using db = new RelayDB();
      db.addQueueItem(id);
    }
    const lock = acquireQueueLock("cli");
    try {
      await expect(processQueue({ headless: true }, { cfg, log: () => {} })).rejects.toBeInstanceOf(QueueBusyError);
    } finally {
      if (lock.ok) lock.release();
    }
  });
});

describe("QueueRunner", () => {
  test("works the queue in the background, reports progress, and stops gracefully", async () => {
    const a = seed("runner a");
    const b = seed("runner b");
    const c = seed("runner c");
    {
      using db = new RelayDB();
      for (const id of [a, b, c]) db.addQueueItem(id);
    }
    const exec = gatedExecutor();
    const runner = new QueueRunner({ cfg: () => cfg, execute: exec.execute });
    const started = runner.start({ continueOnError: true });
    expect(started.status).toBe("running");
    expect(() => runner.start({})).toThrow(QueueBusyError);

    await until(() => runner.snapshot().current?.task_id === a);
    // the server's runner holds the cross-process lock
    expect(readQueueLock()?.owner).toBe("web");
    exec.release();
    await until(() => runner.snapshot().current?.task_id === b);
    expect(runner.snapshot().outcomes.map((o) => o.kind)).toEqual(["success"]);

    // stop: b finishes, c never starts
    expect(runner.stop()).toBe(true);
    expect(runner.snapshot().status).toBe("stopping");
    exec.release();
    await runner.wait();
    const final = runner.snapshot();
    expect(final.status).toBe("finished");
    expect(final.current).toBeNull();
    expect(final.outcomes.map((o) => o.taskId)).toEqual([a, b]);
    expect(exec.launched).toEqual([a, b]);
    expect(final.log.some((line) => line.includes(`#${a}`))).toBe(true);
    expect(readQueueLock()).toBeNull();
    using db = new RelayDB();
    expect(db.listQueueItems().map((i) => i.task_id)).toEqual([c]);
  });
});

describe("queue runner API", () => {
  test("starting runs is loopback-only; status is readable; empty queue is a 409", async () => {
    const exec = gatedExecutor();
    const runner = new QueueRunner({ cfg: () => cfg, execute: exec.execute });
    const remote = createQueueApi({ runner, isLocalRequest: () => false });
    const denied = await remote.request("/runner", { method: "POST", body: "{}" });
    expect(denied.status).toBe(403);
    const status = await remote.request("/runner");
    expect(status.status).toBe(200);
    const body = (await status.json()) as { status: string; can_start: boolean };
    expect(body.status).toBe("idle");
    expect(body.can_start).toBe(false);

    const local = createQueueApi({ runner, isLocalRequest: () => true });
    const empty = await local.request("/runner", { method: "POST", body: "{}" });
    expect(empty.status).toBe(409);
    const bad = await local.request("/runner", { method: "POST", body: JSON.stringify({ retries: 9 }) });
    expect(bad.status).toBe(400);

    const id = seed("api run");
    {
      using db = new RelayDB();
      db.addQueueItem(id);
    }
    const ok = await local.request("/runner", {
      method: "POST",
      body: JSON.stringify({ verify: true, retries: 1, close_on_success: true }),
    });
    expect(ok.status).toBe(202);
    const okBody = (await ok.json()) as { status: string; options: Record<string, unknown> };
    expect(okBody.status).toBe("running");
    expect(okBody.options).toMatchObject({ verify: true, retries: 1, closeOnSuccess: true, continueOnError: true });
    const busy = await local.request("/runner", { method: "POST", body: "{}" });
    expect(busy.status).toBe(409);

    await until(() => exec.launched.length === 1);
    const stop = await local.request("/runner/stop", { method: "POST" });
    expect(((await stop.json()) as { ok: boolean }).ok).toBe(true);
    exec.release();
    await runner.wait();
    const done = (await (await local.request("/runner")).json()) as { status: string; outcomes: unknown[] };
    expect(done.status).toBe("finished");
    expect(done.outcomes).toHaveLength(1);
  });
});

describe("server wiring", () => {
  test("without a provable loopback peer the real app refuses to start agent runs", async () => {
    const { buildApp } = await import("../web/server.js");
    const app = buildApp();
    const res = await app.request("http://127.0.0.1:7340/api/queue/runner", { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
    const state = await app.request("http://127.0.0.1:7340/api/queue/runner");
    expect(state.status).toBe(200);
  });
});

describe("run now (task_ids)", () => {
  test("runs only the requested tasks, front-queued; a running task-limited run picks up more", async () => {
    const other = seed("leave me queued");
    const first = seed("run me now");
    const second = seed("and me too");
    const human = seed("human");
    {
      using db = new RelayDB();
      db.addQueueItem(other);
      // an assignee without a headless mode is refused up front
      db.setAssignee(human, "human-review");
    }
    const exec = gatedExecutor();
    const runner = new QueueRunner({ cfg: () => cfg, execute: exec.execute });
    const api = createQueueApi({ runner, isLocalRequest: () => true });
    const refused = await api.request("/runner", { method: "POST", body: JSON.stringify({ task_ids: [human] }) });
    expect(refused.status).toBe(409);

    const res = await api.request("/runner", { method: "POST", body: JSON.stringify({ task_ids: [first] }) });
    expect(res.status).toBe(202);
    await until(() => exec.launched.length === 1);
    expect(exec.launched).toEqual([first]);

    const more = await api.request("/runner", { method: "POST", body: JSON.stringify({ task_ids: [second] }) });
    expect(more.status).toBe(202);
    expect(((await more.json()) as { queued: number[] }).queued).toEqual([second]);
    exec.release();
    await until(() => exec.launched.length === 2);
    exec.release();
    await runner.wait();
    expect(exec.launched).toEqual([first, second]);
    using db = new RelayDB();
    expect(db.listQueueItems().map((i) => i.task_id)).toEqual([other]);
  });
});
