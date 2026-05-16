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
  db.setStatus(id, "done");
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
  db.setStatus(id, "snoozed");
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
  db.setStatus(id, "open");
  db.close();
  console.log(chalk.green(`↺ re-opened #${id}: ${task.title}`));
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
