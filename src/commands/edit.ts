import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import { parseWhenInput, WHEN_INPUT_HINT } from "../lib/due-date.js";
import { parseTaskEdit } from "../lib/task-edit.js";
import type { Task } from "../types.js";

export interface EditOptions {
  title?: string;
  body?: string;
  priority?: string;
  prompt?: string;
  files?: string;
  due?: string;
  waitOn?: string;
  repo?: string;
  clearDue?: boolean;
  clearPrompt?: boolean;
  reset?: string;
}

/**
 * `relay edit <id>` — change a task's user-editable fields. Edited fields
 * are locked so the next `relay sync` keeps them; `--reset title,priority`
 * hands those fields back to the adapter.
 */
export function runEdit(id: number, opts: EditOptions): void {
  const body: Record<string, unknown> = {};
  if (opts.title !== undefined) body.title = opts.title;
  if (opts.body !== undefined) body.body = opts.body;
  if (opts.priority !== undefined) body.priority = opts.priority;
  if (opts.prompt !== undefined) body.prompt = opts.prompt;
  if (opts.clearPrompt) body.prompt = null;
  if (opts.files !== undefined) body.files = opts.files;
  if (opts.due !== undefined) body.due_at = opts.due;
  if (opts.clearDue) body.due_at = null;
  if (opts.waitOn !== undefined) body.wait_on = opts.waitOn;
  if (opts.repo !== undefined) body.repo = opts.repo;
  if (opts.reset !== undefined) body.reset = opts.reset;

  const db = new RelayDB();
  const task = db.getTask(id);
  if (!task) {
    db.close();
    console.log(chalk.red(`task #${id} not found`));
    process.exit(1);
  }
  const parsed = parseTaskEdit(body, task);
  if (!parsed.ok) {
    db.close();
    console.log(chalk.red(parsed.error));
    if (parsed.error === "nothing to change") {
      console.log(
        chalk.gray(
          "  flags: --title --body --priority --prompt --files --due --wait-on --repo --clear-due --clear-prompt --reset <fields>",
        ),
      );
    }
    process.exit(1);
  }
  const result = db.editTask(id, parsed.patch, { unlock: parsed.reset });
  if (result && (result.changed.length > 0 || result.overridesChanged)) {
    db.recordUndo({ op_kind: "edit", payload: { tasks: [result.after] }, inverse: { tasks: [result.before] } });
  }
  const after = db.getTask(id);
  db.close();
  if (!result || !after) return;

  if (result.changed.length === 0 && !result.overridesChanged) {
    console.log(chalk.gray(`#${id} unchanged (values already match)`));
    return;
  }
  console.log(chalk.green(`✓ edited #${id}: ${after.title}`));
  for (const field of result.changed) {
    console.log(
      chalk.gray(`  ${field.padEnd(8)} `) +
        chalk.red(fmt(result.before.fields[field])) +
        chalk.gray(" → ") +
        chalk.green(fmt(result.after.fields[field])),
    );
  }
  if (parsed.reset.length) {
    console.log(chalk.gray(`  reset:   ${parsed.reset.join(", ")} (upstream value returns on next sync)`));
  }
  if (task.source_type !== "manual" && result.changed.length > 0) {
    console.log(chalk.gray("  edited fields are kept across `relay sync`; undo: `relay undo`"));
  }
}

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "∅";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "∅";
  const s = String(value).replace(/\s+/g, " ");
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/** `relay snooze <id> [--until <when>]`. */
export function runSnoozeUntil(id: number, untilRaw: string | undefined): void {
  let until: string | null = null;
  if (untilRaw !== undefined) {
    until = parseWhenInput(untilRaw);
    if (!until) {
      console.log(chalk.red(`invalid --until: ${untilRaw}`) + chalk.gray(`  (use ${WHEN_INPUT_HINT})`));
      process.exit(1);
    }
    if (Date.parse(until) <= Date.now()) {
      console.log(chalk.red(`--until must be in the future (got ${until})`));
      process.exit(1);
    }
  }
  const db = new RelayDB();
  const task = db.getTask(id);
  if (!task) {
    db.close();
    console.log(chalk.red(`task #${id} not found`));
    process.exit(1);
  }
  if (task.status === "snoozed" && (until === null || task.due_at === until)) {
    db.close();
    console.log(chalk.gray(`#${id} already snoozed`));
    return;
  }
  db.snoozeTask(id, until);
  const after = db.getTask(id);
  if (after) {
    db.recordUndo({
      op_kind: "snooze",
      payload: { tasks: [statusSnapshot(after)] },
      inverse: { tasks: [statusSnapshot(task)] },
    });
  }
  db.close();
  const suffix = until ? ` until ${new Date(until).toLocaleString()}` : "";
  console.log(chalk.yellow(`⏸ snoozed #${id}${suffix}: ${task.title}`));
  if (until) console.log(chalk.gray("  it reopens on its own once that time passes"));
}

function statusSnapshot(task: Task) {
  return { id: task.id, status: task.status, due_at: task.due_at, closed_at: task.closed_at };
}

/** `relay undo [--redo] [--list]` — the CLI side of the Web's ⌘Z. */
export async function runUndo(opts: { redo?: boolean; list?: boolean; limit?: number } = {}): Promise<void> {
  // Loaded lazily: api/undo pulls in Hono, which only undo needs.
  const { applyUndo } = await import("../api/undo.js");
  const db = new RelayDB();
  if (opts.list) {
    const rows = db.listUndo(opts.limit ?? 10);
    db.close();
    if (rows.length === 0) {
      console.log(chalk.gray("undo log is empty"));
      return;
    }
    for (const row of rows) {
      const mark = row.status === "active" ? chalk.green("●") : chalk.gray("○");
      console.log(`${mark} ${chalk.gray(String(row.id).padStart(4))}  ${row.op_kind.padEnd(18)} ${chalk.gray(row.created_at)}${row.status === "undone" ? chalk.gray("  (undone — redo-able)") : ""}`);
    }
    return;
  }
  const redo = Boolean(opts.redo);
  const outcome = applyUndo(db, redo);
  db.close();
  if ("error" in outcome) {
    console.log(chalk.red(outcome.error));
    process.exit(1);
  }
  if (!outcome.undone && !outcome.redone) {
    console.log(chalk.gray(redo ? "nothing to redo" : "nothing to undo"));
    return;
  }
  const verb = redo ? "redid" : "undid";
  console.log(chalk.green(`↶ ${verb} ${outcome.op_kind} (${outcome.count ?? 0} task(s))`));
  if (outcome.message) console.log(chalk.yellow(`  ${outcome.message}`));
}
