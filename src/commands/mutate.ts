import chalk from "chalk";
import { loadConfig } from "../config.js";
import { RelayDB } from "../db/client.js";
import { Assignee, type Task } from "../types.js";

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

export function runClose(id: number): void {
  const db = new RelayDB();
  const task = db.getTask(id);
  if (!task) {
    console.log(chalk.red(`task #${id} not found`));
    db.close();
    process.exit(1);
  }
  if (task.status === "done") {
    console.log(chalk.gray(`#${id} already closed`));
    db.close();
    return;
  }
  setStatusWithUndo(db, task, "done", "close");
  db.close();
  console.log(chalk.green(`✓ closed #${id}: ${task.title}`));
  const hint = deriveCloseHint(task, loadConfig().close_hints);
  if (hint) {
    console.log(chalk.gray(`  hint: also close upstream → ${hint}`));
  }
}

export function runSnooze(id: number): void {
  const db = new RelayDB();
  const task = db.getTask(id);
  if (!task) {
    console.log(chalk.red(`task #${id} not found`));
    db.close();
    process.exit(1);
  }
  if (task.status === "snoozed") {
    console.log(chalk.gray(`#${id} already snoozed`));
    db.close();
    return;
  }
  setStatusWithUndo(db, task, "snoozed", "snooze");
  db.close();
  console.log(chalk.yellow(`⏸ snoozed #${id}: ${task.title}`));
}

export function runReopen(id: number): void {
  const db = new RelayDB();
  const task = db.getTask(id);
  if (!task) {
    console.log(chalk.red(`task #${id} not found`));
    db.close();
    process.exit(1);
  }
  if (task.status === "open") {
    console.log(chalk.gray(`#${id} already open`));
    db.close();
    return;
  }
  setStatusWithUndo(db, task, "open", "reopen");
  db.close();
  console.log(chalk.green(`↺ re-opened #${id}: ${task.title}`));
}

/**
 * Same record as the Web's transitionStatus: makes the CLI change undoable
 * and, through recordUndo, discards stale redo entries — otherwise a Web
 * redo of an earlier action would silently overwrite this change.
 */
function setStatusWithUndo(db: RelayDB, before: Task, status: Task["status"], opKind: string): void {
  db.setStatus(before.id, status);
  const after = db.getTask(before.id);
  if (!after) return;
  db.recordUndo({
    op_kind: opKind,
    payload: { tasks: [statusSnapshot(after)] },
    inverse: { tasks: [statusSnapshot(before)] },
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
