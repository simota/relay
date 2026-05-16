import type { RelayDB, RelayContext } from "../db/client.js";
import type { Task } from "../types.js";

// Supported window aliases for --since. Anything else falls back to 7d.
// Kept aligned with standup's SINCE_HOURS for predictability — digest just
// defaults to 7d instead of 24h since "weekly review" is the headline use.
const SINCE_HOURS: Record<string, number> = {
  "24h": 24,
  "48h": 48,
  "7d": 24 * 7,
  "14d": 24 * 14,
  "30d": 24 * 30,
  "90d": 24 * 90,
};

export type DigestSince = keyof typeof SINCE_HOURS;
export type DigestFormat = "md" | "json";

export interface DigestRepoEntry {
  repo: string;
  closed_count: number;
  run_count: number;
}

export interface DigestClosedTask {
  id: number;
  repo: string;
  title: string;
  assignee: string;
  closed_at: string | null;
}

export interface DigestAgentUsage {
  agent: string;
  run_count: number;
  /** Total of (ended_at - started_at) in ms across runs with both timestamps. */
  total_duration_ms: number;
  /** Number of runs that did not yet have ended_at (excluded from total_duration_ms). */
  unfinished_count: number;
}

export interface DigestContextHighlight {
  repo: string;
  created_at: string;
  /** Single-line cue extracted from contexts.summary (first non-empty line). */
  summary: string;
}

export interface DigestReport {
  since: string;
  sinceIso: string;
  untilIso: string;
  generatedAt: string;
  repos: DigestRepoEntry[];
  closed: DigestClosedTask[];
  agents: DigestAgentUsage[];
  highlights: DigestContextHighlight[];
}

export function normalizeSince(input?: string): DigestSince {
  if (!input) return "7d";
  const lc = input.toLowerCase();
  if (lc in SINCE_HOURS) return lc as DigestSince;
  return "7d";
}

export function sinceIsoFromLabel(label: DigestSince, now: Date = new Date()): string {
  const hours = SINCE_HOURS[label];
  if (hours === undefined) {
    throw new Error(`unsupported --since value: ${label}`);
  }
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export function buildDigest(
  db: RelayDB,
  opts: { since?: string } = {},
): DigestReport {
  const sinceLabel = normalizeSince(opts.since);
  const now = new Date();
  const sinceIso = sinceIsoFromLabel(sinceLabel, now);
  const untilIso = now.toISOString();

  const closedTasks = db.closedTasksSince(sinceIso, untilIso);
  const runs = db.runsSince(sinceIso);
  const highlightRows = db.contextHighlightsSince(sinceIso, 10);

  return {
    since: sinceLabel,
    sinceIso,
    untilIso,
    generatedAt: untilIso,
    repos: buildRepoEntries(closedTasks, runs),
    closed: closedTasks.map(toClosedTask),
    agents: buildAgentUsage(runs),
    highlights: highlightRows.map(toContextHighlight),
  };
}

function toClosedTask(t: Task): DigestClosedTask {
  return {
    id: t.id,
    repo: t.repo,
    title: t.title,
    assignee: t.assignee,
    closed_at: t.closed_at,
  };
}

function toContextHighlight(c: RelayContext): DigestContextHighlight {
  return {
    repo: c.repo,
    created_at: c.createdAt,
    summary: firstLine(c.summary),
  };
}

function buildRepoEntries(
  closed: Task[],
  runs: Array<{ task_id: number; agent: string }>,
): DigestRepoEntry[] {
  // Repos that show up either as closed-task owners or via a run's task.repo.
  // Run.task_id needs a task lookup, but closed tasks already give us the
  // dominant signal; if a run's task is missing from closed (still open), we
  // count it via a separate map keyed on task_id below. To keep this dep-free
  // we just count runs per repo when the run's task is in `closed`. For runs
  // against still-open tasks we'd need an extra query — kept out of scope to
  // avoid an N+1; the "Repos worked on" section is meant as a quick glance.
  const closedByRepo = new Map<string, number>();
  for (const t of closed) {
    closedByRepo.set(t.repo, (closedByRepo.get(t.repo) ?? 0) + 1);
  }

  const taskRepoById = new Map<number, string>();
  for (const t of closed) taskRepoById.set(t.id, t.repo);

  const runsByRepo = new Map<string, number>();
  for (const r of runs) {
    const repo = taskRepoById.get(r.task_id);
    if (!repo) continue; // run against a task not in our closed window
    runsByRepo.set(repo, (runsByRepo.get(repo) ?? 0) + 1);
  }

  const repos = new Set<string>([...closedByRepo.keys(), ...runsByRepo.keys()]);
  return [...repos]
    .map((repo) => ({
      repo,
      closed_count: closedByRepo.get(repo) ?? 0,
      run_count: runsByRepo.get(repo) ?? 0,
    }))
    .sort((a, b) => {
      // Higher total activity first; tie-break alphabetically for stable output.
      const total = (e: DigestRepoEntry) => e.closed_count + e.run_count;
      const diff = total(b) - total(a);
      return diff !== 0 ? diff : a.repo.localeCompare(b.repo);
    });
}

function buildAgentUsage(
  runs: Array<{ agent: string; started_at: string; ended_at: string | null }>,
): DigestAgentUsage[] {
  const byAgent = new Map<
    string,
    { run_count: number; total_duration_ms: number; unfinished_count: number }
  >();
  for (const r of runs) {
    const entry = byAgent.get(r.agent) ?? {
      run_count: 0,
      total_duration_ms: 0,
      unfinished_count: 0,
    };
    entry.run_count += 1;
    if (r.ended_at) {
      const startMs = Date.parse(r.started_at);
      const endMs = Date.parse(r.ended_at);
      // Guard against bad/clock-skew rows: ignore if either parse fails or
      // duration is negative. Better to under-report than poison the total.
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
        entry.total_duration_ms += endMs - startMs;
      }
    } else {
      entry.unfinished_count += 1;
    }
    byAgent.set(r.agent, entry);
  }
  return [...byAgent.entries()]
    .map(([agent, v]) => ({ agent, ...v }))
    .sort((a, b) => {
      // Most runs first, then by total duration, then alphabetic.
      if (b.run_count !== a.run_count) return b.run_count - a.run_count;
      if (b.total_duration_ms !== a.total_duration_ms) {
        return b.total_duration_ms - a.total_duration_ms;
      }
      return a.agent.localeCompare(b.agent);
    });
}

