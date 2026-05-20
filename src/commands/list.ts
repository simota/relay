import chalk from "chalk";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";
import {
  daysBetween,
  effectivePriority,
  priorityAsciiGraph,
  priorityHistory,
} from "../lib/priority.js";
import { findMissingRepos } from "../repo-metadata.js";
import type { SourceType, Task } from "../types.js";
import { clearFocus, getFocus } from "./focus.js";

export interface ListFilters {
  repo?: string;
  source?: string;
  status?: string;
  agent?: string;
  limit?: number;
}

export function runToday(opts: { limit?: number } = {}): void {
  const cfg = loadConfig();
  const limit = opts.limit ?? cfg.ui.today_limit;
  const db = new RelayDB();

  // Focus mode short-circuits the normal Today query: when the user has
  // pinned a task, we only ever render that one row regardless of priority
  // ordering or limit. A stale focus (task deleted out from under us) is
  // self-healing — we drop it and fall back to the default flow.
  const focusId = getFocus();
  if (focusId !== null) {
    const task = db.getTask(focusId);
    if (!task) {
      db.close();
      clearFocus();
      console.log(
        chalk.yellow(
          `focus pointed at #${focusId} but that task no longer exists — cleared. Re-running today…`,
        ),
      );
      runToday(opts);
      return;
    }
    const cues = new Map<number, { age: string; summary: string }>();
    if (task.context_hash) {
      const ctx = db.getContext(task.context_hash);
      if (ctx?.summary) {
        cues.set(task.id, {
          age: humanAge(ctx.createdAt),
          summary: firstLine(ctx.summary),
        });
      }
    }
    db.close();
    console.log(chalk.cyan("Focus mode — others hidden.") + chalk.gray(" clear: `relay focus --clear`"));
    printTable([task], cues);
    return;
  }

  const repoNames = db.repoStats().map((r) => r.name);
  const missing = findMissingRepos(repoNames, resolveScanRoots(cfg));
  const tasks = db.today(limit, missing, cfg.ui.priority_decay_days);

  if (tasks.length === 0) {
    const counts = db.viewCounts(missing);
    const sourceCounts = db.sourceCounts();
    const latestSync = db.latestSyncPerAdapter();
    db.close();
    printTodayEmptyState(counts, sourceCounts, latestSync);
    return;
  }

  const cues = new Map<number, { age: string; summary: string }>();
  for (const t of tasks) {
    if (!t.context_hash) continue;
    const ctx = db.getContext(t.context_hash);
    if (!ctx || !ctx.summary) continue;
    cues.set(t.id, {
      age: humanAge(ctx.createdAt),
      summary: firstLine(ctx.summary),
    });
  }
  db.close();
  printTable(tasks, cues);
}

export function runList(filters: ListFilters): void {
  const db = new RelayDB();
  const tasks = db.listTasks({
    repo: filters.repo,
    source: filters.source,
    status: filters.status,
    assignee: filters.agent,
    limit: filters.limit,
  });
  db.close();

  if (tasks.length === 0) {
    console.log(chalk.gray("no tasks match."));
    return;
  }
  printTable(tasks);
}

