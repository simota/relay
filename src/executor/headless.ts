// Headless (unattended) agent execution.
//
// `relay run --headless` and `relay queue run --headless` launch the agent
// in its non-interactive mode (`claude -p`, `codex exec`), capture
// stdout/stderr into a per-run log under `$RELAY_HOME/runs/<runId>.log`,
// and keep the tail of the output as the run's `output_summary`. That is
// what turns the queue into an actual job queue: line tasks up, walk away,
// read each run's outcome later from `relay runs` or the Web task detail.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { RELAY_HOME } from "../paths.js";
import type { Assignee, Task } from "../types.js";
import { buildPrompt, runResultFromExit, type RunOptions, type RunResult } from "./index.js";

/** Assignees that have a non-interactive mode relay knows how to drive. */
export const HEADLESS_ASSIGNEES: ReadonlySet<Assignee> = new Set(["claude-code", "codex"]);

export function supportsHeadless(assignee: Assignee): boolean {
  return HEADLESS_ASSIGNEES.has(assignee);
}

export interface HeadlessOptions extends RunOptions {
  /** Extra args inserted right after `-p` (claude) / `exec` (codex). */
  claudeHeadlessArgs?: string[];
  codexHeadlessArgs?: string[];
}

/**
 * Prompt used when a task has none of its own. Interactive launches can
 * open an empty agent session, but a headless run needs instructions, so
 * describe the task from the fields relay already has.
 */
export function fallbackPrompt(task: Task): string {
  const lines = [`Work on this task in the current repository: ${task.title}`];
  const body = task.body.trim();
  if (body) lines.push("", body);
  if (task.files.length > 0) lines.push("", `Relevant files: ${task.files.join(", ")}`);
  if (task.source_type !== "manual") lines.push("", `(source: ${task.source_type} ${task.source_id})`);
  return lines.join("\n");
}

export function resolveHeadlessCommand(
  task: Task,
  opts: HeadlessOptions,
): { bin: string; args: string[] } {
  const canResume = Boolean(task.session_id) && !opts.noResume;
  switch (task.assignee) {
    case "claude-code": {
      const bin = opts.claudeBin ?? "claude";
      const extra = opts.claudeHeadlessArgs ?? [];
      if (canResume) {
        const prompt = task.prompt ?? `Continue working on: ${task.title}`;
        return { bin, args: ["-p", ...extra, "--resume", task.session_id as string, prompt] };
      }
      const prompt = buildPrompt(task.prompt ?? fallbackPrompt(task), opts.contextPreamble, opts.repoTemplate, opts.prerequisites);
      return { bin, args: ["-p", ...extra, prompt as string] };
    }
    case "codex": {
      const bin = opts.codexBin ?? "codex";
      const extra = opts.codexHeadlessArgs ?? [];
      if (canResume) {
        const prompt = task.prompt ?? `Continue working on: ${task.title}`;
        return { bin, args: ["exec", ...extra, "resume", task.session_id as string, prompt] };
      }
      const prompt = buildPrompt(task.prompt ?? fallbackPrompt(task), opts.contextPreamble, opts.repoTemplate, opts.prerequisites);
      return { bin, args: ["exec", ...extra, prompt as string] };
    }
    default:
      throw new Error(
        `assignee '${task.assignee}' has no headless mode (supported: ${[...HEADLESS_ASSIGNEES].join(", ")})`,
      );
  }
}

export function runsDir(): string {
  return join(RELAY_HOME, "runs");
}

export function runLogPath(runId: number): string {
  return join(runsDir(), `${runId}.log`);
}

/** Max bytes returned by readRunLog so a runaway log can't flood a response. */
export const RUN_LOG_READ_LIMIT = 256 * 1024;

export function readRunLog(runId: number): { text: string; truncated: boolean; bytes: number } | null {
  const path = runLogPath(runId);
  if (!existsSync(path)) return null;
  const bytes = statSync(path).size;
  const buf = readFileSync(path);
  if (buf.length <= RUN_LOG_READ_LIMIT) return { text: buf.toString("utf8"), truncated: false, bytes };
  // Keep the tail: the end of an agent run carries its conclusion.
  return { text: buf.subarray(buf.length - RUN_LOG_READ_LIMIT).toString("utf8"), truncated: true, bytes };
}

