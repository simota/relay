// `relay runs` — agent run history across tasks, plus the captured log of
// a headless run. Answers "what did the queue do while I was away?".

import chalk from "chalk";
import { RelayDB, type RunListRow } from "../db/client.js";
import { readRunLog, runLogPath } from "../executor/headless.js";
import { padEndDisplay, truncateDisplay } from "../lib/text-width.js";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { formatChangeSummary, type RunChanges } from "../executor/changes.js";
import { resolveRepoPath } from "../repo-resolver.js";

export interface RunsOptions {
  task?: number;
  status?: string;
  agent?: string;
  limit?: number;
  log?: number;
  /** Print the git diff a run produced (vs its pre-run HEAD). */
  diff?: number;
  json?: boolean;
}

const RUN_STATUSES = new Set(["running", "success", "failed", "interrupted"]);

export function runRuns(options: RunsOptions = {}): void {
  if (options.log !== undefined) {
    showLog(options.log);
    return;
  }
  if (options.diff !== undefined) {
    showDiff(options.diff);
    return;
  }
  if (options.status && !RUN_STATUSES.has(options.status)) {
    console.log(chalk.red(`invalid --status: ${options.status} (${[...RUN_STATUSES].join(" | ")})`));
    process.exit(1);
  }
  using db = new RelayDB();
  const rows = db.listRuns({
    taskId: options.task,
    status: options.status,
    agent: options.agent,
    limit: options.limit ?? 20,
  });
  if (options.json) {
    console.log(JSON.stringify(rows.map((row) => ({ ...row, has_log: readRunLog(row.id) !== null })), null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log(chalk.gray("no runs yet — launch one with `relay run <id>` or `relay queue run`"));
    return;
  }
  for (const row of rows) console.log(formatRunRow(row));
  console.log(chalk.gray("\nlog of a headless run: relay runs --log <run-id>  ·  what it changed: relay runs --diff <run-id>"));
}

function formatRunRow(row: RunListRow): string {
  const color =
    row.status === "success" ? chalk.green : row.status === "running" ? chalk.cyan : row.status === "interrupted" ? chalk.yellow : chalk.red;
  const summary = row.output_summary ? row.output_summary.split("\n").pop() ?? "" : "";
  return (
    chalk.gray(`r${row.id}`.padEnd(7)) +
    color(row.status.padEnd(12)) +
    chalk.magenta(padEndDisplay(truncateDisplay(row.agent, 12), 13)) +
    chalk.gray(formatDuration(row.started_at, row.ended_at).padEnd(8)) +
    chalk.cyan(`#${row.task_id} `) +
    truncateDisplay(row.task_title, 48) +
    (row.changes ? chalk.cyan(`  ${formatChangeSummary(row.changes)}`) : "") +
    (summary ? chalk.gray(`\n${" ".repeat(7)}${truncateDisplay(summary, 100)}`) : "")
  );
}

export function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}m`;
}

function showLog(runId: number): void {
  using db = new RelayDB();
  const run = db.getRun(runId);
  if (!run) {
    console.log(chalk.red(`run #${runId} not found`));
    process.exit(1);
  }
  const log = readRunLog(runId);
  console.log(
    chalk.bold(`run #${run.id}`) +
      chalk.gray(` · task #${run.task_id} ${run.task_title} · ${run.agent} · ${run.status}`),
  );
  if (run.changes) printChanges(run.changes);
  if (!log) {
    console.log(chalk.gray("(no captured log — only headless runs record output)"));
    if (run.output_summary) console.log(run.output_summary);
    return;
  }
  if (log.truncated) console.log(chalk.gray(`(showing the last part of ${log.bytes} bytes — full log: ${runLogPath(runId)})`));
  process.stdout.write(log.text.endsWith("\n") ? log.text : `${log.text}\n`);
}

export function printChanges(changes: RunChanges, indent = ""): void {
  console.log(chalk.cyan(`${indent}changed: ${formatChangeSummary(changes)}`));
  for (const file of changes.files) {
    const stat =
      file.added === null && file.removed === null
        ? chalk.gray("new/binary")
        : `${chalk.green(`+${file.added ?? 0}`)} ${chalk.red(`−${file.removed ?? 0}`)}`;
    console.log(`${indent}  ${stat}  ${file.path}`);
  }
  if (changes.more > 0) console.log(chalk.gray(`${indent}  … ${changes.more} more`));
}

/**
 * `relay runs --diff <id>` — the patch an agent run produced. While HEAD
 * is still where the run left it, the diff runs against the work tree so
 * uncommitted edits show too; once HEAD moved on, only the run's commits.
 */
function showDiff(runId: number): void {
  using db = new RelayDB();
  const run = db.getRun(runId);
  if (!run) {
    console.log(chalk.red(`run #${runId} not found`));
    process.exit(1);
  }
  const before = run.changes?.head_before;
  if (!run.changes || !before) {
    console.log(chalk.gray(`run #${runId} has no recorded changes (not a git repo, or recorded before schema v13)`));
    return;
  }
  const repoRoot = resolveRepoPath(run.repo, loadConfig());
  if (!repoRoot) {
    console.log(chalk.red(`repo '${run.repo}' not found under scan.roots`));
    process.exit(1);
  }
  printChanges(run.changes);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout?.trim();
  const after = run.changes.head_after;
  const args =
    after && head && head !== after ? ["diff", before, after] : ["diff", before];
  if (after && head && head !== after) {
    console.log(chalk.gray(`(HEAD moved since the run — showing ${before.slice(0, 8)}..${after.slice(0, 8)} only)`));
  }
  console.log("");
  const res = spawnSync("git", ["--no-pager", ...args], { cwd: repoRoot, stdio: "inherit" });
  if (res.status !== 0) process.exitCode = res.status ?? 1;
}
