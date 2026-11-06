import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import { loadConfig } from "../config.js";
import { parseWhenInput, WHEN_INPUT_HINT } from "../lib/due-date.js";
import { WaitOn } from "../types.js";
import { resolveRepoPath } from "../repo-resolver.js";
import type { Assignee, TaskInput } from "../types.js";
import { normalizeTags } from "../lib/tags.js";
import { describeRecurrence, normalizeRecurrence, RECURRENCE_HINT } from "../lib/recurrence.js";

const ASSIGNEES: Assignee[] = ["claude-code", "codex", "antigravity", "self", "human-review"];

export interface AddOptions {
  repo?: string;
  title?: string;
  body?: string;
  assignee?: string;
  prompt?: string;
  files?: string;
  due?: string;
  waitOn?: string;
  priority?: string | number;
  /** Comma-separated tags (schema v12). */
  tags?: string;
  /** Comma-separated task ids this new task waits on. */
  blockedBy?: string;
  /** Repeat rule (schema v13), e.g. weekly / weekdays / 3d / mon,thu. */
  every?: string;
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
      if (!opts.prompt && (assignee === "claude-code" || assignee === "codex" || assignee === "antigravity")) {
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

  const dueAt = normalizeDue(due);
  if (due && !dueAt) {
    console.log(chalk.red(`invalid --due: ${due}`) + chalk.gray(`  (use ${WHEN_INPUT_HINT})`));
    process.exit(1);
  }
  const waitOn = WaitOn.safeParse(opts.waitOn ?? "self");
  if (!waitOn.success) {
    console.log(chalk.red(`invalid --wait-on: ${opts.waitOn}. Use one of ${WaitOn.options.join(", ")}`));
    process.exit(1);
  }

  const tagInput = (opts.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const { tags, invalid: invalidTags } = normalizeTags(tagInput);
  if (invalidTags.length > 0) {
    console.log(chalk.red(`invalid --tags: ${invalidTags.join(", ")}`));
    process.exit(1);
  }
  const blockedBy = (opts.blockedBy ?? "")
    .split(",")
    .map((v) => v.trim().replace(/^#/, ""))
    .filter(Boolean)
    .map(Number);
  if (blockedBy.some((id) => !Number.isInteger(id) || id <= 0)) {
    console.log(chalk.red(`invalid --blocked-by: ${opts.blockedBy} (comma-separated task ids)`));
    process.exit(1);
  }

  let recurrence: string | null = null;
  if (opts.every !== undefined) {
    const rule = normalizeRecurrence(opts.every);
    if (rule === undefined) {
      console.log(chalk.red(`invalid --every: ${opts.every}`) + chalk.gray(`  (use ${RECURRENCE_HINT})`));
      process.exit(1);
    }
    recurrence = rule;
  }

  const repoPath = resolveRepoPath(repo, cfg);
  if (!repoPath) {
    console.log(chalk.yellow(`! warning: '${repo}' not found under scan.roots or scan.tracked_repos`));
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
    due_at: dueAt,
    wait_on: waitOn.data,
  };

  const db = new RelayDB();
  const missingBlocker = blockedBy.find((id) => !db.getTask(id));
  if (missingBlocker !== undefined) {
    db.close();
    console.log(chalk.red(`--blocked-by: task #${missingBlocker} not found`));
    process.exit(1);
  }
  const before = db.viewCounts().open;
  db.upsertTasks([task]);
  const after = db.viewCounts().open;
  const created = db.getTaskBySourceId("manual", task.source_id);
  if (created) {
    if (tags.length > 0) db.setTags(created.id, tags);
    if (recurrence) db.editTask(created.id, { recurrence }, { lock: false });
    // A brand-new task has no dependents, so these edges cannot form a cycle.
    for (const blocker of new Set(blockedBy)) db.addDependency(created.id, blocker);
  }
  db.close();

  const isNew = after > before;
  console.log(
    isNew
      ? chalk.green(`✓ added${created ? ` #${created.id}` : ""}`)
      : chalk.gray("- already exists (no change)"),
  );
  console.log(chalk.gray(`  repo:     ${repo}`));
  console.log(chalk.gray(`  title:    ${title}`));
  console.log(chalk.gray(`  assignee: ${assignee}`));
  if (prompt) console.log(chalk.gray(`  prompt:   ${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}`));
  if (files.length) console.log(chalk.gray(`  files:    ${files.join(", ")}`));
  if (task.due_at) console.log(chalk.gray(`  due:      ${task.due_at}`));
  if (tags.length) console.log(chalk.gray(`  tags:     ${tags.map((t) => `#${t}`).join(" ")}`));
  if (recurrence) console.log(chalk.gray(`  repeats:  ${describeRecurrence(recurrence)} (closing it schedules the next one)`));
  if (blockedBy.length) console.log(chalk.gray(`  blocked:  by ${[...new Set(blockedBy)].map((id) => `#${id}`).join(" ")}`));
}

function normalizeDue(due: string | null | undefined): string | null {
  if (!due) return null;
  // Accept "YYYY-MM-DD" (local midnight), an ISO datetime, or a shorthand
  // such as "tomorrow" / "+3d" / "fri".
  return parseWhenInput(due);
}
