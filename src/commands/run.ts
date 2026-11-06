import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import chalk from "chalk";
import { loadConfig, type Config as RelayConfig } from "../config.js";
import { gitSnapshot } from "../context/git.js";
import { RelayDB, type RelayContext } from "../db/client.js";
import { buildPrompt, formatPrerequisites, resolveReviewUrl, runTask } from "../executor/index.js";
import { resolveHeadlessCommand, runTaskHeadless, supportsHeadless } from "../executor/headless.js";
import { captureBaseline, computeChanges, formatChangeSummary, type RunChanges } from "../executor/changes.js";
import { resolveRepoPath } from "../repo-resolver.js";
import { spawnAfterClose } from "../lib/recurrence-close.js";
import type { SessionType, Task } from "../types.js";
import { clearFocus, getFocus } from "./focus.js";

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

export interface RunRunOptions {
  noTemplate?: boolean;
  ask?: boolean;
  dryRun?: boolean;
  /** When true, leave the focus state intact after this run completes. */
  keepFocus?: boolean;
  /** When true, build a fresh prompt even if the task has a session_id. */
  noResume?: boolean;
  /** Run the agent non-interactively (`claude -p` / `codex exec`), logging output. */
  headless?: boolean;
  /** Headless only: wall-clock limit in minutes (overrides agents.headless_timeout_min). */
  timeoutMin?: number;
  /** Close the task when the agent exits successfully. */
  closeOnSuccess?: boolean;
}

/** Everything resolved before a launch: shared by `relay run` and `relay queue run`. */
export interface PreparedRun {
  task: Task;
  repoRoot: string;
  preamble?: string;
  repoTemplate?: string;
  /** "Prerequisite tasks" prompt section (task dependencies, schema v12). */
  prerequisites?: string;
  /** Blockers that are not done yet — `relay run` warns before launching. */
  openBlockers: Array<Pick<Task, "id" | "title" | "status">>;
  context: RelayContext | null;
  willResume: boolean;
}

export type PrepareResult = { ok: true; prepared: PreparedRun } | { ok: false; error: string };

