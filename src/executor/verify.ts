// Verify gate (schema v15).
//
// An agent exiting 0 only means the CLI did not crash — not that the task is
// done. Before relay closes a task (`--close-on-success`) or drops it from
// the queue, the verify gate runs the repo's own check (tests, typecheck,
// lint…) in the repo root. A failing check turns the run into a failure, and
// with `--retries N` the failure output is fed back to the agent as a task
// note for the next attempt — so an unattended queue keeps iterating until
// the repo is green (or the retry budget runs out) instead of reporting
// "success" for broken work.
//
// Where the command comes from, first match wins:
//   1. `[[verify.repos]]` in ~/.relay/config.toml (repo glob → command)
//   2. `<repo>/.agents/RELAY_VERIFY` (first non-comment line)
//
// The command runs through `sh -c` with the repo root as cwd, in its own
// process group so a timeout also stops the test runner's children.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { globToRegExp } from "../lib/rules.js";

export interface VerifyCommand {
  command: string;
  /** Where it was configured, for messages: "config" or ".agents/RELAY_VERIFY". */
  source: "config" | "repo-file";
}

export const VERIFY_FILE = path.join(".agents", "RELAY_VERIFY");

/** First command line of a RELAY_VERIFY file (blank lines and `#` comments skipped). */
export function parseVerifyFile(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    return line;
  }
  return null;
}

export function resolveVerifyCommand(
  repo: string,
  repoRoot: string | null,
  cfg: Pick<Config, "verify">,
): VerifyCommand | null {
  for (const entry of cfg.verify.repos) {
    const command = entry.command.trim();
    if (command.length === 0) continue;
    if (entry.repo.some((glob) => globToRegExp(glob).test(repo))) return { command, source: "config" };
  }
  if (repoRoot) {
    const file = path.join(repoRoot, VERIFY_FILE);
    if (existsSync(file)) {
      try {
        const command = parseVerifyFile(readFileSync(file, "utf8"));
        if (command) return { command, source: "repo-file" };
      } catch {
        // unreadable file: treated as "no verify command"
      }
    }
  }
  return null;
}

export interface VerifyResult {
  status: "passed" | "failed";
  command: string;
  exitCode: number;
  /** Tail of combined stdout/stderr (ANSI stripped). */
  output: string;
  timedOut: boolean;
  durationMs: number;
}

/** Bytes of verify output kept in memory / on the run row. */
export const VERIFY_OUTPUT_KEEP = 4000;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

/** Keep the last `max` characters, on a line boundary when possible. */
export function tailText(text: string, max = VERIFY_OUTPUT_KEEP): string {
  const clean = stripAnsi(text).replace(/\s+$/, "");
  if (clean.length <= max) return clean;
  const cut = clean.slice(clean.length - max);
  const nl = cut.indexOf("\n");
  return `…${nl >= 0 && nl < 200 ? cut.slice(nl + 1) : cut}`;
}

export interface RunVerifyOptions {
  /** Kill the command after this many ms (0/undefined = no limit). */
  timeoutMs?: number;
  /** Also append the output to this log file (the headless run log). */
  logPath?: string | null;
  /** Mirror output to this terminal. */
  echo?: boolean;
}

export async function runVerify(
  command: string,
  repoRoot: string,
  opts: RunVerifyOptions = {},
): Promise<VerifyResult> {
  const started = Date.now();
  const append = (text: string) => {
    if (!opts.logPath) return;
    try {
      appendFileSync(opts.logPath, text);
    } catch {
      // the log is best-effort
    }
  };
  append(`\n# verify: ${command}\n# started: ${new Date().toISOString()}\n\n`);
  let tail = "";
  let timedOut = false;
  const exitCode = await new Promise<number>((resolve) => {
    let proc;
    try {
      proc = spawn("sh", ["-c", command], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env: { ...process.env, CI: process.env.CI ?? "1", RELAY_VERIFY: "1" },
      });
    } catch (e) {
      tail = e instanceof Error ? e.message : String(e);
      resolve(127);
      return;
    }
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (proc.pid) process.kill(-proc.pid, sig);
      } catch {
        proc.kill(sig);
      }
    };
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      append(text);
      if (opts.echo) process.stdout.write(chunk);
      tail = (tail + text).slice(-VERIFY_OUTPUT_KEEP * 4);
    };
    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killGroup("SIGTERM");
            killTimer = setTimeout(() => killGroup("SIGKILL"), 5000);
          }, opts.timeoutMs)
        : undefined;
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(code);
    };
    proc.on("error", (err) => {
      tail += `\n${err.message}`;
      finish(127);
    });
    proc.on("close", (code, signal) => finish(code ?? (signal ? 128 : 1)));
  });
  const status = exitCode === 0 && !timedOut ? "passed" : "failed";
  let output = tailText(tail);
  if (timedOut) output = `${output}\n(verify timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s)`.trim();
  append(`\n# verify ${status} (exit ${exitCode}) · ${new Date().toISOString()}\n`);
  return { status, command, exitCode, output, timedOut, durationMs: Date.now() - started };
}

/** One-line run summary for a failed verification. */
export function verifyFailureSummary(result: VerifyResult): string {
  const last = result.output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join("\n");
  const head = result.timedOut
    ? `verify timed out: ${result.command}`
    : `verify failed (exit ${result.exitCode}): ${result.command}`;
  return last ? `${head}\n${last}` : head;
}

/** Lines of failure output fed back to the agent on a retry. */
const FEEDBACK_OUTPUT_CHARS = 2500;

/** Prefix of every auto-written retry note, so they are easy to spot. */
export const AUTO_FEEDBACK_PREFIX = "[relay auto-retry]";

/**
 * The task note written before an automatic retry: what failed and the
 * tail of its output, phrased as an instruction for the next attempt.
 */
export function retryFeedbackNote(input: {
  attempt: number;
  maxAttempts: number;
  runId: number;
  verify?: VerifyResult | null;
  agentSummary?: string | null;
  exitCode: number;
}): string {
  const lines = [`${AUTO_FEEDBACK_PREFIX} attempt ${input.attempt}/${input.maxAttempts} (run #${input.runId}) did not pass.`];
  if (input.verify && input.verify.status === "failed") {
    lines.push(
      input.verify.timedOut
        ? `The verify command \`${input.verify.command}\` timed out.`
        : `The verify command \`${input.verify.command}\` exited ${input.verify.exitCode}. Make it pass without weakening or skipping the checks.`,
    );
    const out = tailText(input.verify.output, FEEDBACK_OUTPUT_CHARS);
    if (out) lines.push("```", out, "```");
  } else {
    lines.push(`The agent exited with code ${input.exitCode} before finishing.`);
    const out = input.agentSummary ? tailText(input.agentSummary, FEEDBACK_OUTPUT_CHARS) : "";
    if (out) lines.push("Last output:", "```", out, "```");
  }
  return lines.join("\n");
}
