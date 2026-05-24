import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { gitSnapshot } from "../context/git.js";
import { RelayDB, type RelayContext } from "../db/client.js";
import { buildPrompt, runTask } from "../executor/index.js";
import { resolveRepoPath } from "../repo-resolver.js";
import type { SessionType, Task } from "../types.js";
import { clearFocus, getFocus } from "./focus.js";

export interface RunRunOptions {
  noTemplate?: boolean;
  ask?: boolean;
  dryRun?: boolean;
  /** When true, leave the focus state intact after this run completes. */
  keepFocus?: boolean;
  /** When true, build a fresh prompt even if the task has a session_id. */
  noResume?: boolean;
}

/**
 * Clear focus after a `relay run` invocation unless the user asked to keep it.
 * Called in every terminal branch (success, failure, cancel) so the state
 * never leaks across runs. dry-run / ask-cancel are explicitly excluded:
 * those don't actually launch the agent, so the focus is still relevant.
 */
function maybeClearFocusAfterRun(taskId: number, keepFocus: boolean): void {
  if (keepFocus) return;
  if (getFocus() === taskId) clearFocus();
}

export async function runRun(id: number, options: RunRunOptions = {}): Promise<void> {
  const db = new RelayDB();
  const task = db.getTask(id);

  if (!task) {
    console.log(chalk.red(`task #${id} not found`));
    db.close();
    process.exit(1);
  }

  const cfg = loadConfig();
  const repoRoot = resolveRepoPath(task.repo, cfg);
  if (!repoRoot) {
    console.log(chalk.red(`repo '${task.repo}' not found under configured scan.roots`));
    db.close();
    process.exit(1);
  }

  // Look up a context preamble. Skipped when an assignee will resume a
  // previous session (claude/codex with `session_id` and no `--no-resume`),
  // since the agent already has its own conversation history. Antigravity
  // falls through to the preamble path because `agy` can't resume by UUID.
  const willResume =
    Boolean(task.session_id) &&
    !options.noResume &&
    (task.assignee === "claude-code" || task.assignee === "codex");
  let preamble: string | undefined;
  let context: RelayContext | null = null;
  if (agentSupportsContextPreamble(task.assignee) && !willResume) {
    context = task.context_hash
      ? db.getContext(task.context_hash)
      : db.getLatestContextForRepo(task.repo);
    if (context?.summary) {
      preamble = formatPreamble(context.summary, context.branch, context.headSha);
    }
  }

  // Read repo-level prompt template if present and not suppressed.
  let repoTemplate: string | undefined;
  if (!options.noTemplate) {
    const templatePath = path.join(repoRoot, ".agents", "RELAY_PROMPT.md");
    if (existsSync(templatePath)) {
      const body = readFileSync(templatePath, "utf8").trim();
      if (body.length > 0) repoTemplate = body;
    }
  }

  const dryRun = Boolean(options.dryRun);
  const ask = Boolean(options.ask);

  if (dryRun || ask) {
    // When resuming, the preview reflects what actually launches: claude takes
    // no prompt (its conversation history rehydrates), codex takes only
    // task.prompt as a positional appendix (no preamble/template). Otherwise
    // the full preamble + template + prompt sandwich is what the agent sees.
    const finalPrompt = willResume
      ? task.assignee === "codex"
        ? task.prompt
        : null
      : buildPrompt(task.prompt, preamble, repoTemplate);
    printPreview({
      task,
      repoRoot,
      finalPrompt,
      repoTemplateApplied: !willResume && Boolean(repoTemplate),
      noTemplate: Boolean(options.noTemplate),
      context,
      willResume,
    });

    // dry-run wins over ask (lower side-effect surface).
    if (dryRun) {
      db.close();
      process.exit(0);
    }

    const shouldLaunch = await confirmLaunch();
    if (!shouldLaunch) {
      console.log(chalk.yellow("✗ cancelled — agent not launched."));
      db.close();
      process.exit(0);
    }
  }

  console.log(
    chalk.cyan(`▶ #${task.id}`) +
      `  ${task.title}\n` +
      chalk.gray(`   cd ${repoRoot}  (${task.assignee})`) +
      (repoTemplate ? chalk.gray("\n   + .agents/RELAY_PROMPT.md applied") : "") +
      (preamble ? chalk.gray("\n   + context preamble injected") : ""),
  );

  const runId = db.insertRun(task.id, task.assignee);
  db.setStatus(task.id, "in_progress");
  db.close();

  const keepFocus = Boolean(options.keepFocus);
  try {
    const result = await runTask({
      task,
      repoRoot,
      claudeBin: cfg.agents.claude_bin,
      codexBin: cfg.agents.codex_bin,
      antigravityBin: cfg.agents.antigravity_bin,
      contextPreamble: preamble,
      repoTemplate,
      noResume: options.noResume,
    });
    const db2 = new RelayDB();
    db2.finishRun(runId, result.status);
    saveRunContextSnapshot(db2, task, repoRoot, result.status);
    // Status stays 'in_progress' — next `relay sync` reconciles from source state.
    db2.close();
    maybeClearFocusAfterRun(task.id, keepFocus);
    process.exit(result.exitCode ?? 0);
  } catch (e) {
    const db2 = new RelayDB();
    db2.finishRun(runId, "failed", e instanceof Error ? e.message : String(e));
    saveRunContextSnapshot(db2, task, repoRoot, "failed");
    db2.close();
    maybeClearFocusAfterRun(task.id, keepFocus);
    console.log(chalk.red(`✗ ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
}

function agentSupportsContextPreamble(assignee: Task["assignee"]): boolean {
  return assignee === "claude-code" || assignee === "codex" || assignee === "antigravity";
}

function sessionTypeForAssignee(assignee: Task["assignee"]): SessionType | null {
  if (assignee === "claude-code") return "claude";
  if (assignee === "codex") return "codex";
  if (assignee === "antigravity") return "antigravity";
  return null;
}

function saveRunContextSnapshot(
  db: RelayDB,
  task: Task,
  repoRoot: string,
  status: "success" | "failed" | "interrupted",
): void {
  const sessionType = sessionTypeForAssignee(task.assignee);
  // Claude Code already saves richer transcript summaries through its Stop hook.
  if (sessionType !== "codex" && sessionType !== "antigravity") return;
  const snap = gitSnapshot(repoRoot);
  if (!snap) return;
  const summary = `relay run #${task.id}: ${task.title}\nagent: ${task.assignee}\nstatus: ${status}`;
  const hash = createHash("sha256")
    .update(`${task.repo}:${snap.headSha}:${summary}:${Date.now()}`)
    .digest("hex");
  db.insertContext({
    hash,
    repo: task.repo,
    branch: snap.branch,
    headSha: snap.headSha,
    dirtyFiles: snap.dirtyFiles,
    summary,
    sessionId: task.session_id,
    sessionType,
  });
  db.linkContextToActiveTasks(task.repo, hash, task.session_id ?? undefined);
}

function formatPreamble(summary: string, branch: string, headSha: string): string {
  return `(relay context, saved on branch \`${branch}\` at \`${headSha.slice(0, 10)}\`)\n${summary}`;
}

interface PreviewArgs {
  task: Task;
  repoRoot: string;
  finalPrompt: string | null;
  repoTemplateApplied: boolean;
  noTemplate: boolean;
  context: RelayContext | null;
  willResume: boolean;
}

function printPreview(args: PreviewArgs): void {
  const { task, repoRoot, finalPrompt, repoTemplateApplied, noTemplate, context, willResume } = args;
  const divider = chalk.gray("─".repeat(60));

  console.log(divider);
  console.log(chalk.cyan(`▶ preview #${task.id}`) + `  ${task.title}`);
  console.log(divider);
  console.log(`${chalk.bold("cwd    ")} ${repoRoot}`);
  console.log(`${chalk.bold("agent  ")} ${task.assignee}`);

  let templateLabel: string;
  if (noTemplate) {
    templateLabel = chalk.gray("(suppressed via --no-template)");
  } else if (repoTemplateApplied) {
    templateLabel = chalk.green(".agents/RELAY_PROMPT.md applied");
  } else {
    templateLabel = chalk.gray("(no template applied)");
  }
  console.log(`${chalk.bold("template")} ${templateLabel}`);

  console.log(`${chalk.bold("files  ")} ${formatFiles(task.files)}`);
  console.log(`${chalk.bold("context")} ${formatContext(context)}`);

  console.log(divider);
  console.log(chalk.bold("final prompt:"));
  if (finalPrompt === null) {
    if (willResume && task.assignee === "claude-code" && task.session_id) {
      console.log(
        chalk.gray(`(no prompt — agent will be launched with claude --resume ${task.session_id})`),
      );
    } else if (willResume && task.assignee === "codex" && task.session_id) {
      console.log(
        chalk.gray(`(no prompt — agent will be launched with codex resume ${task.session_id})`),
      );
    } else if (task.assignee === "self") {
      console.log(chalk.gray("(no prompt — assignee=self launches $EDITOR)"));
    } else if (task.assignee === "human-review") {
      console.log(chalk.gray("(no prompt — assignee=human-review opens task body URL)"));
    } else {
      console.log(chalk.gray("(no prompt)"));
    }
  } else {
    console.log(finalPrompt);
  }
  console.log(divider);
}

function formatFiles(files: string[]): string {
  if (files.length === 0) return chalk.gray("(none)");
  return files.join(", ");
}

function formatContext(ctx: RelayContext | null): string {
  if (!ctx) return chalk.gray("(none)");
  if (!ctx.summary) {
    return chalk.gray(`(no summary; branch=${ctx.branch} @ ${ctx.headSha.slice(0, 10)})`);
  }
  const trimmed = ctx.summary.trim();
  const oneLine = trimmed.replace(/\s+/g, " ");
  const preview = oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
  return `${preview} ${chalk.gray(`(branch=${ctx.branch} @ ${ctx.headSha.slice(0, 10)})`)}`;
}

async function confirmLaunch(): Promise<boolean> {
  // Hard-fail when stdin is not a TTY so test harnesses / pipes don't hang.
  if (!process.stdin.isTTY) {
    console.log(
      chalk.red(
        "✗ --ask requires an interactive TTY (stdin is not a TTY). Use --dry-run instead.",
      ),
    );
    return false;
  }
  process.stdout.write(chalk.bold("[Enter] to launch / [q] to cancel: "));

  return new Promise<boolean>((resolve) => {
    const stdin = process.stdin;
    const previousRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(previousRaw);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      // First key wins. Map: Enter / Return → launch, q / Q / Ctrl-C / Esc → cancel.
      const key = chunk[0] ?? "";
      if (key === "\r" || key === "\n") {
        process.stdout.write("\n");
        cleanup();
        resolve(true);
        return;
      }
      // q, Q, Ctrl-C (\x03), Esc (\x1b) all cancel.
      if (key === "q" || key === "Q" || key === "\x03" || key === "\x1b") {
        process.stdout.write("\n");
        cleanup();
        resolve(false);
        return;
      }
      // Anything else: ignore and keep waiting.
    };

    stdin.on("data", onData);
  });
}
