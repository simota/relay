"use client";

// Unfinished Business lane — renders at the top of /repos. Surfaces the
// repos where an AI session was left mid-task with unmet promises (the
// killer feature for /repos: turn "where did I leave the cursor?" into a
// one-glance answer).
//
// Three render states:
//   1. flag off            → onboarding CTA (single banner card)
//   2. flag on, no entries → render nothing (don't pretend there's work)
//   3. flag on, entries    → horizontal scrollable row of resume cards

import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock, ScrollText } from "lucide-react";
import useSWR from "swr";
import { api, type RepoPromiseSummary, type RepoPromiseSummaryResponse } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

export function UnfinishedBusinessLane() {
  const { data } = useSWR<RepoPromiseSummaryResponse>(
    "/api/repos/promise-summary",
    () => api.reposPromiseSummary(),
    {
      refreshInterval: 60_000,
      // Don't retry hard on transient errors — the lane is informational;
      // failing silently is better than spamming logs.
      shouldRetryOnError: false,
    },
  );

  if (!data) {
    return null; // Loading state — repo grid is the primary surface, lane stays out of the way.
  }

  if (!data.flag_enabled) {
    return <FlagOffBanner />;
  }
  if (data.summaries.length === 0) {
    return null; // Flag on, nothing unfinished — a clean morning.
  }

  return (
    <section
      aria-label="Unfinished AI work"
      className="rounded-[var(--radius-lg)] border border-[var(--color-warm)]/40 bg-[var(--color-warm)]/[0.04] px-4 py-3"
    >
      <header className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-warm)]" />
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-warm)]">
          Unfinished business
        </h2>
        <span className="text-[10px] font-mono text-[var(--color-fg-dim)]">
          · {data.summaries.length} repo{data.summaries.length === 1 ? "" : "s"} · last {data.lookback_days}d
        </span>
      </header>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {data.summaries.map((s) => (
          <UnfinishedCard key={`${s.repo}-${s.last_session.id}`} summary={s} />
        ))}
      </div>
    </section>
  );
}

function UnfinishedCard({ summary }: { summary: RepoPromiseSummary }) {
  const s = summary.last_session;
  // Deep-link straight into the session detail tile view. The /sessions
  // page already auto-opens a session when navigated to with a `type` +
  // `id` query, so this keeps the resume action one click.
  const href = `/sessions?type=${encodeURIComponent(s.type)}&id=${encodeURIComponent(s.id)}`;
  return (
    <Link
      href={href}
      className={cn(
        "group shrink-0 w-[280px] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/60",
        "px-3 py-2 flex flex-col gap-1.5 hover:border-[var(--color-warm)]/60 hover:bg-[var(--color-bg-elev)] transition-colors",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-[var(--color-cool)] truncate" title={summary.repo}>
          {summary.repo}
        </span>
        <span className="font-mono tabular text-[9.5px] uppercase tracking-wider px-1.5 py-[1px] rounded-full bg-[var(--color-warm)]/15 text-[var(--color-warm)] border border-[var(--color-warm)]/30">
          {summary.total_unmet} unmet
        </span>
      </div>
      <p
        className="text-[11px] text-[var(--color-fg-muted)] line-clamp-2 leading-snug"
        title={s.title}
      >
        {s.title}
      </p>
      <div className="flex items-center justify-between text-[10px] font-mono text-[var(--color-fg-dim)]">
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo(s.last_active)}
          {summary.total_unfinished_sessions > 1 && (
            <span className="ml-1 text-[var(--color-fg-muted)]">
              · +{summary.total_unfinished_sessions - 1} more
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-0.5 text-[var(--color-fg-muted)] group-hover:text-[var(--color-warm)] transition-colors">
          resume
          <ArrowRight className="w-3 h-3" />
        </span>
      </div>
    </Link>
  );
}

function FlagOffBanner() {
  return (
    <section
      aria-label="Promise Ledger opt-in"
      className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-4 py-3 flex items-center gap-3"
    >
      <ScrollText className="w-4 h-4 text-[var(--color-fg-dim)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold tracking-tight">
          Surface unfinished AI work on this screen
        </div>
        <p className="text-[11px] text-[var(--color-fg-muted)] leading-snug mt-0.5">
          Enable Promise Ledger in <code className="font-mono text-[10.5px]">~/.relay/config.toml</code>
          {" "}— add <code className="font-mono text-[10.5px]">[features]</code> and{" "}
          <code className="font-mono text-[10.5px]">promise_ledger = true</code> to opt in. relay will
          then surface repos where the last AI session was abandoned mid-task.
        </p>
      </div>
    </section>
  );
}
