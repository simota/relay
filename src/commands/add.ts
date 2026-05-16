import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import { loadConfig } from "../config.js";
import { resolveRepoPath } from "../repo-resolver.js";
import type { Assignee, TaskInput } from "../types.js";

const ASSIGNEES: Assignee[] = ["claude-code", "codex", "gemini", "self", "human-review"];

export interface AddOptions {
  repo?: string;
  title?: string;
  body?: string;
  assignee?: string;
  prompt?: string;
  files?: string;
  due?: string;
  priority?: string | number;
}

export async function runAdd(opts: AddOptions): Promise<void> {
  const cfg = loadConfig();

  let { repo, title } = opts;
  let body = opts.body ?? "";
  let assignee: Assignee = (opts.assignee as Assignee) ?? (cfg.agents.default as Assignee);
  let prompt = opts.prompt ?? null;
  let files: string[] = opts.files
    ? opts.files.split(",").map((f) => f.trim()).filter(Boolean)
    : [];
  let due = opts.due ?? null;
  let priority = opts.priority !== undefined ? Number(opts.priority) : 50;

  const needsPrompt = !repo || !title;
  if (needsPrompt) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      if (!repo) repo = (await rl.question(`${chalk.cyan("repo")}     : `)).trim();
      if (!title) title = (await rl.question(`${chalk.cyan("title")}    : `)).trim();
      if (!body && opts.body === undefined) {
        body = (await rl.question(`${chalk.gray("body")}     : `)).trim();
      }
      if (!opts.assignee) {
        const ans = (await rl.question(
          `${chalk.gray("assignee")} : ${ASSIGNEES.join("|")} [${assignee}] `,
        )).trim();
        if (ans && (ASSIGNEES as string[]).includes(ans)) assignee = ans as Assignee;
      }
      if (!opts.prompt && (assignee === "claude-code" || assignee === "codex" || assignee === "gemini")) {
        const p = (await rl.question(`${chalk.gray("prompt")}   : `)).trim();
        if (p) prompt = p;
      }
      if (!opts.files) {
        const f = (await rl.question(`${chalk.gray("files")}    : (comma-separated, optional) `)).trim();
        if (f) files = f.split(",").map((x) => x.trim()).filter(Boolean);
      }
    } finally {
      rl.close();
    }
  }

  if (!repo || !title) {
    console.log(chalk.red("repo and title are required"));
    process.exit(1);
  }

  if (!(ASSIGNEES as string[]).includes(assignee)) {
    console.log(chalk.red(`invalid assignee: ${assignee}. Use one of ${ASSIGNEES.join(", ")}`));
    process.exit(1);
  }

  const repoPath = resolveRepoPath(repo, cfg);
  if (!repoPath) {
    console.log(chalk.yellow(`! warning: '${repo}' not found under configured scan.roots`));
  }

  const task: TaskInput = {
    source_type: "manual",
    source_id: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    repo,
    title,
    body,
    status: "open",
    assignee,
    priority,
    prompt,
    files,
    context_hash: null,
    session_id: null,
    due_at: normalizeDue(due),
    wait_on: "self",
  };

  const db = new RelayDB();
  const before = db.viewCounts().open;
  db.upsertTasks([task]);
  const after = db.viewCounts().open;
  db.close();

  const isNew = after > before;
  console.log(
    isNew ? chalk.green("✓ added") : chalk.gray("- already exists (no change)"),
  );
  console.log(chalk.gray(`  repo:     ${repo}`));
  console.log(chalk.gray(`  title:    ${title}`));
  console.log(chalk.gray(`  assignee: ${assignee}`));
  if (prompt) console.log(chalk.gray(`  prompt:   ${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}`));
  if (files.length) console.log(chalk.gray(`  files:    ${files.join(", ")}`));
  if (task.due_at) console.log(chalk.gray(`  due:      ${task.due_at}`));
}

function normalizeDue(due: string | null | undefined): string | null {
  if (!due) return null;
  // Accept "YYYY-MM-DD" or ISO datetime; pass through if parsable.
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
