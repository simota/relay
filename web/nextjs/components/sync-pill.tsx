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
  const label = locked
    ? "⊘ db locked"
    : summary
      ? `${formatAgo(summary.lastEnded)} · ${summary.okCount} adapters ok`
      : isLoading
        ? "sync status"
        : "sync idle";

  return (
    <div className="relative">
      <button
        type="button"
        popoverTarget="sync-pill-popover"
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius)] px-2.5 text-[12px] font-medium text-[var(--color-bg)] transition-colors ring-focus",
          locked
            ? "bg-[var(--color-bg-elev)] text-[var(--color-fg-muted)] border border-[var(--color-border)]"
            : failed
              ? "bg-[var(--color-warm)]"
              : "bg-[var(--color-accent)]",
        )}
      >
        {locked ? <DatabaseZap className="h-3 w-3" /> : failed ? <AlertCircle className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
        <span className="tabular">{label}</span>
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
        {!locked && summary && (
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
        {!locked && !summary && (
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
