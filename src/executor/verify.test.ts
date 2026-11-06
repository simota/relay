import "../test-setup.js";
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../config.js";
import { RelayDB } from "../db/client.js";
import {
  AUTO_FEEDBACK_PREFIX,
  parseVerifyFile,
  resolveVerifyCommand,
  retryFeedbackNote,
  runVerify,
  tailText,
  verifyFailureSummary,
} from "./verify.js";

const ROOT = mkdtempSync(join(tmpdir(), "relay-verify-roots-"));

function seed(title: string, repo: string): number {
  using db = new RelayDB();
  const sourceId = `manual:verify-test:${Math.random().toString(36).slice(2)}`;
  db.upsertTasks([
    {
      source_type: "manual",
      source_id: sourceId,
      repo,
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

function fakeAgent(script: string): string {
  const binDir = mkdtempSync(join(tmpdir(), "relay-verify-bin-"));
  const bin = join(binDir, "fake-claude");
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe("verify command resolution", () => {
  test("parseVerifyFile takes the first non-comment line", () => {
    expect(parseVerifyFile("# run the suite\n\n  bun test  \nnpm test\n")).toBe("bun test");
    expect(parseVerifyFile("# only comments\n\n")).toBeNull();
  });

  test("config [[verify.repos]] wins over .agents/RELAY_VERIFY; globs match repo names", () => {
    const repoRoot = join(ROOT, "billing-api");
    mkdirSync(join(repoRoot, ".agents"), { recursive: true });
    writeFileSync(join(repoRoot, ".agents", "RELAY_VERIFY"), "make check\n");
    const none = ConfigSchema.parse({});
    expect(resolveVerifyCommand("billing-api", repoRoot, none)).toEqual({ command: "make check", source: "repo-file" });
    const cfg = ConfigSchema.parse({ verify: { repos: [{ repo: "billing-*", command: "bun test" }] } });
    expect(resolveVerifyCommand("billing-api", repoRoot, cfg)).toEqual({ command: "bun test", source: "config" });
    expect(resolveVerifyCommand("other", null, cfg)).toBeNull();
    // a bare string repo is accepted too
    const single = ConfigSchema.parse({ verify: { repos: [{ repo: "other", command: "true" }] } });
    expect(resolveVerifyCommand("other", null, single)?.command).toBe("true");
  });

  test("verify defaults are off", () => {
    const cfg = ConfigSchema.parse({});
    expect(cfg.verify).toEqual({ auto: false, timeout_min: 10, retries: 0, repos: [] });
  });
});

describe("runVerify", () => {
  test("passes on exit 0 and keeps the output tail", async () => {
    const res = await runVerify("echo all good", ROOT);
    expect(res.status).toBe("passed");
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe("all good");
  });

  test("fails on non-zero exit, capturing stderr", async () => {
    const res = await runVerify("echo 'expected 1 got 2' >&2; exit 3", ROOT);
    expect(res.status).toBe("failed");
    expect(res.exitCode).toBe(3);
    expect(res.output).toContain("expected 1 got 2");
    expect(verifyFailureSummary(res)).toBe("verify failed (exit 3): echo 'expected 1 got 2' >&2; exit 3\nexpected 1 got 2");
  });

  test("a timeout fails the verification", async () => {
    const res = await runVerify("sleep 5", ROOT, { timeoutMs: 150 });
    expect(res.status).toBe("failed");
    expect(res.timedOut).toBe(true);
    expect(res.output).toContain("timed out");
  });

  test("appends to the run log when given", async () => {
    const log = join(ROOT, "verify.log");
    writeFileSync(log, "agent output\n");
    await runVerify("echo checked", ROOT, { logPath: log });
    const text = readFileSync(log, "utf8");
    expect(text).toContain("agent output");
    expect(text).toContain("# verify: echo checked");
    expect(text).toContain("checked");
    expect(text).toContain("# verify passed (exit 0)");
  });

  test("tailText keeps the end on a line boundary", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const tail = tailText(text, 50);
    expect(tail.startsWith("…line ")).toBe(true);
    expect(tail.endsWith("line 199")).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(51);
  });

  test("retryFeedbackNote explains a red verify gate", () => {
    const note = retryFeedbackNote({
      attempt: 1,
      maxAttempts: 3,
      runId: 7,
      exitCode: 1,
      verify: { status: "failed", command: "bun test", exitCode: 1, output: "1 fail", timedOut: false, durationMs: 1 },
    });
    expect(note.startsWith(`${AUTO_FEEDBACK_PREFIX} attempt 1/3 (run #7)`)).toBe(true);
    expect(note).toContain("`bun test` exited 1");
    expect(note).toContain("1 fail");
    const crash = retryFeedbackNote({ attempt: 2, maxAttempts: 2, runId: 8, exitCode: 4, agentSummary: "boom" });
    expect(crash).toContain("exited with code 4");
    expect(crash).toContain("boom");
  });
});

describe("verify gate end-to-end", () => {
  test("a red verify gate fails the run, keeps the task open, and records the result", async () => {
    const { executePrepared, prepareRun } = await import("../commands/run.js");
    mkdirSync(join(ROOT, "vred"), { recursive: true });
    const bin = fakeAgent("echo agent done");
    const cfg = ConfigSchema.parse({
      scan: { roots: [ROOT] },
      agents: { claude_bin: bin },
      verify: { repos: [{ repo: "vred", command: "echo 'test failed: expected 2' >&2; exit 1" }] },
    });
    const id = seed("red gate", "vred");
    const prep = (() => {
      using db = new RelayDB();
      return prepareRun(db, db.getTask(id)!, cfg, { noTemplate: true });
    })();
    if (!prep.ok) throw new Error(prep.error);
    const result = await executePrepared(prep.prepared, cfg, {
      headless: true,
      echo: false,
      verify: true,
      closeOnSuccess: true,
    });
    expect(result.status).toBe("failed");
    expect(result.closed).toBe(false);
    expect(result.verify?.status).toBe("failed");
    expect(result.summary).toContain("verify failed (exit 1)");

    using db = new RelayDB();
    const run = db.getRun(result.runId)!;
    expect(run.status).toBe("failed");
    expect(run.verify_status).toBe("failed");
    expect(run.verify_command).toContain("exit 1");
    expect(run.verify_output).toContain("expected 2");
    expect(db.getTask(id)!.status).toBe("open");
    // verify failures feed `relay queue add --failed`
    expect(db.failedTaskIds()).toContain(id);
    // the verify output lands in the headless run log too
    expect(readFileSync(result.logPath!, "utf8")).toContain("# verify failed (exit 1)");
  });

  test("a green verify gate lets --close-on-success close the task", async () => {
    const { executePrepared, prepareRun } = await import("../commands/run.js");
    mkdirSync(join(ROOT, "vgreen"), { recursive: true });
    const bin = fakeAgent("echo ok");
    const cfg = ConfigSchema.parse({
      scan: { roots: [ROOT] },
      agents: { claude_bin: bin },
      verify: { auto: true, repos: [{ repo: "vgreen", command: "true" }] },
    });
    const id = seed("green gate", "vgreen");
    const prep = (() => {
      using db = new RelayDB();
      return prepareRun(db, db.getTask(id)!, cfg, { noTemplate: true });
    })();
    if (!prep.ok) throw new Error(prep.error);
    // verify.auto = true turns the gate on without the option
    const result = await executePrepared(prep.prepared, cfg, { headless: true, echo: false, closeOnSuccess: true });
    expect(result.status).toBe("success");
    expect(result.verify?.status).toBe("passed");
    expect(result.closed).toBe(true);
    using db = new RelayDB();
    expect(db.getRun(result.runId)!.verify_status).toBe("passed");
    expect(db.getTask(id)!.status).toBe("done");
  });

  test("no verify command: the run stays a success but is flagged unverified", async () => {
    const { executePrepared, prepareRun } = await import("../commands/run.js");
    mkdirSync(join(ROOT, "vnone"), { recursive: true });
    const cfg = ConfigSchema.parse({ scan: { roots: [ROOT] }, agents: { claude_bin: fakeAgent("echo ok") } });
    const id = seed("no gate", "vnone");
    const prep = (() => {
      using db = new RelayDB();
      return prepareRun(db, db.getTask(id)!, cfg, { noTemplate: true });
    })();
    if (!prep.ok) throw new Error(prep.error);
    const result = await executePrepared(prep.prepared, cfg, { headless: true, echo: false, verify: true });
    expect(result.status).toBe("success");
    expect(result.verify).toBeNull();
    expect(result.verifyMissing).toBe(true);
  });

  test("--retries feeds the verify failure back as a note and the next attempt fixes it", async () => {
    const { executeWithRetries, prepareRun } = await import("../commands/run.js");
    const repoRoot = join(ROOT, "vretry");
    mkdirSync(repoRoot, { recursive: true });
    // The fake agent only "fixes" the repo once its prompt carries relay's
    // auto-retry feedback — proving the note reaches the next attempt.
    const bin = fakeAgent(`case "$*" in *"${AUTO_FEEDBACK_PREFIX}"*) touch FIXED; echo fixed ;; *) echo first try ;; esac`);
    const cfg = ConfigSchema.parse({
      scan: { roots: [ROOT] },
      agents: { claude_bin: bin },
      verify: { repos: [{ repo: "vretry", command: "test -f FIXED || (echo 'FIXED missing'; exit 1)" }] },
    });
    const id = seed("retry until green", "vretry");
    const prep = (() => {
      using db = new RelayDB();
      return prepareRun(db, db.getTask(id)!, cfg, { noTemplate: true });
    })();
    if (!prep.ok) throw new Error(prep.error);
    const retries: number[] = [];
    const result = await executeWithRetries(prep.prepared, cfg, {
      headless: true,
      echo: false,
      verify: true,
      retries: 2,
      closeOnSuccess: true,
      onRetry: ({ attempt }) => retries.push(attempt),
    });
    expect(result.attempts.map((a) => a.status)).toEqual(["failed", "success"]);
    expect(retries).toEqual([2]);
    expect(result.status).toBe("success");
    expect(result.closed).toBe(true);

    using db = new RelayDB();
    const notes = db.listNotes(id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain(`${AUTO_FEEDBACK_PREFIX} attempt 1/3`);
    expect(notes[0]!.body).toContain("FIXED missing");
    const runs = db.listRunsForTask(id);
    expect(runs.map((r) => r.verify_status)).toEqual(["passed", "failed"]);
  });

  test("retries stop at the budget and never retry an interrupt", async () => {
    const { executeWithRetries } = await import("../commands/run.js");
    const id = seed("always red", "vnone");
    const task = (() => {
      using db = new RelayDB();
      return db.getTask(id)!;
    })();
    const cfg = ConfigSchema.parse({ scan: { roots: [ROOT] } });
    let calls = 0;
    const fake = (status: "failed" | "interrupted") =>
      (async () => {
        calls += 1;
        return { runId: calls, status, exitCode: 1, summary: "nope", logPath: null, closed: false };
      }) as never;
    const prepared = {
      task,
      repoRoot: join(ROOT, "vnone"),
      noteCount: 0,
      openBlockers: [],
      context: null,
      willResume: false,
    };
    const red = await executeWithRetries(prepared, cfg, { retries: 2 }, fake("failed"));
    expect(red.attempts).toHaveLength(3);
    expect(calls).toBe(3);
    calls = 0;
    const stopped = await executeWithRetries(prepared, cfg, { retries: 2 }, fake("interrupted"));
    expect(stopped.attempts).toHaveLength(1);
  });
});
