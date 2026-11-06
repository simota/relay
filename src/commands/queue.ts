// `relay queue` — the CLI side of the AI job queue.
//
// The Web UI's queue tray and these subcommands share `queue_items`, so a
// task queued with `a` in the browser is picked up by `relay queue run` in
// the terminal (and vice versa). `queue run` launches each queued task in
// order — interactively, or unattended with `--headless` — records a run
// per task, and drops an item from the queue once its run succeeds.

import chalk from "chalk";
import { loadConfig, type Config } from "../config.js";
import { RelayDB, type QueueItem } from "../db/client.js";
import { Assignee, type Task } from "../types.js";
import { padEndDisplay, truncateDisplay } from "../lib/text-width.js";
import {
  executePrepared,
  launchBlocker,
  prepareRun,
  previewPrompt,
  printHeadlessOutcome,
  type ExecuteResult,
} from "./run.js";

export function runQueueList(): void {
  using db = new RelayDB();
  const items = db.listQueueItems();
  if (items.length === 0) {
    console.log(chalk.gray("queue is empty — add tasks with `relay queue add <id...>` or `a` in the Web UI"));
    return;
  }
  console.log(chalk.bold(`queue · ${items.length} item${items.length === 1 ? "" : "s"}`));
  items.forEach((item, index) => console.log(formatQueueRow(item, index)));
  console.log(chalk.gray("\nrun them: relay queue run  (unattended: relay queue run --headless)"));
}

function formatQueueRow(item: QueueItem, index: number): string {
  const status = item.status === "done" ? chalk.gray("done") : item.status === "in_progress" ? chalk.cyan("in progress") : "";
  return (
    chalk.gray(`${String(index + 1).padStart(2)}. `) +
    chalk.cyan(`#${item.task_id}`.padEnd(7)) +
    chalk.magenta(padEndDisplay(truncateDisplay(item.assignee, 12), 13)) +
    chalk.blue(padEndDisplay(truncateDisplay(item.repo, 18), 19)) +
    truncateDisplay(item.title, 60) +
    (status ? `  ${status}` : "")
  );
}

/**
 * Blockers of `taskId` that still gate it: not done and not satisfied in
 * this pass. A task that is itself done has none (it is dropped anyway).
 */
function unmetBlockers(db: RelayDB, taskId: number, satisfied: ReadonlySet<number>): number[] {
  const blockers = db.blockerIdsOf(taskId);
  if (blockers.length === 0) return [];
  if (db.getTask(taskId)?.status === "done") return [];
  const statusById = new Map(db.getTasksByIds(blockers).map((task) => [task.id, task.status]));
  return blockers.filter((id) => !satisfied.has(id) && statusById.has(id) && statusById.get(id) !== "done");
}

export interface QueueAddOptions {
  front?: boolean;
  assign?: string;
}

