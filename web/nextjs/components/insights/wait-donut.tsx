"use client";

import useSWR from "swr";

import { Donut } from "@/components/ui/donut";
import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c, formatNumber, type CopyKey } from "@/lib/copy";
import type { WaitMixResponse, WaitOnSegment } from "@/lib/types";

const SEGMENT_COLOR: Record<WaitOnSegment, string> = {
  self: "var(--color-accent)",
  reviewer: "var(--color-warm)",
  external: "var(--color-critical)",
  scheduled: "var(--color-cool)",
};

const LABEL_KEY: Record<WaitOnSegment, CopyKey> = {
  self: "page.insights.wait.self",
  reviewer: "page.insights.wait.reviewer",
  external: "page.insights.wait.external",
  scheduled: "page.insights.wait.scheduled",
};

export function WaitDonut() {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<WaitMixResponse>(
    "insights.waitMix",
    () => api.insights.waitMix(),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const segments = (data?.mix ?? []).map((s) => ({
    label: c(LABEL_KEY[s.wait_on]),
    value: s.n,
    color: SEGMENT_COLOR[s.wait_on],
    key: s.wait_on,
  }));
  const total = data?.total ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{c("page.insights.w10.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {isLoading && <div className="h-[160px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && total === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w10.empty")}</p>
        )}
        {!variant && total > 0 && (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
            <Donut
              segments={segments}
              centerLabel={formatNumber(total)}
              centerHint="total"
              ariaLabel="Wait-on segment breakdown"
            />
            <ul className="flex-1 space-y-1 text-[12px] w-full">
              {segments.map((s) => (
                <li key={s.key} className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-[var(--color-fg-muted)]">{s.label}</span>
                  </span>
                  <span className="tabular text-[var(--color-fg-dim)]">
                    {formatNumber(s.value)} ({Math.round((s.value / total) * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
