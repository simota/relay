import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { enabledAdapters, findAdapter } from "../adapters/index.js";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";
import type {
  Adapter,
  AdapterContext,
  SourceType,
  SyncReport,
  TaskInput,
} from "../types.js";

export type SyncEvent =
  | { type: "adapter_start"; adapter: SourceType }
  | { type: "adapter_skipped"; adapter: SourceType; reason: string }
  | {
      type: "adapter_done";
      adapter: SourceType;
      inserted: number;
      updated: number;
      unchanged: number;
      fetched: number;
      elapsedMs: number;
      /** First few source_ids that would be ingested. Populated only in dry-run mode. */
      sampleSourceIds?: string[];
    }
  | { type: "adapter_error"; adapter: SourceType; message: string }
  | { type: "done"; report: SyncReport };

export interface SyncOptions {
  source?: string;
  onEvent?: (event: SyncEvent) => void | Promise<void>;
  /** Suppress chalk console output. Useful in non-interactive mode. */
  silent?: boolean;
  /** Preview without writing — adapters still fetch, DB stays untouched. */
  dryRun?: boolean;
  /**
   * Skip adapters whose most recent sync_history row is `ok` and finished
   * within the last hour. Lets users re-run after a Ctrl+C without
   * re-fetching the adapters that already completed.
   */
  resume?: boolean;
}

