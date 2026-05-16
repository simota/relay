import chalk from "chalk";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";
import { findMissingRepos } from "../repo-metadata.js";
import type { Task } from "../types.js";

// Supported window aliases for --since. Anything else falls back to 24h.
// Kept tight on purpose — the value is also surfaced via the Web API.
const SINCE_HOURS: Record<string, number> = {
  "24h": 24,
  "48h": 48,
  "7d": 24 * 7,
  "14d": 24 * 14,
  "30d": 24 * 30,
};

export type StandupSince = keyof typeof SINCE_HOURS;

export interface StandupRunCue {
  agent: string;
  /** Latest non-null output_summary inside the window, or null. */
  output_summary: string | null;
  ended_at: string | null;
}

export interface StandupTaskCue {
  /** Latest context summary for the task (single-line), or null. */
  context_summary: string | null;
  run: StandupRunCue | null;
}

export interface StandupReport {
  since: string;
  sinceIso: string;
  generatedAt: string;
  yesterday: Task[];
  today: Task[];
  blockers: Task[];
  /** Keyed by task.id — every yesterday/today/blockers task gets an entry. */
  cues: Record<number, StandupTaskCue>;
}

export function buildStandupReport(
  db: RelayDB,
  opts: { since?: string } = {},
): StandupReport {
  const cfg = loadConfig();
  const sinceLabel = normalizeSince(opts.since);
  const sinceHours = SINCE_HOURS[sinceLabel];
  // SINCE_HOURS is a closed map; normalizeSince always returns a valid key.
  if (sinceHours === undefined) {
    throw new Error(`unsupported --since value: ${sinceLabel}`);
  }
  const now = new Date();
  const sinceIso = new Date(now.getTime() - sinceHours * 60 * 60 * 1000).toISOString();

  const repoNames = db.repoStats().map((r) => r.name);
  const missing = findMissingRepos(repoNames, resolveScanRoots(cfg));

  // Yesterday is closed_at-based, so we don't filter by missing repos here —
  // the user closed it, the achievement should still be visible even if the
  // repo dir is gone.
  const yesterday = db.closedTasksSince(sinceIso);
  const today = db.selfDrivenTasks(20, missing);
  const blockers = db.blockedTasks(20, missing);

  const allTasks = [...yesterday, ...today, ...blockers];
  const allIds = allTasks.map((t) => t.id);
  const runMap = db.latestSuccessfulRunsForTasks(yesterday.map((t) => t.id), sinceIso);

  const cues: Record<number, StandupTaskCue> = {};
  const seen = new Set<number>();
  for (const t of allTasks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const ctxSummary = t.context_hash
      ? firstLine(db.getContext(t.context_hash)?.summary ?? "")
      : "";
    const run = runMap.get(t.id) ?? null;
    cues[t.id] = {
      context_summary: ctxSummary || null,
      run: run
        ? {
            agent: run.agent,
            output_summary: firstLine(run.output_summary ?? "") || null,
            ended_at: run.ended_at,
          }
        : null,
    };
  }
  // Silence unused-var lint by referencing allIds (kept for symmetry / future
  // batching). The map iteration above already covers every task.
  void allIds;

  return {
    since: sinceLabel,
    sinceIso,
    generatedAt: now.toISOString(),
    yesterday,
    today,
    blockers,
    cues,
  };
}

export function runStandup(opts: { since?: string; silent?: boolean } = {}): StandupReport {
  const db = new RelayDB();
  try {
    const report = buildStandupReport(db, opts);
    if (!opts.silent) printStandup(report);
    return report;
  } finally {
    db.close();
  }
}

function printStandup(report: StandupReport): void {
  const isEmpty =
    report.yesterday.length === 0 &&
    report.today.length === 0 &&
    report.blockers.length === 0;

  console.log(
    chalk.bold("standup ") +
      chalk.gray(`(since ${report.since} · ${report.sinceIso.slice(0, 10)})`),
  );

  if (isEmpty) {
    console.log("");
    console.log(chalk.gray("no activity in window."));
    console.log(
      chalk.gray("try `relay sync` to refresh sources, or `relay today` for the full queue."),
    );
    return;
  }

  console.log("");
  printSection("Yesterday", report.yesterday, report.cues, "yesterday");
  console.log("");
  printSection("Today", report.today, report.cues, "today");
  console.log("");
  printSection("Blockers", report.blockers, report.cues, "blockers");
}

type SectionKind = "yesterday" | "today" | "blockers";

function printSection(
  heading: string,
  tasks: Task[],
  cues: Record<number, StandupTaskCue>,
  kind: SectionKind,
): void {
  const count = tasks.length;
  console.log(
    chalk.bold(`${heading}`) + chalk.gray(`  (${count})`),
  );

  if (count === 0) {
    console.log(chalk.gray(`  ${emptyMessageFor(kind)}`));
    return;
  }

  const idW = Math.max(2, ...tasks.map((t) => String(t.id).length));
  const repoW = Math.max(4, ...tasks.map((t) => t.repo.length));
  const agentW = Math.max(5, ...tasks.map((t) => t.assignee.length));

  for (const t of tasks) {
    const id = String(t.id).padStart(idW);
    const repo = t.repo.padEnd(repoW);
    const agent = t.assignee.padEnd(agentW);
    const title = truncate(t.title, 60);
    const marker = sectionMarker(kind, t);
    console.log(
      `  ${chalk.gray(`#${id}`)} ${marker} ${chalk.cyan(repo)}  ${chalk.dim(agent)}  ${title}`,
    );

    const cue = cues[t.id];
    if (!cue) continue;
    // Prefer the run cue for Yesterday (it's the concrete "what got done")
    // and the context summary everywhere else. Both can be present — print
    // both, run first, indented under the row.
    if (kind === "yesterday" && cue.run && cue.run.output_summary) {
      console.log(
        chalk.dim(
          `    ${" ".repeat(idW)} via ${cue.run.agent} · ${truncate(cue.run.output_summary, 80)}`,
        ),
      );
    } else if (kind === "yesterday" && cue.run) {
      console.log(
        chalk.dim(`    ${" ".repeat(idW)} via ${cue.run.agent}`),
      );
    }
    if (cue.context_summary) {
      console.log(
        chalk.dim(`    ${" ".repeat(idW)} ${truncate(cue.context_summary, 80)}`),
      );
    }
  }
}

function sectionMarker(kind: SectionKind, task: Task): string {
  if (kind === "yesterday") return chalk.green("✓");
  if (kind === "blockers") {
    return task.wait_on === "reviewer" ? chalk.yellow("⊙") : chalk.red("⊘");
  }
  return chalk.dim("·");
}

function emptyMessageFor(kind: SectionKind): string {
  switch (kind) {
    case "yesterday":
      return "no closed tasks or successful runs in window";
    case "today":
      return "nothing waiting on me";
    case "blockers":
      return "no reviewer / external blockers";
  }
}

function normalizeSince(input?: string): StandupSince {
  if (!input) return "24h";
  const lc = input.toLowerCase();
  if (lc in SINCE_HOURS) return lc as StandupSince;
  return "24h";
}

function firstLine(s: string): string {
  return (
    s
      .split("\n")
      .map((line) => line.replace(/^[-*•]\s+/, "").trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
