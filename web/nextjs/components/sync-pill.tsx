"use client";

import Link from "next/link";
import useSWR from "swr";
import { Activity, AlertCircle, Check, DatabaseZap, RefreshCw } from "lucide-react";
import { api, type SyncHistoryRow } from "@/lib/api";
import { cn } from "@/lib/utils";

const LIMIT = 100;

export function SyncPill() {
  const { data, error, isLoading } = useSWR<SyncHistoryRow[]>(
    "/api/sync/history?limit=100",
    () => api.syncHistory({ limit: LIMIT }),
    { refreshInterval: 30_000 },
  );

  const locked = error instanceof Error && error.message.toLowerCase().includes("db locked");
  const summary = data ? summarize(data) : null;
  const failed = Boolean(summary?.failed.length);
  // No recorded run yet, or history could not be loaded: show a neutral
  // pill instead of the green "all ok" state, which would claim a success
  // that never happened.
  const neverSynced = summary !== null && summary.adapters.length === 0;
  const unavailable = !locked && !summary && !isLoading && error !== undefined;
  const neutral = locked || neverSynced || unavailable || (!summary && isLoading);
  const label = locked
    ? "⊘ db locked"
    : neverSynced
      ? "never synced"
      : summary
        ? `${formatAgo(summary.lastEnded)} · ${summary.okCount} adapters ok`
        : unavailable
          ? "sync status unavailable"
          : "sync status";

  return (
    <div className="relative">
      <button
        type="button"
        popoverTarget="sync-pill-popover"
        aria-label={label}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius)] px-2.5 text-[12px] font-medium text-[var(--color-bg)] transition-colors ring-focus",
          neutral
            ? "bg-[var(--color-bg-elev)] text-[var(--color-fg-muted)] border border-[var(--color-border)]"
            : failed
              ? "bg-[var(--color-warm)]"
              : "bg-[var(--color-accent)]",
        )}
      >
        {locked ? <DatabaseZap className="h-3 w-3" aria-hidden /> : failed || unavailable ? <AlertCircle className="h-3 w-3" aria-hidden /> : <Activity className="h-3 w-3" aria-hidden />}
        <span className="tabular hidden sm:inline">{label}</span>
      </button>

      <div
        id="sync-pill-popover"
        popover="auto"
        className="m-0 w-[360px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-[var(--color-fg)] shadow-[var(--shadow-pop)]"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium">Sync adapters</div>
            <div className="text-[10.5px] text-[var(--color-fg-dim)]">Latest recorded result per adapter</div>
          </div>
          <Link href="/sync" className="text-[11px] font-medium text-[var(--color-accent)] hover:underline">
            Console
          </Link>
        </div>
        {locked && <div className="rounded-[var(--radius)] border border-[var(--color-border)] p-2 text-[12px] text-[var(--color-fg-muted)]">Database is locked. Try again after the current write finishes.</div>}
        {neverSynced && (
          <div className="text-[12px] text-[var(--color-fg-muted)]">
            No sync has run yet. Press <span className="font-medium text-[var(--color-fg)]">sync</span> (⇧R) to ingest tasks from your sources.
          </div>
        )}
        {unavailable && (
          <div className="text-[12px] text-[var(--color-fg-muted)]">
            Could not load sync history{error instanceof Error ? `: ${error.message}` : ""}. It will retry automatically.
          </div>
        )}
        {!locked && summary && !neverSynced && (
          <div className="space-y-1.5">
            {summary.adapters.map((row) => (
              <div key={row.adapter} className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--color-bg)] px-2 py-1.5">
                {row.status === "ok" ? <Check className="h-3 w-3 text-[var(--color-accent)]" /> : <AlertCircle className="h-3 w-3 text-[var(--color-warm)]" />}
                <span className="flex-1 truncate text-[12px]">{labelFor(row.adapter)}</span>
                <span className="tabular text-[10.5px] text-[var(--color-fg-dim)]">{formatAgo(row.ended_at)}</span>
              </div>
            ))}
          </div>
        )}
        {!locked && !summary && !unavailable && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Loading sync history
          </div>
        )}
      </div>
    </div>
  );
}

function summarize(rows: SyncHistoryRow[]) {
  const latest = new Map<string, SyncHistoryRow>();
  for (const row of rows) {
    if (!latest.has(row.adapter)) latest.set(row.adapter, row);
  }
  const adapters = Array.from(latest.values()).sort((a, b) => a.adapter.localeCompare(b.adapter));
  const failed = adapters.filter((row) => row.status !== "ok");
  const lastEnded = rows[0]?.ended_at ?? null;
  return { adapters, failed, lastEnded, okCount: adapters.length - failed.length };
}

function formatAgo(value: string | null): string {
  if (!value) return "never";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "unknown";
  const minutes = Math.max(0, Math.floor(diff / 60_000));
  if (minutes < 1) return "synced now";
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `synced ${hours}h ago`;
  return `synced ${Math.floor(hours / 24)}d ago`;
}

function labelFor(adapter: string): string {
  return ADAPTER_LABELS[adapter] ?? adapter;
}

const ADAPTER_LABELS: Record<string, string> = {
  code_todo: "code TODO",
  github_issue: "GitHub issue",
  github_pr: "GitHub PR",
  claude_session_todo: "Claude session",
  agents_note: ".agents",
  manual: "manual",
};
