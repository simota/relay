"use client";

import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c, formatNumber, type CopyKey } from "@/lib/copy";
import type { SourceInflowResponse, SourceType } from "@/lib/types";

const MAX_ROWS = 7;

const LABEL_KEY: Partial<Record<SourceType, CopyKey>> = {
  code_todo: "source.codeTasks",
  github_issue: "source.githubIssue",
  github_pr: "source.githubPr",
  gh_notification: "source.ghNotification",
  gh_run_failure: "source.ghRunFailure",
  gh_project_card: "source.ghProjectCard",
  git_interrupted: "source.gitInterrupted",
  git_stash: "source.gitStash",
  orphan_branch: "source.orphanBranch",
  claude_session_todo: "source.claudeSession",
  codex_session_todo: "source.codexSession",
  antigravity_session_todo: "source.antigravitySession",
  cursor_session_todo: "source.cursorSession",
  agents_note: "source.agents",
  manual: "source.manual",
};

function labelFor(source: string): string {
  const key = LABEL_KEY[source as SourceType];
  return key ? c(key) : source;
}

export function SourceInflow() {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<SourceInflowResponse>(
    "insights.sourceInflow.7d",
    () => api.insights.sourceInflow("7d"),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const allRows = data?.rows ?? [];
  const sorted = [...allRows].sort((a, b) => b.curr + b.prev - (a.curr + a.prev));
  const visible = sorted.slice(0, MAX_ROWS);
  const overflow = sorted.slice(MAX_ROWS);
  const otherRow = overflow.length
    ? overflow.reduce(
        (acc, r) => ({ curr: acc.curr + r.curr, prev: acc.prev + r.prev }),
        { curr: 0, prev: 0 },
      )
    : null;
  const rows = otherRow
    ? [
        ...visible,
        {
          source_type: "__other__",
          curr: otherRow.curr,
          prev: otherRow.prev,
          label: c("page.insights.w12.other", { n: overflow.length }),
        },
      ]
    : visible.map((r) => ({ ...r, label: labelFor(r.source_type) }));
  const max = rows.reduce((acc, r) => Math.max(acc, r.curr, r.prev), 0) || 1;
  const total = rows.reduce((acc, r) => acc + r.curr + r.prev, 0);

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>{c("page.insights.w12.title")}</CardTitle>
        <span className="flex items-center gap-2 text-[10px] tabular text-[var(--color-fg-dim)] font-mono">
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-[var(--color-accent)]" />
            {c("page.insights.w12.legend.curr")}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-[var(--color-fg-dim)] opacity-60" />
            {c("page.insights.w12.legend.prev")}
          </span>
        </span>
      </CardHeader>
      <CardBody>
        {isLoading && <div className="h-[180px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && total === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w12.empty")}</p>
        )}
        {!variant && total > 0 && (
          <ul role="list" className="flex flex-col gap-2 text-[12px]">
            {rows.map((row) => {
              const currPct = Math.min(100, (row.curr / max) * 100);
              const prevPct = Math.min(100, (row.prev / max) * 100);
              const label = "label" in row && row.label ? row.label : labelFor(row.source_type);
              return (
                <li key={row.source_type} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2">
                  <span className="truncate text-[var(--color-fg-muted)]" title={label}>
                    {label}
                  </span>
                  <span
                    role="img"
                    aria-label={`${label}: curr ${row.curr}, prev ${row.prev}`}
                    className="flex flex-col gap-1"
                  >
                    <span className="relative h-1.5 rounded-full bg-[var(--color-bg-elev)] overflow-hidden">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)]"
                        style={{ width: `${Math.max(currPct, row.curr > 0 ? 2 : 0)}%` }}
                      />
                    </span>
                    <span className="relative h-1.5 rounded-full bg-[var(--color-bg-elev)] overflow-hidden">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-fg-dim)] opacity-50"
                        style={{ width: `${Math.max(prevPct, row.prev > 0 ? 2 : 0)}%` }}
                      />
                    </span>
                  </span>
                  <span className="tabular text-right text-[var(--color-fg-dim)] font-mono text-[11px]">
                    {formatNumber(row.curr)}
                    <span className="ml-1 opacity-60">/{formatNumber(row.prev)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
