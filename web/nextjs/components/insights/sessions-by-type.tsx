"use client";

// Per-CLI session volume + total wall-clock time in the rolling window.
// Answers "where am I actually spending my agent budget" — is it Claude
// for 70% of my hours, or has Codex quietly overtaken? Subagents are
// excluded server-side so the duration totals stay close to wall-clock.

import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { SessionsByTypeEntry, SessionsByTypeResponse } from "@/lib/types";

const WINDOW_DAYS = 30;

// Stable hue per CLI so the bar color stays the same across renders and
// matches mental imagery from other surfaces (Hamlet residents, type
// badges).
const TYPE_COLOR: Record<SessionsByTypeEntry["type"], string> = {
  claude: "hsl(28, 70%, 55%)",      // amber — Anthropic accent
  codex: "hsl(140, 55%, 45%)",      // green — OpenAI Codex
  antigravity: "hsl(220, 60%, 60%)",// blue — Gemini / agy
  cursor: "hsl(280, 50%, 60%)",     // purple — Cursor
};

const TYPE_LABEL: Record<SessionsByTypeEntry["type"], string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity",
  cursor: "Cursor",
};

export function SessionsByTypeList() {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<SessionsByTypeResponse>(
    `insights.sessionsByType.${WINDOW_DAYS}`,
    () => api.insights.sessionsByType(WINDOW_DAYS),
    { refreshInterval: 300_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const entries = data?.entries ?? [];
  const totalSeconds = data?.total_seconds ?? 0;
  const totalSessions = data?.total_sessions ?? 0;
  // Bars are scaled to the maximum duration across types so the longest
  // row fills the column — relative use-share reads at a glance.
  const maxSeconds = entries.reduce((m, e) => Math.max(m, e.total_seconds), 0);

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>Session volume by CLI · last {WINDOW_DAYS}d</CardTitle>
        {!isLoading && !variant && data && (
          <span className="text-[11px] tabular font-mono text-[var(--color-fg-dim)]">
            {totalSessions} sessions · {formatDuration(totalSeconds)}
          </span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && <RowsSkeleton />}
        {variant && (
          <PageState
            variant={variant}
            hint="Could not load session volume."
            action={() => mutate()}
          />
        )}
        {!variant && !isLoading && entries.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">
            No top-level sessions in the last {WINDOW_DAYS} days.
          </p>
        )}
        {!variant && entries.length > 0 && (
          <ul className="flex flex-col">
            {entries.map((e) => (
              <TypeRow
                key={e.type}
                entry={e}
                max={maxSeconds}
                totalSeconds={totalSeconds}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function TypeRow({
  entry,
  max,
  totalSeconds,
}: {
  entry: SessionsByTypeEntry;
  max: number;
  totalSeconds: number;
}) {
  const pct = max > 0 ? Math.round((entry.total_seconds / max) * 100) : 0;
  const sharePct =
    totalSeconds > 0 ? Math.round((entry.total_seconds / totalSeconds) * 100) : 0;
  const color = TYPE_COLOR[entry.type];
  const label = TYPE_LABEL[entry.type];
  return (
    <li className="grid grid-cols-[120px_1fr_auto_auto_auto] items-center gap-3 py-1.5 text-[12px] font-mono">
      <span
        className="truncate text-[var(--color-fg)] inline-flex items-center gap-2"
        title={entry.type}
      >
        <span
          aria-hidden
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ background: color }}
        />
        {label}
      </span>
      <div
        className="h-2 rounded-[2px] bg-[var(--color-border)]"
        title={`${entry.session_count} sessions · ${formatDuration(entry.total_seconds)} total · avg ${formatDuration(entry.avg_seconds)}`}
      >
        <div
          className="h-2 rounded-[2px]"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        className="tabular text-[var(--color-fg-muted)] text-right w-[56px]"
        title="sessions in window"
      >
        {entry.session_count}
      </span>
      <span
        className="tabular text-[var(--color-fg)] text-right w-[72px]"
        title={`total wall-clock duration (avg ${formatDuration(entry.avg_seconds)} per session)`}
      >
        {formatDuration(entry.total_seconds)}
      </span>
      <span
        className="tabular text-[10px] text-[var(--color-fg-dim)] text-right w-[36px]"
        title="share of total wall-clock duration"
      >
        {sharePct}%
      </span>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-6 rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />
      ))}
    </div>
  );
}

/**
 * Human-readable duration for a seconds count. Anchored to the largest
 * sensible unit so totals read at a glance (e.g. "3d 14h", "47h 12m",
 * "23m 04s"). Falls back to "0s" for empty buckets.
 */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const s = Math.round(seconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
  return `${secs}s`;
}
