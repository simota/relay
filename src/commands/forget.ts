import chalk from "chalk";
import { RelayDB } from "../db/client.js";

export interface ForgetOptions {
  source: string;
  sessionId: string;
  yes?: boolean;
}

export function runForget(opts: ForgetOptions): void {
  const SESSION_SOURCES = new Set([
    "claude_session_todo",
    "codex_session_todo",
    "antigravity_session_todo",
    "cursor_session_todo",
  ]);
  if (!SESSION_SOURCES.has(opts.source)) {
    console.log(
      chalk.red(`unsupported --source for forget: ${opts.source}`) +
        chalk.gray(`  (supported: ${[...SESSION_SOURCES].join(", ")})`),
    );
    process.exit(1);
  }

  const db = new RelayDB();
  const affected = db.findBySession(opts.source, opts.sessionId);

  if (affected.length === 0) {
    console.log(
      chalk.gray(`no tasks found for session ${opts.sessionId} (source=${opts.source})`),
    );
    db.close();
    return;
  }

  console.log(
    chalk.yellow(`about to forget ${affected.length} task(s) from session ${opts.sessionId}:`),
  );
  const preview = affected.slice(0, 5);
  for (const t of preview) {
    console.log(chalk.gray(`  #${t.id} ${t.repo}  ${t.title.slice(0, 60)}`));
  }
  if (affected.length > preview.length) {
    console.log(chalk.gray(`  … and ${affected.length - preview.length} more`));
  }

  if (!opts.yes) {
    console.log(
      chalk.gray(`\nRe-run with --yes to actually delete. This is destructive and not undoable.`),
    );
    db.close();
    return;
  }

  const deleted = db.forgetBySession(opts.source, opts.sessionId);
  db.close();
  console.log(chalk.green(`✓ forgot ${deleted} task(s) from session ${opts.sessionId}`));
}