export function runShow(id: number): void {
  const db = new RelayDB();
  const task = db.getTask(id);
  db.close();

  if (!task) {
    console.log(chalk.red(`task #${id} not found`));
    process.exit(1);
  }

  const cfg = loadConfig();
  const decayDays = cfg.ui.priority_decay_days;
  const effective = effectivePriority(task.priority, task.updated_at, decayDays);
  const ageDays = daysBetween(task.updated_at);
  const priorityLine =
    effective === task.priority
      ? `priority: ${task.priority}`
      : `priority: ${effective} (raw ${task.priority}, -${task.priority - effective} after ${ageDays}d idle; decay every ${decayDays}d)`;

  console.log(chalk.bold(`#${task.id}  ${task.title}`));
  console.log(chalk.gray(`repo:     ${task.repo}`));
  console.log(chalk.gray(`source:   ${task.source_type} (${task.source_id})`));
  console.log(chalk.gray(`status:   ${task.status}`));
  console.log(chalk.gray(`assignee: ${task.assignee}`));
  console.log(chalk.gray(priorityLine));
  if (task.due_at) console.log(chalk.gray(`due:      ${task.due_at}`));
  if (task.session_id) console.log(chalk.gray(`session:  ${task.session_id}`));
  if (task.files.length) console.log(chalk.gray(`files:    ${task.files.join(", ")}`));

  if (effective !== task.priority && decayDays > 0) {
    const history = priorityHistory(task.priority, task.updated_at, decayDays);
    console.log("");
    console.log(chalk.gray("priority decay (last 8 weeks):"));
    for (const line of priorityAsciiGraph(history)) {
      console.log(chalk.gray(`  ${line}`));
    }
    console.log(
      chalk.gray(
        `  note: today ranks by effective priority (priority_decay_days=${decayDays}; set 0 to disable).`,
      ),
    );
  }

  if (task.body) {
    console.log("");
    console.log(task.body);
  }
}

function printTable(
  tasks: Task[],
  cues?: Map<number, { age: string; summary: string }>,
): void {
  const idW = Math.max(2, ...tasks.map((t) => String(t.id).length));
  const repoW = Math.max(4, ...tasks.map((t) => t.repo.length));
  const agentW = Math.max(5, ...tasks.map((t) => t.assignee.length));

  for (const t of tasks) {
    const id = String(t.id).padStart(idW);
    const repo = t.repo.padEnd(repoW);
    const agent = t.assignee.padEnd(agentW);
    const title = truncate(t.title, 60);
    const marker = statusMarker(t.status);
    console.log(
      `${chalk.gray(`#${id}`)} ${marker} ${chalk.cyan(repo)}  ${chalk.dim(agent)}  ${title}`,
    );
    const cue = cues?.get(t.id);
    if (cue) {
      console.log(
        chalk.dim(`${" ".repeat(idW + 4)}last touched ${cue.age}: ${truncate(cue.summary, 80)}`),
      );
    }
  }
}

function humanAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const ms = Date.now() - then;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function firstLine(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s+/, "").trim())
    .find((l) => l.length > 0) ?? "";
}

const syncAdapters: SourceType[] = [
  "code_todo",
  "claude_session_todo",
  "codex_session_todo",
  "antigravity_session_todo",
  "cursor_session_todo",
  "github_issue",
  "agents_note",
];

function printTodayEmptyState(
  counts: { open: number; snoozed: number; done: number },
  sourceCounts: Record<string, number>,
  latestSync: Array<{ adapter: string; ended_at: string; status: string; count: number }>,
): void {
  const latestByAdapter = new Map(latestSync.map((row) => [row.adapter, row]));
  const hasSyncHistory = latestSync.length > 0;
  const hasOpenSources = Object.values(sourceCounts).some((count) => count > 0);

  console.log(chalk.gray("no items for today."));
  console.log(
    chalk.gray(`total — open: ${counts.open} · snoozed: ${counts.snoozed} · done: ${counts.done}`),
  );

  for (const adapter of syncAdapters) {
    const sync = latestByAdapter.get(adapter);
    if (!sync) {
      console.log(chalk.gray(`${adapter}: never synced`));
      continue;
    }
    console.log(
      chalk.gray(
        `${adapter}: ${sync.status} ${formatAge(sync.ended_at)} ago (${sync.count} fetched)`,
      ),
    );
  }

  const tip = !hasSyncHistory
    ? "Run `relay sync` to ingest tasks."
    : hasOpenSources || counts.open > 0
      ? "Open Inbox with `relay ls --status open`."
      : "Review completed work with `relay ls --status done`.";
  console.log(chalk.gray(tip));
}

function formatAge(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function statusMarker(s: string): string {
  switch (s) {
    case "in_progress":
      return chalk.yellow("▶");
    case "blocked":
      return chalk.red("⊘");
    case "snoozed":
      return chalk.gray("⏸");
    case "done":
      return chalk.green("✓");
    default:
      return chalk.dim("·");
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
