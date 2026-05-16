"use client";

import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import type { RunsByAgentResponse } from "@/lib/types";

export function RunsByAgent({ days = 30 }: { days?: number }) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<RunsByAgentResponse>(
    ["insights.runsByAgent", days],
    () => api.insights.runsByAgent(days),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const rows = (data?.rows ?? []).slice().sort((a, b) => b.total - a.total);
  const max = rows.reduce((acc, r) => Math.max(acc, r.total), 0) || 1;
  const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>{c("page.insights.w13.title")}</CardTitle>
        {!isLoading && !variant && grandTotal > 0 && (
          <span className="text-[11px] tabular text-[var(--color-fg-dim)] font-mono">
            {formatNumber(grandTotal)} runs
          </span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && <div className="h-[180px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && grandTotal === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w13.empty")}</p>
        )}
        {!variant && grandTotal > 0 && (
          <ul
            role="list"
            aria-label={c("page.insights.w13.aria")}
            className="flex flex-col gap-1.5 text-[12px]"
          >
            {rows.map((row) => {
              const pct = Math.min(100, (row.total / max) * 100);
              const failedPct = row.total > 0 ? Math.min(100, (row.failed / max) * 100) : 0;
              const failedShare = row.failed_rate ?? (row.total > 0 ? row.failed / row.total : 0);
              return (
                <li
                  key={row.agent}
                  className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-2"
                >
                  <span className="truncate text-[var(--color-fg-muted)] font-mono" title={row.agent}>
                    {row.agent}
                  </span>
                  <span
                    role="img"
                    aria-label={`${row.agent}: ${row.total} runs, ${row.failed} failed`}
                    className="relative h-2 rounded-full bg-[var(--color-bg-elev)] overflow-hidden"
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)] opacity-80"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                    {row.failed > 0 && (
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-critical)]"
                        style={{ width: `${Math.max(failedPct, 2)}%` }}
                      />
                    )}
                  </span>
                  <span className="tabular text-right text-[var(--color-fg-dim)] font-mono text-[11px]">
                    {formatNumber(row.total)}
                    {row.failed > 0 && (
                      <span className="ml-1 text-[var(--color-critical)]">
                        ·{Math.round(failedShare * 100)}%
                      </span>
                    )}
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
