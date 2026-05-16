"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AlertCircle, Check, RefreshCw } from "lucide-react";
import { api, type SyncHistoryRow } from "@/lib/api";
import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMonthDayTime } from "@/lib/copy";
import { cn } from "@/lib/utils";

const HISTORY_LIMIT = 200;

export default function SyncPage() {
  const online = useOnlineStatus();
  const { data, error, mutate, isLoading } = useSWR<SyncHistoryRow[]>(
    "/api/sync/history?limit=200",
    () => api.syncHistory({ limit: HISTORY_LIMIT }),
    { refreshInterval: 30_000 },
  );
  const [running, setRunning] = useState<string | null>(null);
  const adapters = useMemo(() => summarizeAdapters(data ?? []), [data]);
  const stateVariant = stateVariantFromError(error, online);

  const trigger = async (adapter: string) => {
    if (running) return;
    setRunning(adapter);
    try {
      await api.syncAdapter(adapter);
      await mutate();
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Sync Console</h1>
            <p className="text-[12.5px] text-[var(--color-fg-muted)]">Adapter health, recent sync outcomes, and targeted re-sync controls.</p>
          </div>
          <Button size="sm" onClick={() => mutate()} disabled={isLoading}>
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {stateVariant && (
          <PageState
            variant={stateVariant}
            hint={stateVariant === "unauthorized" ? "Sync history requires reconnecting a source." : "Sync history could not be loaded."}
            action={() => mutate()}
          />
        )}

        {!stateVariant && !isLoading && (data ?? []).length === 0 && (
          <PageState variant="empty" hint="No sync history recorded yet. Run a source sync to populate adapter health." />
        )}

        {!stateVariant && (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {adapters.map((adapter) => (
              <Card key={adapter.name}>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>{labelFor(adapter.name)}</CardTitle>
                    <div className="mt-1 text-[15px] font-medium">{adapter.latest ? formatAgo(adapter.latest.ended_at) : "never synced"}</div>
                  </div>
                  <StatusIcon status={adapter.latest?.status} />
                </CardHeader>
                <CardBody className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    <Metric label="7d success" value={`${adapter.successRate}%`} />
                    <Metric label="last count" value={String(adapter.latest?.count ?? 0)} />
                  </div>
                  <div className="min-h-9 rounded-[var(--radius)] bg-[var(--color-bg)] p-2 text-[11.5px] text-[var(--color-fg-muted)]">
                    {adapter.lastError ?? "No recent errors"}
                  </div>
                  <Button size="sm" onClick={() => trigger(adapter.name)} disabled={running !== null}>
                    <RefreshCw className={cn("h-3 w-3", running === adapter.name && "animate-spin")} />
                    {running === adapter.name ? "Syncing" : "Re-sync"}
                  </Button>
                </CardBody>
              </Card>
            ))}
          </section>
        )}

        {!stateVariant && (
          <section>
            <h2 className="mb-2 text-[13px] font-medium">Timeline</h2>
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
              {(data ?? []).map((row) => {
                const isError = row.status === "error";
                return (
                  <div
                    key={row.id}
                    className={cn(
                      "grid grid-cols-[140px_1fr_80px_90px] items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0",
                      isError
                        ? "bg-critical-soft border-l-2 border-l-[var(--color-critical)]"
                        : "bg-[var(--color-bg-elev)]",
                    )}
                  >
                    <span className="tabular text-[11px] text-[var(--color-fg-dim)]">{formatDate(row.ended_at)}</span>
                    <span className="truncate text-[12px]">{labelFor(row.adapter)}</span>
                    <span className={cn("text-[11px] font-medium", row.status === "ok" ? "text-[var(--color-accent)]" : "text-[var(--color-warm)]")}>{row.status}</span>
                    <span className="tabular text-right text-[11px] text-[var(--color-fg-muted)]">{row.count} items</span>
                    {row.error && (
                      <span className="col-span-4 max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-[var(--color-warm)]">
                        {row.error}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function summarizeAdapters(rows: SyncHistoryRow[]) {
  return ADAPTER_ORDER.map((name) => {
    const adapterRows = rows.filter((row) => row.adapter === name);
    const latest = adapterRows[0] ?? null;
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = adapterRows.filter((row) => new Date(row.started_at).getTime() >= since);
    const ok = recent.filter((row) => row.status === "ok").length;
    const successRate = recent.length === 0 ? 0 : Math.round((ok / recent.length) * 100);
    const lastError = adapterRows.find((row) => row.error)?.error ?? null;
    return { name, latest, successRate, lastError };
  });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] bg-[var(--color-bg)] p-2">
      <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)]">{label}</div>
      <div className="tabular text-[13px] text-[var(--color-fg)]">{value}</div>
    </div>
  );
}

function StatusIcon({ status }: { status?: string }) {
  if (status === "ok") return <Check className="h-4 w-4 text-[var(--color-accent)]" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 text-[var(--color-warm)]" />;
  return <RefreshCw className="h-4 w-4 text-[var(--color-fg-dim)]" />;
}

function formatAgo(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "unknown";
  const minutes = Math.max(0, Math.floor(diff / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(value: string): string {
  return formatMonthDayTime(new Date(value));
}

function labelFor(adapter: string): string {
  return ADAPTER_LABELS[adapter] ?? adapter;
}

const ADAPTER_ORDER = ["code_todo", "github_issue", "github_pr", "claude_session_todo", "cursor_session_todo", "agents_note", "manual"];

const ADAPTER_LABELS: Record<string, string> = {
  code_todo: "code tasks",
  github_issue: "GitHub issue",
  github_pr: "GitHub PR",
  claude_session_todo: "Claude session",
  cursor_session_todo: "Cursor session",
  agents_note: ".agents",
  manual: "manual",
};