const RESUME_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function runSync(opts: SyncOptions = {}): Promise<SyncReport> {
  const log = opts.silent ? () => {} : (msg: string) => console.log(msg);
  const cfg = loadConfig();
  const db = new RelayDB();

  let adapters: Adapter[] = opts.source
    ? [findAdapter(opts.source)].filter((a): a is Adapter => Boolean(a))
    : enabledAdapters(cfg.adapters);

  const report: SyncReport = { inserted: 0, updated: 0, unchanged: 0, errors: [] };

  if (opts.resume && adapters.length > 0) {
    const latest = new Map(db.latestSyncPerAdapter().map((r) => [r.adapter, r]));
    const cutoff = Date.now() - RESUME_WINDOW_MS;
    const skipped: string[] = [];
    adapters = adapters.filter((adapter) => {
      const row = latest.get(adapter.name);
      if (!row || row.status !== "ok") return true;
      const ended = Date.parse(row.ended_at);
      if (!Number.isFinite(ended) || ended < cutoff) return true;
      skipped.push(adapter.name);
      return false;
    });
    if (skipped.length > 0) {
      log(chalk.gray(`--resume: skipping ${skipped.length} adapter(s) already ok within 1h: ${skipped.join(", ")}`));
    }
  }

  if (adapters.length === 0) {
    log(chalk.yellow(opts.resume ? "no adapters need resyncing" : "no adapters enabled"));
    db.close();
    await opts.onEvent?.({ type: "done", report });
    return report;
  }

  // tracked_repos is a UNION layer: it lists additional absolute paths the
  // user wants sync'd on top of whatever lives under scan.roots. The base
  // scan.roots behavior is unchanged — every repo directly under those roots
  // is still picked up. Only repos outside scan.roots need to be matched
  // against the tracked allowlist before being kept.
  const baseRoots = resolveScanRoots(cfg);
  const trackedList = cfg.scan.tracked_repos;
  const trackedSet: ReadonlySet<string> =
    trackedList.length > 0 ? new Set(trackedList) : new Set();

  // Expose each tracked path's parent to fs-scanning adapters when that
  // parent isn't already a scan root.
  const baseRootSet = new Set(baseRoots);
  const extraRoots = trackedList
    .map((p) => dirname(p))
    .filter((r) => !baseRootSet.has(r));
  const effectiveRoots = Array.from(new Set([...baseRoots, ...extraRoots]));

  // Build the set of repo names that live directly under one of the base
  // scan roots. Those are always accepted; only tasks that don't resolve to
  // any base-root child need to be checked against the tracked allowlist.
  const baseRepoNames = new Set<string>();
  for (const root of baseRoots) {
    if (!existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root)) {
        if (entry.startsWith(".")) continue;
        baseRepoNames.add(entry);
      }
    } catch {
      // ignore unreadable roots — they just won't contribute names
    }
  }

  const ctx = {
    roots: effectiveRoots,
    exclude: cfg.scan.exclude,
    trackedRepos: trackedSet.size > 0 ? trackedSet : undefined,
    githubUser: cfg.github.user,
    githubOrgs: cfg.github.orgs,
    adapters: cfg.adapters,
    claudeSession: {
      excludePatterns: cfg.claude_session.exclude_patterns,
      storeBody: cfg.claude_session.store_body,
      lookbackDays: cfg.claude_session.lookback_days,
    },
    codexSession: {
      excludePatterns: cfg.codex_session.exclude_patterns,
      storeBody: cfg.codex_session.store_body,
      lookbackDays: cfg.codex_session.lookback_days,
    },
    antigravitySession: {
      excludePatterns: cfg.antigravity_session.exclude_patterns,
      storeBody: cfg.antigravity_session.store_body,
      lookbackDays: cfg.antigravity_session.lookback_days,
    },
    cursorSession: {
      excludePatterns: cfg.cursor_session.exclude_patterns,
      storeBody: cfg.cursor_session.store_body,
      lookbackDays: cfg.cursor_session.lookback_days,
    },
    ghRunFailure: {
      storeBody: cfg.gh_run_failure.store_body,
    },
    gitStash: {
      storeBody: cfg.git_stash.store_body,
    },
    orphanBranch: {
      storeBody: cfg.orphan_branch.store_body,
      excludePatterns: cfg.orphan_branch.exclude_patterns,
    },
    ghProjectCard: {
      fallbackRepo: cfg.github.project_v2.fallback_repo,
      doneStatuses: cfg.gh_project_card.done_statuses,
    },
    knownOpenSourceIds: (sourceType: SourceType) => db.listOpenSourceIdsByType(sourceType),
    // Write-side handle for adapters that maintain side-car tables
    // (currently only the 4 session adapters writing to `sessions`).
    // Skipped in dry-run so previews don't mutate the DB.
    db: opts.dryRun ? undefined : db,
    dryRun: opts.dryRun,
    log: opts.silent ? undefined : log,
  };

  if (opts.dryRun) {
    log(chalk.yellow("DRY RUN — no DB writes"));
  }

  // Each adapter is its own async closure so events fire as that adapter
  // finishes — not after every adapter completes. bun:sqlite is synchronous
  // so concurrent upsertSafely calls don't actually overlap at SQL level.
  const work = adapters.map(async (adapter) => {
    const start = Date.now();
    // Shallow-clone ctx so per-adapter fields (lastSyncCursor) don't bleed
    // across adapters running concurrently via Promise.all.
    const adapterCtx: AdapterContext = {
      ...ctx,
      lastSyncCursor: db.lastSuccessfulSyncEndedAt(adapter.name) ?? undefined,
    };
    try {
      const skipped = adapter.precheck?.(adapterCtx);
      if (skipped?.skip) {
        db.recordSyncHistory({
          started_at: new Date(start).toISOString(),
          ended_at: new Date().toISOString(),
          adapter: adapter.name,
          status: "skipped",
          count: 0,
          error: skipped.reason,
        });
        log(chalk.yellow(`⊘ ${adapter.name}`) + chalk.gray(`  SKIPPED  ${skipped.reason}`));
        await opts.onEvent?.({ type: "adapter_skipped", adapter: adapter.name, reason: skipped.reason });
        return;
      }

      await opts.onEvent?.({ type: "adapter_start", adapter: adapter.name });
      const rawTasks = await adapter.fetch(adapterCtx);
      // Tracked repos are additive: accept every task that resolves under a
      // base scan root, and additionally accept tasks that match the tracked
      // allowlist (so out-of-tree repos pinned by the user show up). Only
      // tasks that fall outside *both* — typically siblings of a tracked
      // path that the user did not opt into — are dropped.
      const tasks =
        extraRoots.length > 0
          ? rawTasks.filter((t) => {
              if (baseRepoNames.has(t.repo)) return true;
              for (const root of extraRoots) {
                if (trackedSet.has(join(root, t.repo))) return true;
              }
              return false;
            })
          : rawTasks;
      let sampleSourceIds: string[] | undefined;
      let upserted: { inserted: number; updated: number; unchanged: number };
      if (opts.dryRun) {
        const preview = db.classifyTasks(tasks);
        upserted = {
          inserted: preview.inserted,
          updated: preview.updated,
          unchanged: preview.unchanged,
        };
        sampleSourceIds = preview.sampleSourceIds;
        report.inserted += preview.inserted;
        report.updated += preview.updated;
        report.unchanged += preview.unchanged;
      } else {
        upserted = upsertSafely(db, tasks, report);
      }
      const elapsedMs = Date.now() - start;
      if (!opts.dryRun) {
        db.recordSyncHistory({
          started_at: new Date(start).toISOString(),
          ended_at: new Date().toISOString(),
          adapter: adapter.name,
          status: "ok",
          count: tasks.length,
        });
      }
      log(
        chalk.green(`${opts.dryRun ? "·" : "✓"} ${adapter.name}`) +
          chalk.gray(
            `  fetched=${tasks.length}  ${opts.dryRun ? "would_insert" : "inserted"}=${upserted.inserted}  ${opts.dryRun ? "would_update" : "updated"}=${upserted.updated}  unchanged=${upserted.unchanged}  ${elapsedMs}ms`,
          ) +
          (sampleSourceIds && sampleSourceIds.length > 0
            ? chalk.gray(`\n    sample source_ids: ${sampleSourceIds.join(", ")}${tasks.length > sampleSourceIds.length ? ` … +${tasks.length - sampleSourceIds.length} more` : ""}`)
            : ""),
      );
      await opts.onEvent?.({
        type: "adapter_done",
        adapter: adapter.name,
        inserted: upserted.inserted,
        updated: upserted.updated,
        unchanged: upserted.unchanged,
        fetched: tasks.length,
        elapsedMs,
        sampleSourceIds,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      db.recordSyncHistory({
        started_at: new Date(start).toISOString(),
        ended_at: new Date().toISOString(),
        adapter: adapter.name,
        status: "error",
        count: 0,
        error: message,
      });
      report.errors.push({ adapter: adapter.name, message });
      log(chalk.red(`✗ ${adapter.name}: ${message}`));
      await opts.onEvent?.({ type: "adapter_error", adapter: adapter.name, message });
    }
  });

  await Promise.all(work);

  if (!opts.dryRun) {
    autoCloseMissingRepoTasks(db, ctx.roots, log);
    await autoCloseResolvedRemoteTasks(adapters, ctx, db, log);
    // Trim old undo_log rows so bulk-operation snapshots don't bloat the
    // SQLite file indefinitely. 7 days is well past the practical undo
    // window — the only consumer is `relay undo`, which always operates
    // on the most recent entry.
    const pruned = db.pruneUndoOlderThan(7);
    if (pruned > 0) {
      log(chalk.gray(`· pruned ${pruned} undo_log row(s) older than 7 days`));
    }
  }
  db.close();

  log(
    `\n${chalk.bold("sync")}: ${chalk.green(report.inserted)} new, ${chalk.yellow(report.updated)} updated, ${chalk.gray(report.unchanged)} unchanged` +
      (report.errors.length ? chalk.red(`, ${report.errors.length} errors`) : ""),
  );

  await opts.onEvent?.({ type: "done", report });
  return report;
}

function autoCloseMissingRepoTasks(
  db: RelayDB,
  roots: string[],
  log: (msg: string) => void,
): void {
  const repos = db.repoStats().map((r) => r.name);
  const missing = repos.filter((name) => !roots.some((root) => existsSync(join(root, name))));
  if (missing.length === 0) return;
  const tasks = db.findOpenTasksInRepos(missing);
  if (tasks.length === 0) {
    log(chalk.gray(`⊘ ${missing.length} repo(s) missing on disk, but no fs-bound tasks to close`));
    return;
  }
  const ids = tasks.map((t) => t.id);
  const inverses = db.batchCloseTasks(ids);
  if (inverses.length === 0) return;
  db.recordUndo({
    op_kind: "sync_auto_close_missing_repos",
    payload: { tasks: ids },
    inverse: { tasks: inverses },
  });
  const perRepo = new Map<string, number>();
  for (const t of tasks) perRepo.set(t.repo, (perRepo.get(t.repo) ?? 0) + 1);
  const sample = [...perRepo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r, n]) => `${r} (${n})`)
    .join(", ");
  log(
    chalk.yellow(
      `⚠ auto-closed ${inverses.length} fs-bound task(s) from ${missing.length} missing repo(s): ${sample}${missing.length > 3 ? ` +${missing.length - 3} more` : ""}`,
    ),
  );
  log(chalk.gray(`  (undo with \`relay undo\`)`));
}