export function formatJson(report: DigestReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatMarkdown(report: DigestReport): string {
  const lines: string[] = [];
  const sinceDay = report.sinceIso.slice(0, 10);
  const untilDay = report.untilIso.slice(0, 10);

  lines.push(`# relay digest — ${sinceDay} to ${untilDay}`);
  lines.push("");
  lines.push(`Window: ${report.since} · generated ${report.generatedAt}`);
  lines.push("");

  // --- Repos worked on -------------------------------------------------
  lines.push("## Repos worked on");
  lines.push("");
  if (report.repos.length === 0) {
    lines.push("_no repos with activity in this window_");
  } else {
    for (const r of report.repos) {
      lines.push(
        `- ${mdSafe(r.repo)} — ${r.closed_count} closed, ${r.run_count} runs`,
      );
    }
  }
  lines.push("");

  // --- Closed tasks (grouped by repo) ----------------------------------
  lines.push("## Closed tasks");
  lines.push("");
  if (report.closed.length === 0) {
    lines.push("_no closed tasks in this window_");
    lines.push("");
  } else {
    const byRepo = new Map<string, DigestClosedTask[]>();
    for (const t of report.closed) {
      const arr = byRepo.get(t.repo) ?? [];
      arr.push(t);
      byRepo.set(t.repo, arr);
    }
    // Use repo order from `report.repos` (activity-ranked) when possible;
    // any repo only present in `closed` lands at the end alphabetically.
    const orderedRepos = orderReposBy(report.repos, byRepo);
    for (const repo of orderedRepos) {
      const tasks = byRepo.get(repo) ?? [];
      if (tasks.length === 0) continue;
      lines.push(`### ${mdSafe(repo)}`);
      for (const t of tasks) {
        const when = t.closed_at ? t.closed_at.slice(0, 10) : "—";
        lines.push(
          `- #${t.id} ${mdSafe(truncate(t.title, 100))} (${mdSafe(t.assignee)}, ${when})`,
        );
      }
      lines.push("");
    }
  }

  // --- Agent usage -----------------------------------------------------
  lines.push("## Agent usage");
  lines.push("");
  if (report.agents.length === 0) {
    lines.push("_no runs in this window_");
  } else {
    for (const a of report.agents) {
      const dur = a.total_duration_ms > 0 ? formatDuration(a.total_duration_ms) : null;
      const parts: string[] = [`${a.run_count} runs`];
      if (dur) parts.push(`${dur} total`);
      if (a.unfinished_count > 0) parts.push(`${a.unfinished_count} unfinished`);
      lines.push(`- ${mdSafe(a.agent)} — ${parts.join(", ")}`);
    }
  }
  lines.push("");

  // --- Context highlights ----------------------------------------------
  lines.push("## Context highlights");
  lines.push("");
  if (report.highlights.length === 0) {
    lines.push("_no context summaries in this window_");
  } else {
    for (const h of report.highlights) {
      const when = h.created_at.slice(0, 10);
      lines.push(`- ${when} ${mdSafe(h.repo)}: ${mdSafe(truncate(h.summary, 200))}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function orderReposBy(
  ranked: DigestRepoEntry[],
  byRepo: Map<string, unknown>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (byRepo.has(r.repo)) {
      out.push(r.repo);
      seen.add(r.repo);
    }
  }
  const leftover = [...byRepo.keys()].filter((r) => !seen.has(r)).sort();
  return [...out, ...leftover];
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
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

/**
 * Minimal Markdown-safety pass: strip newlines (which would break a bullet
 * row) and collapse any pipe / backtick / asterisk that could derail
 * rendering in Slack or GitHub. Aggressive enough to keep output readable;
 * not a full escape — titles never need to round-trip through a parser.
 */
function mdSafe(s: string): string {
  return s
    .replace(/\r?\n+/g, " ")
    .replace(/[`*_|<>]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
