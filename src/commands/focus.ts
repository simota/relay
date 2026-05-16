import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import { RELAY_HOME } from "../paths.js";

/**
 * Path to the singleton focus state file. Lives next to db.sqlite under
 * RELAY_HOME so a custom RELAY_HOME env var transparently moves it too.
 */
export const STATE_PATH = join(RELAY_HOME, "state.json");

export interface FocusState {
  /** Task id currently being focused, or null when no focus is set. */
  focus_task_id: number | null;
  /** ISO timestamp of the most recent setFocus / clearFocus call. */
  set_at: string;
}

const EMPTY_STATE: FocusState = { focus_task_id: null, set_at: "" };

/**
 * Read the singleton state file. Missing file / unreadable JSON returns the
 * empty state — the focus feature is purely additive, so corruption never
 * blocks the rest of the CLI.
 */
function readState(): FocusState {
  if (!existsSync(STATE_PATH)) return { ...EMPTY_STATE };
  try {
    const raw = readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<FocusState>;
    const id = parsed.focus_task_id;
    const set_at = typeof parsed.set_at === "string" ? parsed.set_at : "";
    return {
      focus_task_id: typeof id === "number" && Number.isFinite(id) ? id : null,
      set_at,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/**
 * Atomically write the state file: write to a sibling `.tmp` then rename so
 * a concurrent reader never observes a half-written JSON blob (POSIX rename
 * is atomic when source and destination are on the same filesystem, which
 * they always are here because both live under RELAY_HOME).
 */
function writeState(state: FocusState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, STATE_PATH);
}

/** Returns the currently-focused task id, or null if no focus is set. */
export function getFocus(): number | null {
  return readState().focus_task_id;
}

/** Sets the focus to the given task id. Caller is responsible for validating the id exists. */
export function setFocus(id: number): void {
  writeState({ focus_task_id: id, set_at: new Date().toISOString() });
}

/** Clears the focus. Safe to call when no focus is currently set. */
export function clearFocus(): void {
  writeState({ focus_task_id: null, set_at: new Date().toISOString() });
}

export interface RunFocusOptions {
  id?: number;
  clear?: boolean;
}

/**
 * CLI entry point for `relay focus`.
 *   `relay focus 42`        → setFocus(42) (validates the task exists)
 *   `relay focus --clear`   → clearFocus()
 *   `relay focus` (no arg)  → print current focus
 */
export function runFocus(opts: RunFocusOptions): void {
  if (opts.clear) {
    const current = getFocus();
    clearFocus();
    if (current === null) {
      console.log(chalk.gray("no focus set."));
    } else {
      console.log(chalk.green(`✓ cleared focus (was #${current})`));
    }
    return;
  }

  if (opts.id === undefined) {
    const current = getFocus();
    if (current === null) {
      console.log(chalk.gray("no focus set. usage: relay focus <id> | relay focus --clear"));
      return;
    }
    const db = new RelayDB();
    const task = db.getTask(current);
    db.close();
    if (!task) {
      console.log(
        chalk.yellow(
          `focus points at #${current} but that task no longer exists — clearing.`,
        ),
      );
      clearFocus();
      return;
    }
    console.log(chalk.cyan(`focus: #${task.id}`) + `  ${task.title}`);
    console.log(chalk.gray(`  repo:     ${task.repo}`));
    console.log(chalk.gray(`  assignee: ${task.assignee}`));
    console.log(chalk.gray("  clear with: relay focus --clear"));
    return;
  }

  const db = new RelayDB();
  const task = db.getTask(opts.id);
  db.close();
  if (!task) {
    console.log(chalk.red(`task #${opts.id} not found`));
    process.exit(1);
  }
  setFocus(opts.id);
  console.log(chalk.green(`✓ focus set: #${task.id}`) + `  ${task.title}`);
  console.log(
    chalk.gray("  relay today / web Today will now show only this task. clear: relay focus --clear"),
  );
}
