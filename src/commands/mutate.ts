import chalk from "chalk";
import { loadConfig } from "../config.js";
import { RelayDB } from "../db/client.js";
import { Assignee, type Task } from "../types.js";
import { runSnoozeUntil } from "./edit.js";
import { spawnAfterClose } from "../lib/recurrence-close.js";
import { describeRecurrence } from "../lib/recurrence.js";
import { mergeTasks } from "../lib/merge.js";

export function deriveCloseHint(
  task: Pick<Task, "source_type" | "source_id">,
  hints: ReadonlyArray<{ match: string; command: string }> = [],
): string | null {
  if (
    task.source_type === "github_issue" &&
    task.source_id.startsWith("https://github.com/")
  ) {
    return `gh issue close ${task.source_id}`;
  }
  if (
    task.source_type === "github_pr" &&
    task.source_id.startsWith("https://github.com/")
  ) {
    return `gh pr close ${task.source_id}`;
  }
  for (const hint of hints) {
    let re: RegExp;
    try {
      re = new RegExp(hint.match);
    } catch {
      continue;
    }
    const m = task.source_id.match(re);
    if (!m) continue;
    return hint.command.replace(/\$(\d+)/g, (_, n) => m[Number(n)] ?? "");
  }
  return null;
}

/**
 * `relay close <ids...>` — one undo entry for the whole batch, so a single
 * `relay undo` / ⌘Z brings every task (and any recurring occurrence the
 * close scheduled) back.
 */
export function runClose(ids: number | number[]): void {
  const list = Array.isArray(ids) ? ids : [ids];
  using db = new RelayDB();
  const { targets, failed } = resolveTargets(db, list);
  const toClose = targets.filter((task) => {
    if (task.status !== "done") return true;
    console.log(chalk.gray(`#${task.id} already closed`));
    return false;
  });
  if (toClose.length > 0) {
    for (const task of toClose) db.setStatus(task.id, "done");
    const recur = spawnAfterClose(db, toClose.map((task) => task.id));
    recordStatusUndo(db, toClose, toClose.length > 1 ? "bulk_close" : "close", recur);
    const hints = loadConfig().close_hints;
    for (const task of toClose) {
      console.log(chalk.green(`✓ closed #${task.id}: ${task.title}`));
      const next = recur.spawned.find((s) => s.from === task.id);
      if (next && task.recurrence) {
        console.log(
          chalk.cyan(`  ↻ ${describeRecurrence(task.recurrence)} — next occurrence #${next.id} on ${new Date(next.due_at).toLocaleDateString()}`),
        );
      }
      const hint = deriveCloseHint(task, hints);
      if (hint) console.log(chalk.gray(`  hint: also close upstream → ${hint}`));
    }
  }
  if (failed) process.exitCode = 1;
}

/** Indefinite snooze; `relay snooze --until` goes through runSnoozeUntil. */
export function runSnooze(id: number): void {
  runSnoozeUntil(id, undefined);
}

export function runReopen(ids: number | number[]): void {
  const list = Array.isArray(ids) ? ids : [ids];
  using db = new RelayDB();
  const { targets, failed } = resolveTargets(db, list);
  const toOpen = targets.filter((task) => {
    if (task.status !== "open") return true;
    console.log(chalk.gray(`#${task.id} already open`));
    return false;
  });
  if (toOpen.length > 0) {
    for (const task of toOpen) db.setStatus(task.id, "open");
    recordStatusUndo(db, toOpen, toOpen.length > 1 ? "bulk_reopen" : "reopen");
    for (const task of toOpen) console.log(chalk.green(`↺ re-opened #${task.id}: ${task.title}`));
  }
  if (failed) process.exitCode = 1;
}

function resolveTargets(db: RelayDB, ids: number[]): { targets: Task[]; failed: boolean } {
  let failed = false;
  const targets: Task[] = [];
  for (const id of [...new Set(ids)]) {
    const task = Number.isInteger(id) && id > 0 ? db.getTask(id) : null;
    if (!task) {
      console.log(chalk.red(`task #${id} not found`));
      failed = true;
      continue;
    }
    targets.push(task);
  }
  return { targets, failed };
}

/**
 * Same record as the Web's transitionStatus: makes the CLI change undoable
 * and, through recordUndo, discards stale redo entries — otherwise a Web
 * redo of an earlier action would silently overwrite this change.
 */
function recordStatusUndo(
  db: RelayDB,
  before: Task[],
  opKind: string,
  recur?: { payload: object; inverse: object },
): void {
  const after = db.getTasksByIds(before.map((task) => task.id));
  if (after.length === 0) return;
  db.recordUndo({
    op_kind: opKind,
    payload: { tasks: after.map(statusSnapshot), ...recur?.payload },
    inverse: { tasks: before.map(statusSnapshot), ...recur?.inverse },
  });
}

function statusSnapshot(task: Task) {
  return { id: task.id, status: task.status, due_at: task.due_at, closed_at: task.closed_at };
}

export function runAssign(id: number, raw: string): void {
  const parsed = Assignee.safeParse(raw);
  if (!parsed.success) {
    console.log(
      chalk.red(`invalid assignee: ${raw}`) +
        chalk.gray(`  (choose: ${Assignee.options.join(" | ")})`),
    );
    process.exit(1);
  }
  const assignee = parsed.data;
  const db = new RelayDB();
  const task = db.getTask(id);
  if (!task) {
    console.log(chalk.red(`task #${id} not found`));
    db.close();
    process.exit(1);
  }
  if (task.assignee === assignee) {
    console.log(chalk.gray(`#${id} already assigned to ${assignee}`));
    db.close();
    return;
  }
  db.setAssignee(id, assignee);
  db.recordUndo({
    op_kind: "reassign",
    payload: { tasks: [{ id, assignee }] },
    inverse: { tasks: [{ id, assignee: task.assignee }] },
  });
  db.close();
  console.log(
    chalk.green(`✓ reassigned #${id}: ${task.assignee} → ${assignee}`),
  );
}

/**
 * `relay merge <keep> <dups...>` — close duplicates into one survivor,
 * moving their tags, dependencies and notes onto it (one undo entry).
 */
export function runMerge(keepId: number, dupIds: number[]): void {
  using db = new RelayDB();
  const result = mergeTasks(db, keepId, dupIds);
  if (!result.ok) {
    console.log(chalk.red(result.error));
    process.exitCode = 1;
    return;
  }
  const keep = db.getTask(result.keep);
  console.log(
    chalk.green(`✓ merged ${result.merged.map((id) => `#${id}`).join(", ")} into #${result.keep}`) +
      (keep ? `: ${keep.title}` : ""),
  );
  const details: string[] = [];
  if (result.tags_added.length) details.push(`tags +${result.tags_added.join(" +")}`);
  if (result.deps_moved) details.push(`${result.deps_moved} dependency edge(s) moved`);
  if (result.notes_copied) details.push(`${result.notes_copied} note(s) copied`);
  if (result.dequeued) details.push(`${result.dequeued} queue item(s) dropped`);
  if (details.length) console.log(chalk.gray(`  ${details.join(" · ")}`));
  console.log(chalk.gray("  duplicates closed — relay undo reverts the merge"));
}
