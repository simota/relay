import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import type { Task } from "../types.js";

export interface WatchOptions {
  repo: string;
  /** Polling interval in milliseconds. */
  intervalMs: number;
}

interface Snapshot {
  updated_at: string;
  status: string;
  title: string;
  assignee: string;
  source_type: string;
}

const SNAPSHOT_LIMIT = 1000;
const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 1_000;

/**
 * Parse interval strings like "5s", "10s", "30s", "1m" into milliseconds.
 * Falls back to {@link DEFAULT_INTERVAL_MS} on unrecognised or out-of-range
 * input, logging a warning so the user knows the requested value was ignored.
 */
export function parseInterval(raw: string | undefined): {
  ms: number;
  warning: string | null;
} {
  if (raw === undefined || raw === "") {
    return { ms: DEFAULT_INTERVAL_MS, warning: null };
  }
  const match = /^(\d+)(ms|s|m)$/.exec(raw.trim());
  if (!match) {
    return {
      ms: DEFAULT_INTERVAL_MS,
      warning: `invalid --interval "${raw}" (expected e.g. 5s, 10s, 30s, 1m); using 5s`,
    };
  }
  const n = Number(match[1]);
  const unit = match[2];
  const ms = unit === "ms" ? n : unit === "s" ? n * 1_000 : n * 60_000;
  if (!Number.isFinite(ms) || ms < MIN_INTERVAL_MS) {
    return {
      ms: DEFAULT_INTERVAL_MS,
      warning: `--interval "${raw}" is below the 1s floor; using 5s`,
    };
  }
  return { ms, warning: null };
}

/**
 * Run `relay watch <repo>`. Prints the current open-task snapshot, then polls
 * the DB every `intervalMs` and emits a one-line diff for new / updated /
 * closed tasks. Resolves on SIGINT (Ctrl+C) after cleaning up the interval
 * and DB handle.
 *
 * The DB handle is opened once and reused across ticks — bun:sqlite is
 * synchronous and the on-disk file is WAL-mode, so concurrent readers (`relay
 * sync`, the web server) coexist without lock contention. We still
 * guard each poll with a try/catch so a transient SQLITE_BUSY (extremely
 * rare in practice) does not crash the watcher.
 */
export async function runWatch(opts: WatchOptions): Promise<void> {
  const db = new RelayDB();

  let prev: Map<number, Snapshot>;
  try {
    const initial = db.listTasks({ repo: opts.repo, limit: SNAPSHOT_LIMIT });
    prev = toSnapshot(initial);
    printInitial(opts.repo, initial, opts.intervalMs);
  } catch (e) {
    db.close();
    throw e;
  }

  await new Promise<void>((resolve) => {
    let stopping = false;

    const timer = setInterval(() => {
      if (stopping) return;
      try {
        const current = db.listTasks({ repo: opts.repo, limit: SNAPSHOT_LIMIT });
        const next = toSnapshot(current);
        emitDiff(prev, next);
        prev = next;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // SQLITE_BUSY can happen if a writer holds an exclusive lock — under
        // WAL mode this is rare but recoverable; log and try again next tick.
        if (/SQLITE_BUSY|database is locked/i.test(msg)) {
          console.log(chalk.gray(`  (db busy, retrying next tick)`));
          return;
        }
        console.log(chalk.red(`watch error: ${msg}`));
      }
    }, opts.intervalMs);

    const sigintHandler = () => {
      if (stopping) return;
      stopping = true;
      clearInterval(timer);
      try {
        db.close();
      } catch {
        // best effort — process is exiting either way
      }
      // Print a newline so the user's next shell prompt starts on a fresh
      // line after the ^C echo.
      process.stdout.write("\n");
      console.log(chalk.gray("watch stopped"));
      process.off("SIGINT", sigintHandler);
      resolve();
      process.exit(130);
    };

    process.on("SIGINT", sigintHandler);
  });
}

function toSnapshot(tasks: Task[]): Map<number, Snapshot> {
  const m = new Map<number, Snapshot>();
  for (const t of tasks) {
    m.set(t.id, {
      updated_at: t.updated_at,
      status: t.status,
      title: t.title,
      assignee: t.assignee,
      source_type: t.source_type,
    });
  }
  return m;
}

function printInitial(repo: string, tasks: Task[], intervalMs: number): void {
  const intervalLabel = formatInterval(intervalMs);
  console.log(
    chalk.bold(`watching ${repo}`) +
      chalk.gray(`  (poll every ${intervalLabel}, Ctrl+C to stop)`),
  );
  if (tasks.length === 0) {
    console.log(chalk.gray("no open tasks yet — waiting for sync…"));
    return;
  }
  const idW = Math.max(2, ...tasks.map((t) => String(t.id).length));
  for (const t of tasks) {
    console.log(formatRow("·", chalk.cyan, t, idW));
  }
}

function emitDiff(
  prev: Map<number, Snapshot>,
  next: Map<number, Snapshot>,
): void {
  const idW = Math.max(
    2,
    ...[...prev.keys(), ...next.keys()].map((id) => String(id).length),
  );

  // NEW: id present in next but not prev.
  for (const [id, snap] of next) {
    if (prev.has(id)) continue;
    console.log(
      formatDiffRow("+", chalk.green, "NEW   ", id, snap, idW),
    );
  }

  // UPDATED: id in both, updated_at changed.
  for (const [id, snap] of next) {
    const before = prev.get(id);
    if (!before) continue;
    if (before.updated_at === snap.updated_at && before.status === snap.status) {
      continue;
    }
    console.log(
      formatDiffRow("~", chalk.yellow, "UPD   ", id, snap, idW),
    );
  }

  // CLOSED: id was in prev but is gone from next. listTasks() defaults to
  // `status != 'done'`, so a task that flips to done (or gets pruned)
  // disappears from the snapshot — both cases count as "closed" from the
  // watcher's POV.
  for (const [id, snap] of prev) {
    if (next.has(id)) continue;
    console.log(
      formatDiffRow("-", chalk.gray, "CLOSED", id, snap, idW),
    );
  }
}

function formatRow(
  marker: string,
  color: (s: string) => string,
  t: Task,
  idW: number,
): string {
  const id = String(t.id).padStart(idW);
  return `${color(marker)} ${chalk.gray(`#${id}`)} [${t.status}] ${chalk.cyan(t.repo)} ${chalk.dim(t.assignee)} ${truncate(t.title, 60)}`;
}

function formatDiffRow(
  marker: string,
  color: (s: string) => string,
  kind: string,
  id: number,
  snap: Snapshot,
  idW: number,
): string {
  const idStr = String(id).padStart(idW);
  return `${color(marker)} ${color(kind)} ${chalk.gray(`#${idStr}`)} [${snap.status}] ${chalk.dim(snap.assignee)} ${truncate(snap.title, 60)}`;
}

function formatInterval(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
