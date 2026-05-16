"use client";

import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import type { ContextFreshnessResponse } from "@/lib/types";

const STALE_THRESHOLD_DAYS = 14;
const NEVER_VALUE = 999;

export function ContextFreshness({ limit = 30 }: { limit?: number }) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<ContextFreshnessResponse>(
    ["insights.contextFreshness", limit],
    () => api.insights.contextFreshness(limit),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const repos = (data?.repos ?? []).slice().sort((a, b) => {
    const aVal = a.days_since_ctx ?? NEVER_VALUE;
    const bVal = b.days_since_ctx ?? NEVER_VALUE;
    return bVal - aVal;
  });
  const max =
    repos.reduce(
      (acc, r) => Math.max(acc, r.days_since_ctx ?? STALE_THRESHOLD_DAYS),
      STALE_THRESHOLD_DAYS,
    ) || STALE_THRESHOLD_DAYS;
  const visible = repos.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{c("page.insights.w16.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {isLoading && <div className="h-[180px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && repos.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w16.empty")}</p>
        )}
        {!variant && visible.length > 0 && (
          <ul role="list" className="flex flex-col gap-1.5 text-[12px]">
            {visible.map((row) => {
              const isNever = row.days_since_ctx === null;
              const days = isNever ? NEVER_VALUE : row.days_since_ctx ?? 0;
              const isStale = isNever || days >= STALE_THRESHOLD_DAYS;
              const pct = isNever ? 100 : Math.min(100, (days / max) * 100);
              const color = isStale ? "var(--color-warm)" : "var(--color-accent)";
              const valueLabel = isNever
                ? c("page.insights.w16.never")
                : `${days}${c("page.insights.w16.unit")}`;
              return (
                <li
                  key={row.repo}
                  className="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-2"
                >
                  <span className="truncate text-[var(--color-fg-muted)] font-mono" title={row.repo}>
                    {row.repo}
                  </span>
                  <span
                    role="img"
                    aria-label={`${row.repo}: ${valueLabel}, ${row.open_n} open`}
                    className="relative h-2 rounded-full bg-[var(--color-bg-elev)] overflow-hidden"
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-full opacity-80"
                      style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                    />
                  </span>
                  <span className="tabular text-right text-[var(--color-fg-dim)] font-mono text-[11px]">
                    {valueLabel}
                    <span className="ml-1 opacity-60">·{row.open_n}</span>
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
