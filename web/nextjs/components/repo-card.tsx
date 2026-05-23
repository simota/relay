"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, GitBranch, Github, GitPullRequest, NotebookPen } from "lucide-react";
import { c, formatNumber } from "@/lib/copy";
import { cn, timeAgo } from "@/lib/utils";
import type { RepoStat } from "@/lib/types";

/**
 * Per-card hook for the Unfinished Business surface. When provided, the
 * card renders a small amber chip near the timestamp so a user scanning
 * the grid (rather than the lane) still sees which repos have abandoned
 * AI work. The chip is intentionally compact — the lane is the primary
 * surface, the chip is the in-grid echo.
 */
export interface RepoCardUnfinished {
  unmetCount: number;
  unfinishedSessions: number;
}

/**
 * Per-card `.agents/*.md` journal signal. Surfaces the agents writing in
 * this repo and the count of dated entries within the lookback window —
 * the killer information the agents_note adapter throws away because it
 * only ingests GitHub-style checkboxes (a tiny subset of how users
 * actually populate `.agents/`).
 */
export interface RepoCardJournal {
  fileCount: number;
  /** Filename stems sorted by recent activity (already capped server-side at 8). */
  agents: string[];
  recentEntries: number;
  lookbackDays: number;
}

export function RepoCard({
  repo,
  scale,
  unfinished,
  journal,
}: {
  repo: RepoStat;
  scale: number;
  unfinished?: RepoCardUnfinished;
  journal?: RepoCardJournal;
}) {
  const total = repo.open + repo.in_progress;
  const pct = (total / Math.max(1, scale)) * 100;
  const dailyEventCounts = normalizeDailyEventCounts(repo.dailyEventCounts);
  const inactive7d = dailyEventCounts.slice(-7).every((n) => n === 0);
  const missing = repo.exists === false;
  const cardContent = (
    <div
      className={cn(
        "group rounded-[var(--radius-lg)] border bg-[var(--color-bg-elev)]/40 p-4 transition-colors",
        missing
          ? "border-[var(--color-warm)]/30 opacity-70 cursor-not-allowed"
          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-elev)]/70 cursor-pointer",
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0 flex items-center gap-2">
          <span
            className={cn(
              "font-mono text-[13px] truncate flex items-center gap-1.5 group-hover:underline",
              missing ? "text-[var(--color-fg-muted)] line-through decoration-[var(--color-warm)]/60" : "text-[var(--color-cool)]",
              inactive7d && !missing && "opacity-60",
            )}
          >
            {repo.name}
            <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
          {missing && (
            <span
              className="shrink-0 rounded-full border border-[var(--color-warm)]/40 bg-[var(--color-warm)]/10 px-1.5 py-[1px] text-[9px] font-mono text-[var(--color-warm)] uppercase tracking-wider"
              title="Directory not found under scan.roots. Use `relay prune --missing-repos` to clean up."
            >
              missing
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {unfinished && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-[var(--color-warm)]/15 text-[var(--color-warm)] border border-[var(--color-warm)]/30 text-[9.5px] font-mono uppercase tracking-wider"
              title={`${unfinished.unmetCount} unmet promise${unfinished.unmetCount === 1 ? "" : "s"} across ${unfinished.unfinishedSessions} unfinished AI session${unfinished.unfinishedSessions === 1 ? "" : "s"}`}
              onClick={(e) => e.stopPropagation()}
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              {unfinished.unmetCount}
            </span>
          )}
          <span className="text-[10px] text-[var(--color-fg-dim)] font-mono">{timeAgo(repo.lastTouched)}</span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div className="grid grid-cols-3 gap-2 flex-1 min-w-0">
          <Stat label={c("repos.stat.open")} n={repo.open} tone="default" />
          <Stat label={c("repos.stat.active")} n={repo.in_progress} tone="accent" />
          <Stat label={c("repos.stat.snooze")} n={repo.snoozed} tone="warm" />
        </div>
        <RepoSparkline counts={dailyEventCounts} />
      </div>
      {journal && <JournalRow journal={journal} />}
      <RemoteFooter repo={repo} />
      <div className="h-1 rounded-full bg-[var(--color-bg)] overflow-hidden">
        <div
          className="h-full w-full origin-left bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-cool)] transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)]"
          style={{ transform: `scaleX(${Math.max(0, Math.min(1, pct / 100))})` }}
        />
      </div>
    </div>
  );

  if (missing) {
    return cardContent;
  }

  return (
    <Link
      href={`/repos/detail?name=${encodeURIComponent(repo.name)}`}
      className="block"
    >
      {cardContent}
    </Link>
  );
}

function JournalRow({ journal }: { journal: RepoCardJournal }) {
  // Show up to 3 agent names inline; the rest collapse into "+N" so the
  // chip stays a single line on a 260px card. file_count carries the
  // long-tail size in the tooltip.
  const visible = journal.agents.slice(0, 3);
  const overflow = journal.agents.length - visible.length;
  const tooltip = `${journal.fileCount} .agents/*.md files · ${journal.agents.length} agents present (${journal.agents.join(", ")})`;
  return (
    <div
      className="mb-2 flex items-center gap-1.5 text-[10px] font-mono text-[var(--color-fg-dim)]"
      title={tooltip}
      onClick={(e) => e.stopPropagation()}
    >
      <NotebookPen className="h-3 w-3 shrink-0 text-[var(--color-fg-muted)]" />
      {visible.length > 0 ? (
        <span className="truncate min-w-0">
          {visible.map((a, i) => (
            <span key={a}>
              {i > 0 && <span className="text-[var(--color-fg-dim)]">·</span>}
              <span className="text-[var(--color-fg-muted)]">{a}</span>
            </span>
          ))}
          {overflow > 0 && (
            <span className="text-[var(--color-fg-dim)]">+{overflow}</span>
          )}
        </span>
      ) : (
        <span className="text-[var(--color-fg-muted)]">{formatNumber(journal.fileCount)} files</span>
      )}
      <span className="ml-auto tabular text-[var(--color-fg-muted)]">
        {formatNumber(journal.recentEntries)}/{journal.lookbackDays}d
      </span>
    </div>
  );
}

function RemoteFooter({ repo }: { repo: RepoStat }) {
  const ghShort = repo.github_url
    ? repo.github_url.replace(/^https:\/\/github\.com\//, "")
    : null;
  const lastCommitAge = repo.last_commit_at ? timeAgo(repo.last_commit_at) : null;
  const hasAny = ghShort || repo.default_branch || lastCommitAge || (repo.my_open_prs ?? 0) > 0;
  if (!hasAny) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono text-[var(--color-fg-dim)]">
      {ghShort && (
        <span
          className="inline-flex items-center gap-1 max-w-full truncate hover:text-[var(--color-fg)]"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (repo.github_url) window.open(repo.github_url, "_blank", "noopener,noreferrer");
          }}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" && repo.github_url) {
              e.preventDefault();
              window.open(repo.github_url, "_blank", "noopener,noreferrer");
            }
          }}
          title={repo.github_url ?? undefined}
        >
          <Github className="h-3 w-3 shrink-0" />
          <span className="truncate">{ghShort}</span>
        </span>
      )}
      {repo.default_branch && (
        <span className="inline-flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {repo.default_branch}
        </span>
      )}
      {lastCommitAge && repo.last_commit_sha && (
        <span className="inline-flex items-center gap-1" title={`commit ${repo.last_commit_sha}`}>
          <span className="font-mono">{repo.last_commit_sha.slice(0, 7)}</span>
          <span>·</span>
          <span>{lastCommitAge}</span>
        </span>
      )}
      {(repo.my_open_prs ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1" title="open github_pr tasks (assigned to or authored by you)">
          <GitPullRequest className="h-3 w-3" />
          {formatNumber(repo.my_open_prs ?? 0)} PR
        </span>
      )}
    </div>
  );
}