// For each adapter that reports `fetchResolved`, sweep merged/closed remote
// items and auto-close matching DB tasks. Mirrors the missing-repo flow:
// reversible via `relay undo`, no-op when nothing matches.
async function autoCloseResolvedRemoteTasks(
  adapters: Adapter[],
  ctx: AdapterContext,
  db: RelayDB,
  log: (msg: string) => void,
): Promise<void> {
  const items: Array<{ source_type: string; source_id: string }> = [];
  for (const adapter of adapters) {
    if (!adapter.fetchResolved) continue;
    try {
      // Inject the same per-adapter cursor used in the open sweep so the
      // closed sweep also benefits from incremental fetch when supported.
      const resolvedCtx: AdapterContext = {
        ...ctx,
        lastSyncCursor: db.lastSuccessfulSyncEndedAt(adapter.name) ?? undefined,
      };
      const resolved = await adapter.fetchResolved(resolvedCtx);
      for (const r of resolved) items.push({ source_type: r.source_type, source_id: r.source_id });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(chalk.gray(`  (resolved sweep for ${adapter.name} failed: ${message})`));
    }
  }
  if (items.length === 0) return;

  const inverses = db.closeTasksBySourceIds(items);
  if (inverses.length === 0) return;

  const now = new Date().toISOString();
  const closedSnapshots = inverses.map((inv) => ({
    id: inv.id,
    status: "done" as const,
    due_at: inv.due_at,
    closed_at: now,
  }));
  db.recordUndo({
    op_kind: "sync_auto_close_resolved_remote",
    payload: { tasks: closedSnapshots },
    inverse: { tasks: inverses },
  });

  log(
    chalk.yellow(
      `⚠ auto-closed ${inverses.length} task(s) for merged/closed remote items`,
    ),
  );
  log(chalk.gray(`  (undo with \`relay undo\`)`));
}

function upsertSafely(db: RelayDB, tasks: TaskInput[], report: SyncReport) {
  if (tasks.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const result = db.upsertTasks(tasks);
  report.inserted += result.inserted;
  report.updated += result.updated;
  report.unchanged += result.unchanged;
  return result;
}