export function runQueueAdd(ids: number[], options: QueueAddOptions = {}): void {
  let assignee: Assignee | undefined;
  if (options.assign) {
    const parsed = Assignee.safeParse(options.assign);
    if (!parsed.success) {
      console.log(chalk.red(`invalid agent: ${options.assign} (${Assignee.options.join(" | ")})`));
      process.exit(1);
    }
    assignee = parsed.data;
  }
  using db = new RelayDB();
  const reassigned: Array<{ id: number; before: string; after: string }> = [];
  let failed = false;
  // --front keeps the given order at the head of the queue: insert in reverse.
  const ordered = options.front ? [...ids].reverse() : ids;
  const added: number[] = [];
  for (const id of ordered) {
    const task = db.getTask(id);
    if (!task) {
      console.log(chalk.red(`✗ task #${id} not found`));
      failed = true;
      continue;
    }
    if (assignee && task.assignee !== assignee) {
      db.setAssignee(id, assignee);
      reassigned.push({ id, before: task.assignee, after: assignee });
    }
    db.addQueueItem(id, { front: options.front });
    added.push(id);
  }
  if (reassigned.length > 0) {
    db.recordUndo({
      op_kind: "reassign",
      payload: { tasks: reassigned.map((r) => ({ id: r.id, assignee: r.after })) },
      inverse: { tasks: reassigned.map((r) => ({ id: r.id, assignee: r.before })) },
    });
  }
  if (added.length > 0) {
    const shown = options.front ? [...added].reverse() : added;
    console.log(
      chalk.green(`✓ queued ${shown.map((id) => `#${id}`).join(" ")}`) +
        (options.front ? chalk.gray(" (front)") : "") +
        (reassigned.length > 0 ? chalk.gray(` · assigned ${reassigned.length} to ${assignee}`) : ""),
    );
    console.log(chalk.gray(`  queue now has ${db.listQueueItems().length} item(s)`));
  }
  if (failed) process.exitCode = 1;
}

export function runQueueRemove(taskIds: number[]): void {
  using db = new RelayDB();
  let removed = 0;
  for (const id of taskIds) removed += db.deleteQueueItemsForTask(id);
  console.log(removed > 0 ? chalk.green(`✓ removed ${removed} item(s) from the queue`) : chalk.gray("nothing to remove"));
}

export function runQueueClear(): void {
  using db = new RelayDB();
  const count = db.listQueueItems().length;
  db.clearQueue();
  console.log(chalk.green(`✓ cleared ${count} item(s)`));
}

export interface QueueRunOptions {
  headless?: boolean;
  dryRun?: boolean;
  /** Stop after this many launches. */
  limit?: number;
  /** Keep going after a failed run (default: stop at the first failure). */
  continueOnError?: boolean;
  /** Leave items in the queue even after a successful run. */
  keep?: boolean;
  closeOnSuccess?: boolean;
  timeoutMin?: number;
  noTemplate?: boolean;
  noResume?: boolean;
}

export type QueueOutcomeKind = "success" | "failed" | "interrupted" | "skipped" | "planned";

export interface QueueOutcome {
  taskId: number;
  title: string;
  kind: QueueOutcomeKind;
  reason?: string;
  runId?: number;
}

export interface QueueRunDeps {
  cfg?: Config;
  execute?: typeof executePrepared;
  log?: (line: string) => void;
}

/**
 * Work through the queue. The queue is re-read before every launch, so
 * items added (or removed) from the Web UI while a long run is going are
 * honoured; each item is attempted at most once per invocation.
 */
export async function processQueue(
  options: QueueRunOptions = {},
  deps: QueueRunDeps = {},
): Promise<QueueOutcome[]> {
  const cfg = deps.cfg ?? loadConfig();
  const execute = deps.execute ?? executePrepared;
  const log = deps.log ?? ((line: string) => console.log(line));
  const headless = Boolean(options.headless);
  const limit = options.limit && options.limit > 0 ? options.limit : Infinity;
  const attempted = new Set<number>();
  // Task ids that succeeded (or, in a dry run, were planned) earlier in this
  // pass: they satisfy dependents even when the run did not close them.
  const satisfied = new Set<number>();
  const outcomes: QueueOutcome[] = [];
  let launches = 0;
  let stopRequested = false;
  const onSigint = () => {
    if (stopRequested) process.exit(130);
    stopRequested = true;
    log(chalk.yellow("\n■ interrupted — the queue stops after the current task (Ctrl-C again to abort relay)"));
  };
  if (!options.dryRun) process.on("SIGINT", onSigint);

  try {
    while (launches < limit && !stopRequested) {
      let task: Task | null;
      let item: QueueItem | undefined;
      let prep: ReturnType<typeof prepareRun>;
      {
        using db = new RelayDB();
        const pending = db.listQueueItems().filter((candidate) => !attempted.has(candidate.id));
        if (pending.length === 0) break;
        // Dependency-aware pick: the first item whose blockers are all done
        // (or satisfied earlier in this pass). A dependent queued ahead of
        // its blocker simply waits; the scan restarts from the head after
        // every launch, so it runs as soon as the blocker succeeds.
        item = pending.find((candidate) => unmetBlockers(db, candidate.task_id, satisfied).length === 0);
        if (!item) {
          for (const candidate of pending) {
            attempted.add(candidate.id);
            const unmet = unmetBlockers(db, candidate.task_id, satisfied);
            const reason = `blocked by ${unmet.map((id) => `#${id}`).join(" ")}`;
            outcomes.push({ taskId: candidate.task_id, title: candidate.title, kind: "skipped", reason });
            log(chalk.yellow(`– #${candidate.task_id} skipped: ${reason}`));
          }
          break;
        }
        attempted.add(item.id);
        task = db.getTask(item.task_id);
        if (!task) {
          db.deleteQueueItem(item.id);
          continue;
        }
        if (task.status === "done") {
          if (!options.dryRun) db.deleteQueueItem(item.id);
          outcomes.push({ taskId: task.id, title: task.title, kind: "skipped", reason: "already done" });
          log(chalk.gray(`– #${task.id} already done${options.dryRun ? "" : " — removed from queue"}`));
          continue;
        }
        const blocker = launchBlocker(task, headless);
        if (blocker) {
          outcomes.push({ taskId: task.id, title: task.title, kind: "skipped", reason: blocker });
          log(chalk.yellow(`– #${task.id} skipped: ${blocker}`));
          continue;
        }
        prep = prepareRun(db, task, cfg, { noTemplate: options.noTemplate, noResume: options.noResume });
      }
      if (!prep.ok) {
        outcomes.push({ taskId: task.id, title: task.title, kind: "failed", reason: prep.error });
        log(chalk.red(`✗ #${task.id} ${prep.error}`));
        if (!options.continueOnError) break;
        continue;
      }

      const header =
        chalk.cyan(`▶ [${launches + 1}] #${task.id}`) +
        `  ${task.title}` +
        chalk.gray(`\n   ${prep.prepared.repoRoot}  (${task.assignee}${headless ? ", headless" : ""})`);
      if (options.dryRun) {
        log(header);
        const prompt = previewPrompt(prep.prepared, headless, options.noResume);
        log(chalk.gray(prompt ? `   prompt: ${oneLine(prompt, 100)}` : "   (no prompt)"));
        outcomes.push({ taskId: task.id, title: task.title, kind: "planned" });
        satisfied.add(task.id);
        launches += 1;
        continue;
      }

      log(header);
      launches += 1;
      const result: ExecuteResult = await execute(prep.prepared, cfg, {
        headless,
        noResume: options.noResume,
        timeoutMin: options.timeoutMin,
        closeOnSuccess: options.closeOnSuccess,
      });
      if (headless) printHeadlessOutcome(result);
      outcomes.push({
        taskId: task.id,
        title: task.title,
        kind: result.status,
        runId: result.runId,
        reason: result.status === "success" ? undefined : result.summary ?? `exit ${result.exitCode}`,
      });
      if (result.status === "success") {
        satisfied.add(task.id);
        if (!options.keep) {
          using db = new RelayDB();
          db.deleteQueueItem(item.id);
        }
        continue;
      }
      if (result.status === "interrupted") break;
      if (!options.continueOnError) break;
    }
  } finally {
    if (!options.dryRun) process.off("SIGINT", onSigint);
  }
  return outcomes;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function runQueueRun(options: QueueRunOptions = {}): Promise<void> {
  const outcomes = await processQueue(options);
  if (outcomes.length === 0) {
    console.log(chalk.gray("queue is empty — nothing to run"));
    return;
  }
  const count = (kind: QueueOutcomeKind) => outcomes.filter((o) => o.kind === kind).length;
  if (options.dryRun) {
    console.log(chalk.bold(`\ndry run: ${count("planned")} would launch, ${count("skipped")} skipped`));
    return;
  }
  let remaining = 0;
  {
    using db = new RelayDB();
    remaining = db.listQueueItems().length;
  }
  console.log(
    chalk.bold("\nqueue run: ") +
      chalk.green(`${count("success")} succeeded`) +
      ", " +
      (count("failed") > 0 ? chalk.red(`${count("failed")} failed`) : "0 failed") +
      (count("interrupted") > 0 ? `, ${chalk.yellow(`${count("interrupted")} interrupted`)}` : "") +
      (count("skipped") > 0 ? `, ${count("skipped")} skipped` : "") +
      chalk.gray(` · ${remaining} left in queue`),
  );
  for (const outcome of outcomes.filter((o) => o.kind === "failed" || o.kind === "interrupted")) {
    console.log(
      chalk.red(`  ✗ #${outcome.taskId} ${outcome.title}`) +
        (outcome.reason ? chalk.gray(` — ${oneLine(outcome.reason, 80)}`) : "") +
        (outcome.runId ? chalk.gray(`  (relay runs --log ${outcome.runId})`) : ""),
    );
  }
  if (count("failed") > 0 || count("interrupted") > 0) process.exitCode = 1;
}