export function prepareRun(
  db: RelayDB,
  task: Task,
  cfg: RelayConfig,
  options: { noTemplate?: boolean; noResume?: boolean } = {},
): PrepareResult {
  const repoRoot = resolveRepoPath(task.repo, cfg);
  if (!repoRoot) {
    return { ok: false, error: `repo '${task.repo}' not found under scan.roots or scan.tracked_repos` };
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
  const blockers = db.dependencyInfo(task.id).blocked_by;
  const prerequisites = willResume ? undefined : formatPrerequisites(blockers, task.repo) || undefined;
  const openBlockers = blockers
    .filter((b) => b.status !== "done")
    .map((b) => ({ id: b.id, title: b.title, status: b.status }));
  return {
    ok: true,
    prepared: { task, repoRoot, preamble, repoTemplate, prerequisites, openBlockers, context, willResume },
  };
}

/**
 * Why a prepared task cannot be launched in the requested mode, or null
 * when it can. Checked before a run row is inserted so a non-launch never
 * shows up as a failed run.
 */
export function launchBlocker(task: Task, headless: boolean): string | null {
  if (headless && !supportsHeadless(task.assignee)) {
    return `assignee '${task.assignee}' has no headless mode (assign claude-code or codex)`;
  }
  if (task.assignee === "human-review" && !resolveReviewUrl(task)) {
    return `#${task.id} has no http(s) URL to open (source_id or body)`;
  }
  return null;
}

export interface ExecuteOptions {
  noResume?: boolean;
  headless?: boolean;
  timeoutMin?: number;
  closeOnSuccess?: boolean;
  /** Headless only: mirror agent output to this terminal (default true). */
  echo?: boolean;
}

export interface ExecuteResult {
  runId: number;
  status: "success" | "failed" | "interrupted";
  exitCode: number;
  summary: string | null;
  logPath: string | null;
  closed: boolean;
  /** What the run changed in the repo; null outside a git work tree. */
  changes?: RunChanges | null;
}

/**
 * Launch a prepared task, record the run and its outcome. Never exits the
 * process: callers decide what a failure means (`relay run` exits with the
 * agent's code, `relay queue run` moves on or stops).
 */
export async function executePrepared(
  prepared: PreparedRun,
  cfg: RelayConfig,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const { task, repoRoot } = prepared;
  const headless = Boolean(options.headless);
  const blocker = launchBlocker(task, headless);
  if (blocker) throw new Error(blocker);

  let runId: number;
  let priorStatus: Task["status"] = task.status;
  {
    using db = new RelayDB();
    priorStatus = db.getTask(task.id)?.status ?? task.status;
    runId = db.insertRun(task.id, task.assignee);
    db.setStatus(task.id, "in_progress");
  }
  // What the repo looked like before the agent touched it (schema v13).
  const baseline = captureBaseline(repoRoot);

  const runOptions = {
    task,
    repoRoot,
    claudeBin: cfg.agents.claude_bin,
    codexBin: cfg.agents.codex_bin,
    antigravityBin: cfg.agents.antigravity_bin,
    contextPreamble: prepared.preamble,
    repoTemplate: prepared.repoTemplate,
    prerequisites: prepared.prerequisites,
    noResume: options.noResume,
  };

  let status: ExecuteResult["status"];
  let exitCode: number;
  let summary: string | null = null;
  let logPath: string | null = null;
  try {
    if (headless) {
      const timeoutMin = options.timeoutMin ?? cfg.agents.headless_timeout_min;
      const result = await runTaskHeadless(
        {
          ...runOptions,
          claudeHeadlessArgs: cfg.agents.claude_headless_args,
          codexHeadlessArgs: cfg.agents.codex_headless_args,
        },
        { runId, timeoutMs: timeoutMin > 0 ? timeoutMin * 60_000 : undefined, echo: options.echo },
      );
      ({ status, exitCode, summary, logPath } = result);
    } else {
      ({ status, exitCode } = await runTask(runOptions));
    }
  } catch (e) {
    status = "failed";
    exitCode = 1;
    summary = e instanceof Error ? e.message : String(e);
  }
  recordRunOutcome(runId, task, repoRoot, status, summary ?? undefined);
  const changes = baseline ? computeChanges(baseline) : null;
  if (changes) {
    using db = new RelayDB();
    db.recordRunChanges(runId, changes);
  }

  let closed = false;
  if (status === "success" && options.closeOnSuccess) {
    using db = new RelayDB();
    const before = db.getTask(task.id);
    if (before && before.status !== "done") {
      db.setStatus(task.id, "done");
      const after = db.getTask(task.id);
      const recur = spawnAfterClose(db, [task.id]);
      if (after) {
        db.recordUndo({
          op_kind: "close",
          payload: { tasks: [statusSnapshot(after)], ...recur.payload },
          inverse: { tasks: [statusSnapshot(before)], ...recur.inverse },
        });
      }
      closed = true;
    }
  }
  if (status !== "success" && priorStatus !== "in_progress") {
    // The agent didn't finish: put the task back where it was so it
    // doesn't sit in 'in_progress' forever (manual tasks never re-sync).
    using db = new RelayDB();
    if (db.getTask(task.id)?.status === "in_progress") db.setStatus(task.id, priorStatus);
  }
  // After a success the status stays 'in_progress' — next `relay sync`
  // reconciles from source state (or --close-on-success closed it above).
  return { runId, status, exitCode, summary, logPath, closed, changes };
}

function statusSnapshot(task: Task) {
  return { id: task.id, status: task.status, due_at: task.due_at, closed_at: task.closed_at };
}

/** The exact prompt the agent receives (null = none / resume without a prompt). */
export function previewPrompt(prepared: PreparedRun, headless: boolean, noResume = false): string | null {
  const { task, willResume, preamble, repoTemplate, prerequisites } = prepared;
  if (headless && supportsHeadless(task.assignee)) {
    const { args } = resolveHeadlessCommand(task, {
      task,
      repoRoot: prepared.repoRoot,
      contextPreamble: preamble,
      repoTemplate,
      prerequisites,
      noResume,
    });
    return args[args.length - 1] ?? null;
  }
  // When resuming, the preview reflects what actually launches: claude takes
  // no prompt (its conversation history rehydrates), codex takes only
  // task.prompt as a positional appendix (no preamble/template). Otherwise
  // the full preamble + template + prompt sandwich is what the agent sees.
  return willResume
    ? task.assignee === "codex"
      ? task.prompt
      : null
    : buildPrompt(task.prompt, preamble, repoTemplate, prerequisites);
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
  const prep = prepareRun(db, task, cfg, options);
  if (!prep.ok) {
    console.log(chalk.red(prep.error));
    db.close();
    process.exit(1);
  }
  const prepared = prep.prepared;
  const { repoRoot, preamble, repoTemplate, context, willResume } = prepared;
  db.close();
  if (prepared.openBlockers.length > 0) {
    // An explicit `relay run` is honoured, but say what it is jumping ahead of.
    console.log(
      chalk.yellow(
        `⚠ #${task.id} is blocked by ${prepared.openBlockers.map((b) => `#${b.id} (${b.status})`).join(", ")}` +
          chalk.gray(" — running anyway; `relay unblock` to drop the dependency"),
      ),
    );
  }

  const dryRun = Boolean(options.dryRun);
  const ask = Boolean(options.ask);
  const headless = Boolean(options.headless);

  if (dryRun || ask) {
    printPreview({
      task,
      repoRoot,
      finalPrompt: previewPrompt(prepared, headless, options.noResume),
      repoTemplateApplied: !willResume && Boolean(repoTemplate),
      noTemplate: Boolean(options.noTemplate),
      context,
      willResume,
      headless,
    });

    // dry-run wins over ask (lower side-effect surface).
    if (dryRun) process.exit(0);

    const shouldLaunch = await confirmLaunch();
    if (!shouldLaunch) {
      console.log(chalk.yellow("✗ cancelled — agent not launched."));
      process.exit(0);
    }
  }

  // Fail before marking the task in_progress: the launcher would throw anyway.
  const blocker = launchBlocker(task, headless);
  if (blocker) {
    console.log(chalk.red(`✗ ${blocker}`));
    process.exit(1);
  }

  console.log(
    chalk.cyan(`▶ #${task.id}`) +
      `  ${task.title}\n` +
      chalk.gray(`   cd ${repoRoot}  (${task.assignee}${headless ? ", headless" : ""})`) +
      (repoTemplate ? chalk.gray("\n   + .agents/RELAY_PROMPT.md applied") : "") +
      (preamble ? chalk.gray("\n   + context preamble injected") : ""),
  );

  const keepFocus = Boolean(options.keepFocus);
  const result = await executePrepared(prepared, cfg, {
    noResume: options.noResume,
    headless,
    timeoutMin: options.timeoutMin,
    closeOnSuccess: options.closeOnSuccess,
  });
  maybeClearFocusAfterRun(task.id, keepFocus);
  if (result.status !== "success" && result.summary && !headless) {
    console.log(chalk.red(`✗ ${result.summary}`));
  }
  if (headless) printHeadlessOutcome(result);
  else if (result.closed) console.log(chalk.green(`✓ #${task.id} closed`));
  process.exit(result.exitCode);
}

export function printHeadlessOutcome(result: ExecuteResult): void {
  const mark =
    result.status === "success" ? chalk.green("✓") : result.status === "interrupted" ? chalk.yellow("■") : chalk.red("✗");
  console.log(
    `\n${mark} run #${result.runId} ${result.status} (exit ${result.exitCode})` +
      (result.closed ? chalk.green(" · task closed") : "") +
      (result.changes ? chalk.cyan(`\n   changed: ${formatChangeSummary(result.changes)}`) : "") +
      (result.logPath ? chalk.gray(`\n   log: ${result.logPath}  (relay runs --log ${result.runId})`) : "") +
      (result.status !== "success" && result.summary ? chalk.red(`\n   ${result.summary.split("\n").pop()}`) : ""),
  );
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

/**
 * Persist a finished run. The run status is written first and is final: the
 * context snapshot is best-effort, so a git/snapshot failure is reported
 * but can no longer re-classify a successful run as failed (the snapshot
 * used to run inside the launch try-block, whose catch re-recorded it).
 */
export function recordRunOutcome(
  runId: number,
  task: Task,
  repoRoot: string,
  status: "success" | "failed" | "interrupted",
  error?: string,
  saveSnapshot: typeof saveRunContextSnapshot = saveRunContextSnapshot,
): void {
  using db = new RelayDB();
  db.finishRun(runId, status, error);
  try {
    saveSnapshot(db, task, repoRoot, status);
  } catch (snapshotError) {
    const message = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
    console.warn(chalk.yellow(`! run #${runId} recorded as ${status}; context snapshot not saved: ${message}`));
  }
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
  headless?: boolean;
}

function printPreview(args: PreviewArgs): void {
  const { task, repoRoot, finalPrompt, repoTemplateApplied, noTemplate, context, willResume, headless } = args;
  const divider = chalk.gray("─".repeat(60));

  console.log(divider);
  console.log(chalk.cyan(`▶ preview #${task.id}`) + `  ${task.title}`);
  console.log(divider);
  console.log(`${chalk.bold("cwd    ")} ${repoRoot}`);
  console.log(`${chalk.bold("agent  ")} ${task.assignee}${headless ? chalk.gray(" (headless)") : ""}`);

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
      console.log(chalk.gray("(no prompt — assignee=human-review opens the task's review URL)"));
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