function normalizeDailyEventCounts(counts: number[] | undefined): number[] {
  const normalized = counts?.slice(-14) ?? [];
  while (normalized.length < 14) normalized.unshift(0);
  return normalized.map((n) => Math.max(0, n));
}

function RepoSparkline({ counts }: { counts: number[] }) {
  const width = 60;
  const height = 24;
  const gap = 1;
  const barWidth = 3;
  const max = Math.max(1, ...counts);

  return (
    <svg
      className="shrink-0 text-[var(--color-fg-muted)]"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={c("repos.activity14d", { counts: counts.map(formatNumber).join(", ") })}
    >
      {counts.map((count, i) => {
        const barHeight = count === 0 ? 1 : Math.max(2, Math.round((count / max) * height));
        const x = i * (barWidth + gap) + 2;
        const y = height - barHeight;
        return (
          <rect
            key={`${i}-${count}`}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx="1"
            fill={i === counts.length - 1 ? "var(--color-accent)" : "var(--color-fg-muted)"}
          />
        );
      })}
    </svg>
  );
}

function Stat({ label, n, tone }: { label: string; n: number; tone: "default" | "accent" | "warm" }) {
  const color = tone === "accent"
    ? "text-[var(--color-accent)]"
    : tone === "warm"
      ? "text-[var(--color-warm)]"
      : "text-[var(--color-fg)]";
  return (
    <div>
      <div className={cn("tabular text-[16px] font-semibold", color)}>{formatNumber(n)}</div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">{label}</div>
    </div>
  );
}
