"use client";

import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import type { AgeHistogramResponse } from "@/lib/types";

export function AgeHistogram() {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<AgeHistogramResponse>(
    "insights.ageHistogram",
    () => api.insights.ageHistogram(),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const buckets = data?.buckets ?? [];
  const max = buckets.reduce((acc, b) => Math.max(acc, b.n), 0) || 1;
  const total = buckets.reduce((acc, b) => acc + b.n, 0);

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>{c("page.insights.w15.title")}</CardTitle>
        {!isLoading && !variant && total > 0 && (
          <span className="text-[11px] tabular text-[var(--color-fg-dim)] font-mono">{formatNumber(total)} open</span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && <div className="h-[140px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && total === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w15.empty")}</p>
        )}
        {!variant && total > 0 && (
          <div
            role="img"
            aria-label={c("page.insights.w15.aria")}
            className="grid grid-cols-6 items-end gap-2"
            style={{ height: 140 }}
          >
            {buckets.map((b) => {
              const pct = (b.n / max) * 100;
              return (
                <div key={b.bucket} className="flex h-full flex-col items-center justify-end gap-1">
                  <span className="text-[10px] tabular text-[var(--color-fg-dim)]">{b.n}</span>
                  <span
                    className="w-full rounded-sm bg-[var(--color-accent)] opacity-80"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                    title={`${b.bucket}: ${b.n}`}
                  />
                  <span className="text-[10px] font-mono text-[var(--color-fg-muted)]">{b.bucket}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
