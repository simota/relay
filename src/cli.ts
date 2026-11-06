#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import type { ImportKind } from "./commands/import.js";
import { DOCTOR_STRICT_FLAG } from "./commands/doctor-flags.js";

const program = new Command();

function parseIds(raw: string[]): number[] {
  const ids = raw.flatMap((value) => value.split(",")).filter(Boolean).map((value) => Number(value.replace(/^#/, "")));
  const bad = ids.find((id) => !Number.isInteger(id) || id <= 0);
  if (bad !== undefined || ids.length === 0) {
    console.error(chalk.red(`invalid task id(s): ${raw.join(" ")}`));
    process.exit(1);
  }
  return ids;
}

function parseTimeout(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    console.error(chalk.red(`invalid --timeout: ${String(raw)} (minutes, 0 = none)`));
    process.exit(1);
  }
  return value;
}

program
  .name("relay")
  .description("AI-era cross-project task hub: tasks as executable agent jobs.")
  .version("0.0.1");

program
  .command("init")
  .option("--force", "overwrite existing config")
  .description("Create ~/.relay/, write default config, apply schema.")
  .action(async (opts) => {
    const { runInit } = await import("./commands/init.js");
    runInit({ force: Boolean(opts.force) });
  });

program
  .command("setup")
  .option("--skip-install", "skip `bun install` (only run the Next.js build)")
  .option("--skip-build", "skip the Next.js build (only install deps)")
  .option("--force", "ignore existing node_modules / out and reinstall + rebuild")
  .description(
    "Install root + web/nextjs deps and build the Web UI static export in one shot.",
  )
  .action(async (opts) => {
    const { runSetup } = await import("./commands/setup.js");
    await runSetup({
      skipInstall: Boolean(opts.skipInstall),
      skipBuild: Boolean(opts.skipBuild),
      force: Boolean(opts.force),
    });
  });

program.command("quickstart")
  .option("--no-sync", "skip initial sync")
  .description("Initialize relay if needed, sync tasks, and show today's top items.")
  .action(async (opts) => {
    const { runQuickstart } = await import("./commands/quickstart.js");
    await runQuickstart({ noSync: opts.sync === false });
  });

program
  .command("sync")
  .option("--source <name>", "limit to a single adapter")
  .option("--only <name>", "alias for --source")
  .option("--dry-run", "preview adapters and source files without writing to DB")
  .option("--resume", "skip adapters that already finished ok within the last hour")
  .description("Ingest tasks from all configured sources.")
  .action(async (opts) => {
    const { runSync } = await import("./commands/sync.js");
    const sigintHandler = () => {
      console.log(chalk.yellow("\n⏹ interrupted — completed adapters are saved. Re-run with `relay sync --resume` to skip them."));
      process.exit(130);
    };
    process.once("SIGINT", sigintHandler);
    try {
      await runSync({
        source: opts.source ?? opts.only,
        dryRun: Boolean(opts.dryRun),
        resume: Boolean(opts.resume),
      });
    } catch (e) {
      console.log(chalk.red(`sync failed: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(1);
    } finally {
      process.off("SIGINT", sigintHandler);
    }
  });

program
  .command("today")
  .option("-n, --limit <n>", "max items")
  .description("Show today's top items across all repos.")
  .action(async (opts) => {
    const { runToday } = await import("./commands/list.js");
    runToday({ limit: opts.limit ? Number(opts.limit) : undefined });
  });

program
  .command("standup")
  .option("--since <window>", "lookback window: 24h | 48h | 7d | 14d | 30d", "24h")
  .description("Show yesterday's closed work, today's self-driven tasks, and current blockers.")
  .action(async (opts) => {
    const { runStandup } = await import("./commands/standup.js");
    runStandup({ since: typeof opts.since === "string" ? opts.since : undefined });
  });

program
  .command("agenda")
  .option("--days <n>", "horizon: 7 | 14 | 30", "7")
  .description(
    "Show a calendar of upcoming due_at + scheduled tasks, plus an Overdue section.",
  )
  .action(async (opts) => {
    const { runAgenda } = await import("./commands/agenda.js");
    const parsed = typeof opts.days === "string" ? Number(opts.days) : undefined;
    await runAgenda({
      days: Number.isFinite(parsed) ? parsed : undefined,
    });
  });

program
  .command("digest")
  .option(
    "--since <window>",
    "lookback window: 24h | 48h | 7d | 14d | 30d | 90d",
    "7d",
  )
  .option("--out <path>", "write report to file instead of stdout (overwrites)")
  .option("--format <fmt>", "md (default) | json", "md")
  .description(
    "Summarize closed tasks, agent runs, and context highlights for the window as Markdown or JSON.",
  )
  .action(async (opts) => {
    const { runDigest } = await import("./commands/digest.js");
    runDigest({
      since: typeof opts.since === "string" ? opts.since : undefined,
      out: typeof opts.out === "string" ? opts.out : undefined,
      format: typeof opts.format === "string" ? (opts.format as "md" | "json") : undefined,
    });
  });

program
  .command("ls")
  .option("--repo <name>")
  .option("--source <name>")
  .option("--status <name>")
  .option("--agent <name>")
  .option("-q, --grep <text>", "search title / body / prompt / repo / source id (all statuses unless --status)")
  .option("-n, --limit <n>")
  .description("List tasks with filters.")
  .action(async (opts) => {
    const { runList } = await import("./commands/list.js");
    runList({
      q: opts.grep,
      repo: opts.repo,
      source: opts.source,
      status: opts.status,
      agent: opts.agent,
      limit: opts.limit ? Number(opts.limit) : undefined,
    });
  });

program
  .command("show <id>")
  .description("Show task detail.")
  .action(async (id) => {
    const { runShow } = await import("./commands/list.js");
    runShow(Number(id));
  });

program
  .command("run <id>")
  .description("Launch the assigned agent in the task's repo.")
  .option("--no-template", "skip <repo>/.agents/RELAY_PROMPT.md even if present")
  .option("--ask", "preview prompt and confirm before launching")
  .option("--dry-run", "preview prompt without launching")
  .option("--keep-focus", "do not clear focus state after this run completes")
  .option("--no-resume", "build a fresh prompt instead of resuming the prior session")
  .option("--headless", "run unattended (claude -p / codex exec); output is logged under ~/.relay/runs/")
  .option("--timeout <min>", "headless: kill the agent after N minutes (default agents.headless_timeout_min)")
  .option("--close-on-success", "close the task when the agent exits 0")
  .action(async (id, opts) => {
    const { runRun } = await import("./commands/run.js");
    await runRun(Number(id), {
      noTemplate: opts.template === false,
      ask: Boolean(opts.ask),
      dryRun: Boolean(opts.dryRun),
      keepFocus: Boolean(opts.keepFocus),
      noResume: opts.resume === false,
      headless: Boolean(opts.headless),
      timeoutMin: parseTimeout(opts.timeout),
      closeOnSuccess: Boolean(opts.closeOnSuccess),
    });
  });

const queue = program
  .command("queue")
  .description("AI job queue: line up tasks and run them in order (shared with the Web UI tray).")
  .action(async () => {
    const { runQueueList } = await import("./commands/queue.js");
    runQueueList();
  });
queue
  .command("ls")
  .description("List queued tasks in run order.")
  .action(async () => {
    const { runQueueList } = await import("./commands/queue.js");
    runQueueList();
  });
queue
  .command("add <ids...>")
  .option("--front", "put the tasks at the head of the queue")
  .option("--assign <agent>", "also assign them (claude-code | codex | antigravity | self | human-review)")
  .description("Queue tasks by id (re-adding a queued task does not duplicate it).")
  .action(async (ids: string[], opts) => {
    const { runQueueAdd } = await import("./commands/queue.js");
    runQueueAdd(parseIds(ids), { front: Boolean(opts.front), assign: opts.assign });
  });
queue
  .command("rm <ids...>")
  .description("Remove tasks (by task id) from the queue.")
  .action(async (ids: string[]) => {
    const { runQueueRemove } = await import("./commands/queue.js");
    runQueueRemove(parseIds(ids));
  });
queue
  .command("clear")
  .description("Empty the queue.")
  .action(async () => {
    const { runQueueClear } = await import("./commands/queue.js");
    runQueueClear();
  });
queue
  .command("run")
  .option("--headless", "run each task unattended (claude -p / codex exec) and log its output")
  .option("--dry-run", "show what would launch, in order, without launching")
  .option("-n, --limit <n>", "launch at most N tasks")
  .option("--continue-on-error", "keep going after a failed run (default: stop)")
  .option("--keep", "leave tasks in the queue after a successful run")
  .option("--close-on-success", "close each task whose agent exits 0")
  .option("--timeout <min>", "headless: per-task limit in minutes (default agents.headless_timeout_min)")
  .option("--no-template", "skip <repo>/.agents/RELAY_PROMPT.md")
  .option("--no-resume", "build fresh prompts instead of resuming prior sessions")
  .description("Run queued tasks in order; successful ones leave the queue.")
  .action(async (opts) => {
    const { runQueueRun } = await import("./commands/queue.js");
    await runQueueRun({
      headless: Boolean(opts.headless),
      dryRun: Boolean(opts.dryRun),
      limit: opts.limit ? Number(opts.limit) : undefined,
      continueOnError: Boolean(opts.continueOnError),
      keep: Boolean(opts.keep),
      closeOnSuccess: Boolean(opts.closeOnSuccess),
      timeoutMin: parseTimeout(opts.timeout),
      noTemplate: opts.template === false,
      noResume: opts.resume === false,
    });
  });

program
  .command("runs")
  .option("--task <id>", "only runs of this task")
  .option("--status <s>", "running | success | failed | interrupted")
  .option("--agent <name>")
  .option("-n, --limit <n>", "rows (default 20)")
  .option("--log <runId>", "print the captured output of a headless run")
  .option("--json", "machine-readable output")
  .description("Agent run history across tasks; --log shows a headless run's output.")
  .action(async (opts) => {
    const { runRuns } = await import("./commands/runs.js");
    runRuns({
      task: opts.task ? parseIds([opts.task])[0] : undefined,
      status: opts.status,
      agent: opts.agent,
      limit: opts.limit ? Number(opts.limit) : undefined,
      log: opts.log ? parseIds([opts.log])[0] : undefined,
      json: Boolean(opts.json),
    });
  });

program
  .command("focus [id]")
  .option("--clear", "clear the current focus")
  .description("Focus a single task across CLI/Web. `relay focus` shows current; `--clear` removes it.")
  .action(async (id, opts) => {
    const { runFocus } = await import("./commands/focus.js");
    const parsed = id === undefined ? undefined : Number(id);
    if (parsed !== undefined && !Number.isFinite(parsed)) {
      console.error(chalk.red(`invalid task id: ${id}`));
      process.exit(1);
    }
    runFocus({ id: parsed, clear: Boolean(opts.clear) });
  });

program
  .command("web")
  .option("-p, --port <n>", "port", "7340")
  .option("--host <addr>", "bind address", "127.0.0.1")
  .option("--no-open", "do not open browser")
  .description("Start the local Web UI server.")
  .action(async (opts) => {
    // Loaded on demand: the Hono server and every /api module are the
    // heaviest part of the import graph and only `relay web` needs them,
    // so every other subcommand starts faster without them.
    const { runWeb } = await import("./commands/web.js");
    await runWeb({
      port: opts.port ? Number(opts.port) : undefined,
      host: opts.host,
      noOpen: opts.open === false,
    });
  });

program
  .command("add")
  .option("--repo <name>")
  .option("--title <text>")
  .option("--body <text>")
  .option("--assignee <name>", "claude-code | codex | antigravity | self | human-review")
  .option("--prompt <text>")
  .option("--files <list>", "comma-separated paths")
  .option("--due <date>", "YYYY-MM-DD, ISO datetime, tomorrow, next-week, mon..sun, +3d")
  .option("--wait-on <who>", "self | reviewer | external | scheduled")
  .option("--priority <n>", "0-100", "50")
  .description("Add a manual task (interactive when flags are missing).")
  .action(async (opts) => {
    const { runAdd } = await import("./commands/add.js");
    await runAdd(opts);
  });

program
  .command("close <id>")
  .description("Mark a task as done.")
  .action(async (id) => {
    const { runClose } = await import("./commands/mutate.js");
    runClose(Number(id));
  });

program
  .command("snooze <id>")
  .option("--until <when>", "wake date: YYYY-MM-DD, tomorrow, next-week, mon..sun, +3d, +4h")
  .description("Snooze a task (indefinitely, or until a date — it reopens on its own).")
  .action(async (id, opts) => {
    const { runSnoozeUntil } = await import("./commands/edit.js");
    runSnoozeUntil(Number(id), opts.until);
  });

program
  .command("edit <id>")
  .option("--title <text>")
  .option("--body <text>")
  .option("--priority <n>", "0-100")
  .option("--prompt <text>", "prompt handed to the agent by `relay run`")
  .option("--clear-prompt", "remove the prompt")
  .option("--files <list>", "comma-separated paths (replaces the list; empty string clears)")
  .option("--due <when>", "YYYY-MM-DD, ISO datetime, tomorrow, next-week, mon..sun, +3d")
  .option("--clear-due", "remove the due date")
  .option("--wait-on <who>", "self | reviewer | external | scheduled")
  .option("--repo <name>", "move a manual task to another repo")
  .option("--reset <fields>", "comma-separated fields to hand back to the adapter on next sync")
  .description("Edit a task. Edited fields survive `relay sync`; undo with `relay undo`.")
  .action(async (id, opts) => {
    const { runEdit } = await import("./commands/edit.js");
    runEdit(Number(id), opts);
  });

program
  .command("undo")
  .option("--redo", "re-apply the most recently undone change")
  .option("--list", "show the recent undo log")
  .option("-n, --limit <n>", "rows for --list", "10")
  .description("Undo the last task change (close / snooze / reopen / assign / edit / bulk / prune).")
  .action(async (opts) => {
    const { runUndo } = await import("./commands/edit.js");
    await runUndo({ redo: Boolean(opts.redo), list: Boolean(opts.list), limit: Number(opts.limit) || 10 });
  });

program
  .command("reopen <id>")
  .description("Re-open a snoozed or closed task.")
  .action(async (id) => {
    const { runReopen } = await import("./commands/mutate.js");
    runReopen(Number(id));
  });

program
  .command("assign <id> <agent>")
  .description("Reassign a task. agent: claude-code | codex | antigravity | self | human-review")
  .action(async (id, agent) => {
    const { runAssign } = await import("./commands/mutate.js");
    runAssign(Number(id), agent);
  });

program
  .command("forget <sessionId>")
  .option("--source <name>", "source type to forget", "claude_session_todo")
  .option("--yes", "skip confirmation prompt (destructive)")
  .description("Forget (delete) tasks ingested from a specific Claude session.")
  .action(async (sessionId, opts) => {
    const { runForget } = await import("./commands/forget.js");
    runForget({ source: opts.source, sessionId, yes: Boolean(opts.yes) });
  });

program
  .command("import")
  .requiredOption(
    "--from <kind>",
    "source format: linear | things | notion | generic | relay",
  )
  .requiredOption("--file <path>", "path to export file (.json or .csv)")
  .option("--repo <name>", "fallback repo when row doesn't carry one", "imported")
  .option("--dry-run", "preview rows without writing to DB")
  .option(
    "--read-only",
    "for --from relay: mark this machine as a read-only mirror (informational)",
  )
  .description("Bulk-import tasks from external tools or another relay machine.")
  .action(async (opts) => {
    const { runImport } = await import("./commands/import.js");
    runImport({
      from: opts.from as ImportKind,
      file: opts.file,
      repo: opts.repo,
      dryRun: Boolean(opts.dryRun),
      readOnly: Boolean(opts.readOnly),
    });
  });

program
  .command("export")
  .requiredOption("--file <path>", "destination .json path")
  .description("Export all tasks as a relay-snapshot file (for cross-machine sync).")
  .action(async (opts) => {
    const { runExport } = await import("./commands/export.js");
    runExport({ file: opts.file });
  });

program
  .command("prune")
  .option("--missing-repos", "close tasks whose repo directory no longer exists")
  .option("--source <type>", "limit to one source_type (default: fs-bound only)")
  .option("--all-sources", "include github_issue / github_pr / manual too")
  .option("--include-done", "also delete done tasks whose repo is gone (physical delete)")
  .option("--yes", "skip confirmation prompt")
  .description("Tidy up tasks pointing at gone repos. Closes are undoable in `relay web` (⌘Z).")
  .action(async (opts) => {
    const { runPrune } = await import("./commands/prune.js");
    runPrune({
      missingRepos: Boolean(opts.missingRepos),
      source: opts.source,
      allSources: Boolean(opts.allSources),
      includeDone: Boolean(opts.includeDone),
      yes: Boolean(opts.yes),
    });
  });

const context = program.command("context").description("Manage repo context snapshots.");
context
  .command("save")
  .option("--auto", "read hook payload from stdin (called from Claude Code Stop hook)")
  .option("--repo <name>", "override repo (default: infer from cwd)")
  .option("--summary <text>", "manual summary")
  .option("--session-type <type>", "session family: claude | codex | antigravity | cursor")
  .description("Save a context snapshot from the current repo.")
  .action(async (opts) => {
    const { runContextSave } = await import("./commands/context.js");
    await runContextSave({
      auto: Boolean(opts.auto),
      repo: opts.repo,
      summary: opts.summary,
      sessionType: opts.sessionType,
    });
  });
context
  .command("list")
  .option("--repo <name>")
  .description("List saved contexts.")
  .action(async (opts) => {
    const { runContextList } = await import("./commands/context.js");
    runContextList({ repo: opts.repo });
  });
context
  .command("show <hash>")
  .description("Show a context snapshot.")
  .action(async (hash) => {
    const { runContextShow } = await import("./commands/context.js");
    runContextShow(hash);
  });
context
  .command("summarize <hash>")
  .option("--llm", "shell out to agents.claude_bin for an AI-generated cue")
  .description("Generate a one-line memory cue for a saved context.")
  .action(async (hash, opts) => {
    const { runContextSummarize } = await import("./commands/context.js");
    runContextSummarize(hash, { llm: Boolean(opts.llm) });
  });
context
  .command("edit <hash>")
  .requiredOption("--summary <text>", "new one-line summary")
  .description("Manually overwrite the summary for a context.")
  .action(async (hash, opts) => {
    const { runContextEdit } = await import("./commands/context.js");
    runContextEdit(hash, opts.summary);
  });

const hook = program.command("hook").description("Manage the Claude Code Stop hook.");
hook
  .command("install")
  .description("Add `relay context save --auto` to ~/.claude/settings.json hooks.Stop.")
  .action(async () => {
    const { runHookInstall } = await import("./commands/hook.js");
    runHookInstall();
  });
hook
  .command("uninstall")
  .description("Remove the relay hook from ~/.claude/settings.json.")
  .action(async () => {
    const { runHookUninstall } = await import("./commands/hook.js");
    runHookUninstall();
  });
hook
  .command("status")
  .description("Show whether the Stop hook is installed.")
  .action(async () => {
    const { runHookStatus } = await import("./commands/hook.js");
    runHookStatus();
  });

program
  .command("backfill")
  .option("--dry-run", "preview without writing")
  .option("--only <name>", "run only the named backfill")
  .option("--list", "list available backfills")
  .description("Run idempotent data fixups (e.g. legacy context.session_id from tasks).")
  .action(async (opts) => {
    const { runBackfill } = await import("./commands/backfill.js");
    runBackfill({
      dryRun: Boolean(opts.dryRun),
      only: opts.only,
      list: Boolean(opts.list),
    });
  });

program
  .command("maintain")
  .description("Reclaim DB file size (VACUUM). Run after large prune operations.")
  .action(async () => {
    const { runMaintain } = await import("./commands/maintain.js");
    runMaintain();
  });

program
  .command("doctor")
  .option(DOCTOR_STRICT_FLAG, "exit non-zero if any check fails")
  .description("Check environment (rg, gh, claude, git).")
  .action(async (opts) => {
    const { runDoctor } = await import("./commands/doctor.js");
    runDoctor({ strict: Boolean(opts.strict) });
  });

program
  .command("watch <repo>")
  .option(
    "--interval <duration>",
    "poll interval (5s, 10s, 30s, 1m). Default 5s.",
    "5s",
  )
  .description("Tail new / updated / closed tasks for one repo in realtime.")
  .action(async (repo, opts) => {
    const { parseInterval, runWatch } = await import("./commands/watch.js");
    const parsed = parseInterval(
      typeof opts.interval === "string" ? opts.interval : undefined,
    );
    if (parsed.warning) {
      console.log(chalk.yellow(`! ${parsed.warning}`));
    }
    try {
      await runWatch({ repo, intervalMs: parsed.ms });
    } catch (e) {
      console.log(chalk.red(`watch failed: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
