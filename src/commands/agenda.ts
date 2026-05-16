import chalk from "chalk";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";
import { findMissingRepos } from "../repo-metadata.js";
import type { Task } from "../types.js";

// Allowed --days values. Anything else falls back to DEFAULT_DAYS. Kept tight
// so the API surface is the same set both CLI and Web expose.
const ALLOWED_DAYS = [7, 14, 30] as const;
const DEFAULT_DAYS = 7;
export type AgendaDays = (typeof ALLOWED_DAYS)[number];

export interface AgendaDay {
  /** YYYY-MM-DD in local time. */
  date: string;
  /** Weekday short (Mon, Tue, …) — formatted once on the server. */
  weekday: string;
  tasks: Task[];
}

export interface AgendaReport {
  /** Effective lookahead window, in days. */
  days: AgendaDays;
  /** Local-midnight start of "today" — caller's TZ. ISO 8601 (UTC). */
  fromIso: string;
  /** Local-midnight start of (today + days) — exclusive. ISO 8601 (UTC). */
  toIso: string;
  generatedAt: string;
  /** due_at < today (open). Sorted by due_at ASC. */
  overdue: Task[];
  /** Exactly `days` entries, today first. Buckets may be empty arrays. */
  daysList: AgendaDay[];
  /** wait_on='scheduled' AND due_at IS NULL. */
  scheduledNoDate: Task[];
}

export interface AgendaOptions {
  days?: number;
  silent?: boolean;
}

export function normalizeDays(input: number | undefined): AgendaDays {
  if (input === undefined) return DEFAULT_DAYS;
  // ALLOWED_DAYS is closed; widen via find-then-narrow rather than `as` to
  // keep type safety at the boundary.
  const found = ALLOWED_DAYS.find((d) => d === input);
  return found ?? DEFAULT_DAYS;
}

/**
 * Local-midnight `Date` for the calendar day containing `at`. Uses
 * Y/M/D from local time, then constructs a Date so the returned instant
 * is exactly 00:00:00.000 in the runtime's local zone. The resulting
 * .toISOString() shifts to UTC, which is what SQLite stores.
 */
function localMidnight(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
}

function addDays(at: Date, days: number): Date {
  // Use setDate so DST transitions don't drift the clock — Date math by
  // milliseconds would land on 23:00 / 01:00 on spring/fall change days.
  const next = new Date(at);
  next.setDate(next.getDate() + days);
  return next;
}

function ymdLocal(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short" });

function weekdayLocal(at: Date): string {
  return WEEKDAY_FMT.format(at);
}

export function buildAgendaReport(
  db: RelayDB,
  opts: AgendaOptions = {},
): AgendaReport {
  const cfg = loadConfig();
  const repoNames = db.repoStats().map((r) => r.name);
  const missing = findMissingRepos(repoNames, resolveScanRoots(cfg));

  const days = normalizeDays(opts.days);
  const now = new Date();
  const todayMidnight = localMidnight(now);
  const horizonMidnight = addDays(todayMidnight, days);
  const fromIso = todayMidnight.toISOString();
  const toIso = horizonMidnight.toISOString();

  const overdue = db.overdueTasks(fromIso, missing);
  const inRange = db.agendaInRange(fromIso, toIso, missing);
  const scheduledNoDate = db.scheduledNoDate(missing);

  // Pre-build N buckets keyed by local YYYY-MM-DD so tasks land in the right
  // day even if their due_at sits in a different UTC date.
  const buckets = new Map<string, Task[]>();
  const dayMeta: AgendaDay[] = [];
  for (let i = 0; i < days; i++) {
    const at = addDays(todayMidnight, i);
    const key = ymdLocal(at);
    const bucket: Task[] = [];
    buckets.set(key, bucket);
    dayMeta.push({ date: key, weekday: weekdayLocal(at), tasks: bucket });
  }

  for (const t of inRange) {
    if (!t.due_at) continue;
    const dueLocal = new Date(t.due_at);
    const key = ymdLocal(dueLocal);
    const bucket = buckets.get(key);
    // Defensive: a task could fall outside the [from, to) bucket window if
    // SQLite returned a row at exactly `toIso` due to clock skew between
    // query time and JS time. Skip silently — the user will see it in the
    // next agenda refresh.
    if (bucket) bucket.push(t);
  }

  return {
    days,
    fromIso,
    toIso,
    generatedAt: now.toISOString(),
    overdue,
    daysList: dayMeta,
    scheduledNoDate,
  };
}

export function runAgenda(opts: AgendaOptions = {}): AgendaReport {
  const db = new RelayDB();
  try {
    const report = buildAgendaReport(db, opts);
    if (!opts.silent) printAgenda(report);
    return report;
  } finally {
    db.close();
  }
}

function printAgenda(report: AgendaReport): void {
  const isEmpty =
    report.overdue.length === 0 &&
    report.daysList.every((d) => d.tasks.length === 0) &&
    report.scheduledNoDate.length === 0;

  console.log(
    chalk.bold("agenda ") +
      chalk.gray(`(${report.days}-day window · ${report.daysList[0]?.date ?? ""})`),
  );

  if (isEmpty) {
    console.log("");
    console.log(chalk.gray("no due dates or scheduled tasks in window."));
    console.log(
      chalk.gray("set due dates with `relay add --due YYYY-MM-DD`, or wait_on=scheduled to defer."),
    );
    return;
  }

  if (report.overdue.length > 0) {
    console.log("");
    // Overdue gets a red background block — visually loud so the user can't
    // miss it scrolling past. Inverse + red foreground gives a "highlight"
    // effect that's terminal-portable.
    console.log(
      chalk.bgRed.white.bold(` Overdue (${report.overdue.length}) `) +
        chalk.red(" past due, still open"),
    );
    printTaskList(report.overdue, { showDue: true });
  }

  for (const day of report.daysList) {
    console.log("");
    const heading = `${day.weekday} ${day.date}`;
    const count = day.tasks.length;
    if (count === 0) {
      console.log(chalk.bold(heading) + chalk.gray(`  (0)`));
      console.log(chalk.gray("  —"));
      continue;
    }
    console.log(chalk.bold(heading) + chalk.gray(`  (${count})`));
    printTaskList(day.tasks, { showDue: false });
  }

  if (report.scheduledNoDate.length > 0) {
    console.log("");
    console.log(
      chalk.bold(`Scheduled (no date)`) +
        chalk.gray(`  (${report.scheduledNoDate.length})`),
    );
    printTaskList(report.scheduledNoDate, { showDue: false });
  }
}

function printTaskList(
  tasks: Task[],
  { showDue }: { showDue: boolean },
): void {
  const idW = Math.max(2, ...tasks.map((t) => String(t.id).length));
  const repoW = Math.max(4, ...tasks.map((t) => t.repo.length));
  for (const t of tasks) {
    const id = String(t.id).padStart(idW);
    const repo = t.repo.padEnd(repoW);
    const title = truncate(t.title, 60);
    const due = showDue && t.due_at ? chalk.dim(` (${shortDate(t.due_at)})`) : "";
    console.log(
      `  ${chalk.gray(`#${id}`)}  ${chalk.cyan(repo)}  ${title}${due}`,
    );
  }
}

function shortDate(iso: string): string {
  // Render due_at in local TZ so overdue rows match the user's mental model
  // of "the day I missed", not the UTC day the row encodes.
  const d = new Date(iso);
  return ymdLocal(d);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
