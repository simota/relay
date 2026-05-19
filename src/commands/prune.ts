import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";

export interface PruneOptions {
  missingRepos: boolean;
  source?: string;
  allSources?: boolean;
  yes?: boolean;
  includeDone?: boolean;
}

/** Per-repo task count summary (open or done). */
export interface PerRepoCount {
  repo: string;
  count: number;
}

/** Result returned by pruneMissingRepos() — no console I/O, pure data. */
export interface PruneResult {
  missingRepos: string[];
  openTasks: Array<{ id: number; repo: string; title: string }>;
  doneTasks: Array<{ id: number; repo: string; title: string }>;
  closedCount: number;
  deletedCount: number;
  perRepoOpen: PerRepoCount[];
  perRepoDone: PerRepoCount[];
}

const ALL_SOURCES = [
  "code_todo",
  "github_issue",
  "github_pr",
  "claude_session_todo",
  "codex_session_todo",
  "gemini_session_todo",
  "cursor_session_todo",
  "agents_note",
  "manual",
] as const;

/**
 * Pure-function prune: inspects missing repos and optionally executes
 * close + delete. No console output, no process.exit — returns structured data.
 * Called by the Web SSE endpoint (auto-prune after sync) and by runPrune (CLI).
 */
export function pruneMissingRepos(opts: {
  includeDone: boolean;
  sourceFilter?: string[];
  execute: boolean;
  db?: RelayDB;
}): PruneResult {
  const cfg = loadConfig();
  const roots = resolveScanRoots(cfg);
  const db = opts.db ?? new RelayDB();
  const owned = opts.db === undefined; // we created it, we close it

  try {
    const repos = db.repoStats().map((r) => r.name);
    const missingRepos = repos.filter(
      (name) => !roots.some((root) => existsSync(join(root, name))),
    );

    if (missingRepos.length === 0) {
      return {
        missingRepos: [],
        openTasks: [],
        doneTasks: [],
        closedCount: 0,
        deletedCount: 0,
        perRepoOpen: [],
        perRepoDone: [],
      };
    }

    const sourceFilter = opts.sourceFilter; // undefined → fs-bound default in DB helper
    const openTasks = db.findOpenTasksInRepos(missingRepos, sourceFilter);
    const doneTasks = opts.includeDone
      ? db.findDoneTasksInRepos(missingRepos, sourceFilter)
      : [];

    // Build per-repo summaries
    const openMap = new Map<string, number>();
    for (const t of openTasks) openMap.set(t.repo, (openMap.get(t.repo) ?? 0) + 1);
    const perRepoOpen: PerRepoCount[] = [...openMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([repo, count]) => ({ repo, count }));

    const doneMap = new Map<string, number>();
    for (const t of doneTasks) doneMap.set(t.repo, (doneMap.get(t.repo) ?? 0) + 1);
    const perRepoDone: PerRepoCount[] = [...doneMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([repo, count]) => ({ repo, count }));

    if (!opts.execute) {
      return {
        missingRepos,
        openTasks: openTasks.map((t) => ({ id: t.id, repo: t.repo, title: t.title })),
        doneTasks: doneTasks.map((t) => ({ id: t.id, repo: t.repo, title: t.title })),
        closedCount: 0,
        deletedCount: 0,
        perRepoOpen,
        perRepoDone,
      };
    }

    // --- execute: close open/snoozed ---
    let closedCount = 0;
    if (openTasks.length > 0) {
      const ids = openTasks.map((t) => t.id);
      const inverses = db.batchCloseTasks(ids);
      db.recordUndo({
        op_kind: "prune_missing_repos",
        payload: { tasks: ids },
        inverse: { tasks: inverses },
      });
      closedCount = inverses.length;
    }

    // --- execute: physical delete done ---
    // We deliberately do NOT persist full row snapshots in `inverse` — at
    // production scale the snapshots dwarfed the rest of the DB (one 56 MB row
    // is real). Physical deletion of `done` tasks is treated as unrecoverable
    // from undo's perspective; the IDs are still recorded so redo can re-run
    // and operators can correlate with logs.
    let deletedCount = 0;
    if (doneTasks.length > 0) {
      const doneIds = doneTasks.map((t) => t.id);
      const snapshots = db.batchDeleteTasks(doneIds);
      db.recordUndo({
        op_kind: "prune_delete_done",
        payload: { ids: doneIds },
        inverse: { ids: doneIds, unrecoverable: true },
      });
      deletedCount = snapshots.length;
    }

    return {
      missingRepos,
      openTasks: openTasks.map((t) => ({ id: t.id, repo: t.repo, title: t.title })),
      doneTasks: doneTasks.map((t) => ({ id: t.id, repo: t.repo, title: t.title })),
      closedCount,
      deletedCount,
      perRepoOpen,
      perRepoDone,
    };
  } finally {
    if (owned) db.close();
  }
}

export function runPrune(opts: PruneOptions): void {
  if (!opts.missingRepos) {
    console.log(
      chalk.red("nothing to prune") +
        chalk.gray("  (currently only --missing-repos is supported)"),
    );
    process.exit(1);
  }

  const sourceFilter = opts.allSources
    ? [...ALL_SOURCES]
    : opts.source
      ? [opts.source]
      : undefined; // undefined → fs-bound default

  // Dry-run first to gather candidate lists for display
  const preview = pruneMissingRepos({
    includeDone: opts.includeDone ?? false,
    sourceFilter,
    execute: false,
  });

  if (preview.missingRepos.length === 0) {
    console.log(chalk.gray("no missing repos."));
    return;
  }

  if (preview.openTasks.length === 0 && preview.doneTasks.length === 0) {
    console.log(
      chalk.gray(
        `${preview.missingRepos.length} missing repo(s) found, but no matching tasks${opts.allSources ? "" : " (fs-bound)"}.`,
      ),
    );
    return;
  }

  // --- dry-run display ---
  if (preview.openTasks.length > 0) {
    console.log(
      chalk.yellow(
        `about to close ${preview.openTasks.length} open task(s) across ${preview.missingRepos.length} missing repo(s):`,
      ),
    );
    for (const { repo, count } of preview.perRepoOpen) {
      console.log(chalk.gray(`  · ${repo.padEnd(30)}  ${count} task(s)`));
    }
  }

  if (preview.doneTasks.length > 0) {
    console.log(
      chalk.yellow(
        `about to delete (physical) ${preview.doneTasks.length} done task(s) across ${preview.missingRepos.length} missing repo(s):`,
      ),
    );
    for (const { repo, count } of preview.perRepoDone) {
      console.log(chalk.gray(`  · ${repo.padEnd(30)}  ${count} done task(s)`));
    }
  }

  if (!opts.yes) {
    console.log(
      chalk.gray(
        `\nRe-run with --yes to actually execute. Reversible via \`relay undo\`.`,
      ),
    );
    return;
  }

  // --- execute ---
  const result = pruneMissingRepos({
    includeDone: opts.includeDone ?? false,
    sourceFilter,
    execute: true,
  });

  const parts: string[] = [];
  if (result.closedCount > 0) parts.push(`closed ${result.closedCount} open task(s)`);
  if (result.deletedCount > 0) parts.push(`deleted ${result.deletedCount} done task(s)`);
  console.log(chalk.green(`✓ ${parts.join(" + ")}. Undo with \`relay undo\`.`));
}
