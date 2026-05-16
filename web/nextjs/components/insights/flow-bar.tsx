"use client";

import useSWR from "swr";

import { DivergingDailyBar } from "@/components/ui/diverging-bar";
import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import type { FlowTimeseriesResponse } from "@/lib/types";

export function FlowBar({ days = 30 }: { days?: number }) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<FlowTimeseriesResponse>(
    ["insights.flow", days],
    () => api.insights.flowTimeseries(days),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const rows = data?.days ?? [];
  const totalOpened = rows.reduce((acc, r) => acc + r.opened, 0);
  const totalClosed = rows.reduce((acc, r) => acc + r.closed, 0);

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>{c("page.insights.w09.title")}</CardTitle>
        {!isLoading && !variant && rows.length > 0 && (
          <span className="text-[11px] tabular text-[var(--color-fg-dim)] font-mono">
            +{totalOpened} / -{totalClosed}
          </span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && <div className="h-[140px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && rows.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w09.empty")}</p>
        )}
        {!variant && rows.length > 0 && (
          <div className="space-y-2">
            <DivergingDailyBar data={rows} />
            <div className="flex items-center justify-between text-[10px] font-mono text-[var(--color-fg-dim)]">
              <span>{rows[0]?.day}</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-[var(--color-warm)]" /> opened
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-[var(--color-accent)]" /> closed
                </span>
              </span>
              <span>{rows[rows.length - 1]?.day}</span>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
