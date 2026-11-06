// `relay note` — task notes (schema v14). Notes are a per-task progress log
// that the next agent run reads ("# Notes from the user"), so a failed run
// can be retried with feedback: `relay note 42 "tests live in pkg/x" --queue`.

import chalk from "chalk";
import { RelayDB, normalizeNoteBody, type TaskNote } from "../db/client.js";
import { recordNotesUndo } from "../api/undo.js";

export interface NoteOptions {
  /** Note text; empty = list the task's notes. */
  text: string;
  /** Delete this note id instead of adding. */
  remove?: number;
  /** After adding, put the task on the AI job queue (retry with feedback). */
  queue?: boolean;
  /** --queue: put it at the front. */
  front?: boolean;
  json?: boolean;
}

export function runNote(id: number, opts: NoteOptions): void {
  using db = new RelayDB();
  const task = Number.isInteger(id) && id > 0 ? db.getTask(id) : null;
  if (!task) {
    console.log(chalk.red(`task #${id} not found`));
    process.exitCode = 1;
    return;
  }

  if (opts.remove !== undefined) {
    const note = db.getNote(opts.remove);
    if (!note || note.task_id !== task.id) {
      console.log(chalk.red(`note ${opts.remove} not found on #${task.id}`));
      process.exitCode = 1;
      return;
    }
    db.deleteNote(note.id);
    recordNotesUndo(db, [], [note]);
    console.log(chalk.green(`✓ deleted note ${note.id} from #${task.id}`) + chalk.gray("  (relay undo to restore)"));
    return;
  }

  const body = normalizeNoteBody(opts.text);
  if (!body) {
    printNotes(task.id, task.title, db.listNotes(task.id), Boolean(opts.json));
    return;
  }

  const note = db.addNote(task.id, body);
  if (!note) {
    console.log(chalk.red(`task #${id} not found`));
    process.exitCode = 1;
    return;
  }
  recordNotesUndo(db, [note], []);
  if (opts.json) {
    console.log(JSON.stringify(note, null, 2));
  } else {
    console.log(chalk.green(`✓ note ${note.id} added to #${task.id}`) + chalk.gray("  — included in the next agent run's prompt"));
  }

  if (opts.queue) {
    if (task.status === "done") {
      console.log(chalk.yellow(`  #${task.id} is done — not queued (relay reopen ${task.id} first)`));
      return;
    }
    const already = db.listQueueItems().some((q) => q.task_id === task.id);
    db.addQueueItem(task.id, { front: Boolean(opts.front) });
    if (!opts.json) {
      console.log(
        already && !opts.front
          ? chalk.gray(`  #${task.id} is already queued`)
          : chalk.cyan(`  ⇢ queued #${task.id}${opts.front ? " (front)" : ""}`) + chalk.gray("  — relay queue run"),
      );
    }
  }
}

export function printNotes(taskId: number, title: string, notes: TaskNote[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(notes, null, 2));
    return;
  }
  console.log(chalk.bold(`#${taskId}`) + `  ${title}`);
  if (notes.length === 0) {
    console.log(chalk.gray(`  no notes — add one: relay note ${taskId} "what to try next"`));
    return;
  }
  for (const line of formatNoteLines(notes)) console.log(line);
}

/** Shared by `relay note` and `relay show`. */
export function formatNoteLines(notes: TaskNote[]): string[] {
  const out: string[] = [];
  for (const n of notes) {
    const when = new Date(n.created_at).toLocaleString();
    const [first, ...rest] = n.body.split("\n");
    out.push(`  ${chalk.gray(`[${n.id}] ${when}`)}  ${first ?? ""}`);
    for (const line of rest) out.push(`      ${line}`);
  }
  return out;
}