/** Last meaningful output, trimmed for runs.output_summary. */
export function summarizeOutput(output: string, maxChars = 280): string | null {
  const lines = output
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return null;
  const picked: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0 && picked.length < 6; i--) {
    const line = lines[i] as string;
    if (size + line.length > maxChars && picked.length > 0) break;
    picked.unshift(line);
    size += line.length + 1;
  }
  const text = picked.join("\n");
  return text.length > maxChars ? `…${text.slice(text.length - maxChars + 1)}` : text;
}

export interface HeadlessRunResult extends RunResult {
  /** Tail of the agent output (or the timeout reason) for runs.output_summary. */
  summary: string | null;
  logPath: string;
  timedOut: boolean;
}

export interface HeadlessExecOptions {
  runId: number;
  /** Kill the agent after this many ms (SIGTERM, then SIGKILL 5s later). */
  timeoutMs?: number;
  /** Mirror agent output to this process's stdout/stderr (default true). */
  echo?: boolean;
}

const TAIL_KEEP = 16 * 1024;

export async function runTaskHeadless(
  opts: HeadlessOptions,
  exec: HeadlessExecOptions,
): Promise<HeadlessRunResult> {
  if (!existsSync(opts.repoRoot)) throw new Error(`repo path not found: ${opts.repoRoot}`);
  const { bin, args } = resolveHeadlessCommand(opts.task, opts);
  mkdirSync(runsDir(), { recursive: true });
  const logPath = runLogPath(exec.runId);
  const log = createWriteStream(logPath, { flags: "w" });
  log.write(`# relay run #${exec.runId} · task #${opts.task.id} · ${opts.task.assignee}\n`);
  log.write(`# cwd: ${opts.repoRoot}\n# started: ${new Date().toISOString()}\n\n`);
  const echo = exec.echo !== false;
  let tail = "";
  let timedOut = false;

  try {
    const result = await new Promise<RunResult>((resolve, reject) => {
      // Own process group, so a timeout or Ctrl-C reaches the agent's
      // subprocesses too (a surviving grandchild would keep the output pipe
      // open and the run would never finish).
      const proc = spawn(bin, args, { cwd: opts.repoRoot, stdio: ["ignore", "pipe", "pipe"], detached: true });
      const killGroup = (sig: NodeJS.Signals) => {
        try {
          if (proc.pid) process.kill(-proc.pid, sig);
        } catch {
          proc.kill(sig);
        }
      };
      const onSigint = () => killGroup("SIGINT");
      process.on("SIGINT", onSigint);
      const onChunk = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
        log.write(chunk);
        if (echo) stream.write(chunk);
        tail = (tail + chunk.toString("utf8")).slice(-TAIL_KEEP);
      };
      proc.stdout?.on("data", onChunk(process.stdout));
      proc.stderr?.on("data", onChunk(process.stderr));
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const timer = exec.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            killGroup("SIGTERM");
            killTimer = setTimeout(() => killGroup("SIGKILL"), 5000);
          }, exec.timeoutMs)
        : undefined;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        for (const t of [timer, killTimer, settleTimer]) if (t) clearTimeout(t);
        process.off("SIGINT", onSigint);
        fn();
      };
      proc.on("error", (err) => finish(() => reject(err)));
      proc.on("exit", (code, signal) => {
        // Normally 'close' follows once the pipes drain; if a detached
        // descendant still holds them, stop waiting after a grace period.
        settleTimer = setTimeout(() => {
          proc.stdout?.destroy();
          proc.stderr?.destroy();
          finish(() => resolve(runResultFromExit(code, signal)));
        }, 2000);
      });
      proc.on("close", (code, signal) => finish(() => resolve(runResultFromExit(code, signal))));
    });
    const status = timedOut ? "failed" : result.status;
    const summary = timedOut
      ? `timed out after ${Math.round((exec.timeoutMs ?? 0) / 1000)}s`
      : summarizeOutput(tail);
    log.write(`\n# ended: ${new Date().toISOString()} · ${status} (exit ${result.exitCode})\n`);
    return { status, exitCode: result.exitCode, summary, logPath, timedOut };
  } finally {
    await new Promise<void>((resolve) => log.end(() => resolve()));
  }
}
