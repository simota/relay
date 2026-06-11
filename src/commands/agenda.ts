import chalk from "chalk";
import { displayWidth, padEndDisplay } from "../lib/text-width.js";
import {
  bucketByDate,
  collectActivityInWindow,
  type ActivityDay,
} from "../lib/activity-calendar.js";
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
  /**
   * Past-N-days activity band (newest first). Mixes Promise Ledger
   * unfinished sessions and `## YYYY-MM-DD` agent journal entries.
   * Present only when `[features].activity_calendar = true`; the field
   * is omitted entirely otherwise so the classic Agenda payload stays
   * untouched for users who haven't opted in.
   */
  recentActivity?: ActivityDay[];
}

/** Past-window for the Activity Calendar band. Days are LOCAL dates. */
const RECENT_ACTIVITY_DAYS = 7;

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

export async function buildAgendaReport(
  db: RelayDB,
  opts: AgendaOptions = {},
): Promise<AgendaReport> {
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

  let recentActivity: ActivityDay[] | undefined;
  if (cfg.features.activity_calendar) {
    // Build the past-N-days metadata in the same shape used for daysList
    // — local YYYY-MM-DD + weekday — so the UI can render both bands
    // identically. Order: newest-first (today-1, today-2, …).
    const recentDays: { date: string; weekday: string }[] = [];
    for (let i = 1; i <= RECENT_ACTIVITY_DAYS; i++) {
      const at = addDays(todayMidnight, -i);
      recentDays.push({ date: ymdLocal(at), weekday: weekdayLocal(at) });
    }
    const fromDate = recentDays[recentDays.length - 1]?.date ?? ymdLocal(todayMidnight);
    const toDate = recentDays[0]?.date ?? ymdLocal(todayMidnight);
    const items = await collectActivityInWindow(db, {
      fromDate,
      toDate,
      scanRoots: resolveScanRoots(cfg),
      trackedRepos: cfg.scan.tracked_repos,
      exclude: cfg.scan.exclude,
    });
    recentActivity = bucketByDate(items, recentDays);
  }

  return {
    days,
    fromIso,
    toIso,
    generatedAt: now.toISOString(),
    overdue,
    daysList: dayMeta,
    scheduledNoDate,
    ...(recentActivity ? { recentActivity } : {}),
  };
}

export async function runAgenda(opts: AgendaOptions = {}): Promise<AgendaReport> {
  const db = new RelayDB();
  try {
    const report = await buildAgendaReport(db, opts);
    if (!opts.silent) printAgenda(report);
    return report;
  } finally {
    db.close();
  }
}

function printAgenda(report: AgendaReport): void {
  const recentItemCount = (report.recentActivity ?? []).reduce(
    (s, d) => s + d.items.length,
    0,
  );
  const isEmpty =
    report.overdue.length === 0 &&
    report.daysList.every((d) => d.tasks.length === 0) &&
    report.scheduledNoDate.length === 0 &&
    recentItemCount === 0;

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

  if (report.recentActivity && report.recentActivity.length > 0) {
    const totalItems = report.recentActivity.reduce((s, d) => s + d.items.length, 0);
    if (totalItems > 0) {
      console.log("");
      console.log(
        chalk.bold(`Recent activity`) +
          chalk.gray(`  (${totalItems} item${totalItems === 1 ? "" : "s"} · last ${report.recentActivity.length} days)`),
      );
      for (const day of report.recentActivity) {
        if (day.items.length === 0) continue;
        const heading = `${day.weekday} ${day.date}`;
        console.log("");
        console.log(chalk.bold(heading) + chalk.gray(`  (${day.items.length})`));
        for (const item of day.items) {
          if (item.kind === "promise_ledger") {
            console.log(
              `  ${chalk.yellow("◐")} ${chalk.cyan((item.repo ?? "—").padEnd(20))} ${chalk.gray(item.session.type + ":" + item.session.id.slice(0, 8))} ${truncate(item.title, 60)} ${chalk.yellow(`(${item.unmet_count} unmet)`)}`,
            );
          } else {
            console.log(
              `  ${chalk.blue("📓")} ${chalk.cyan(item.repo.padEnd(20))} ${chalk.gray(item.agent.padEnd(10))} ${truncate(item.title, 60)}`,
            );
          }
        }
      }
    }
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
  const repoW = Math.max(4, ...tasks.map((t) => displayWidth(t.repo)));
  for (const t of tasks) {
    const id = String(t.id).padStart(idW);
    const repo = padEndDisplay(t.repo, repoW);
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
