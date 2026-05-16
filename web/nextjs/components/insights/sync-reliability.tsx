"use client";

import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import type { SyncReliabilityResponse, SyncReliabilityStatus } from "@/lib/types";

const STATUS_COLOR: Record<SyncReliabilityStatus, string> = {
  ok: "var(--color-accent)",
  partial: "var(--color-warm)",
  error: "var(--color-critical)",
  none: "var(--color-fg-dim)",
};

const STATUS_OPACITY: Record<SyncReliabilityStatus, number> = {
  ok: 0.85,
  partial: 0.85,
  error: 0.9,
  none: 0.25,
};

const STATUS_LABELS: ReadonlyArray<SyncReliabilityStatus> = ["ok", "partial", "error", "none"];

function legendKey(status: SyncReliabilityStatus) {
  switch (status) {
    case "ok":
      return c("page.insights.w14.legend.ok");
    case "partial":
      return c("page.insights.w14.legend.partial");
    case "error":
      return c("page.insights.w14.legend.error");
    case "none":
      return c("page.insights.w14.legend.none");
  }
}

export function SyncReliability({ days = 7 }: { days?: number }) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<SyncReliabilityResponse>(
    ["insights.syncReliability", days],
    () => api.insights.syncReliability(days),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const adapters = data?.adapters ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>{c("page.insights.w14.title")}</CardTitle>
        <span className="flex flex-wrap items-center gap-3 text-[10px] tabular text-[var(--color-fg-dim)] font-mono">
          {STATUS_LABELS.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: STATUS_COLOR[s], opacity: STATUS_OPACITY[s] }}
              />
              {legendKey(s)}
            </span>
          ))}
        </span>
      </CardHeader>
      <CardBody>
        {isLoading && <div className="h-[140px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && adapters.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w14.empty")}</p>
        )}
        {!variant && adapters.length > 0 && (
          <div
            role="img"
            aria-label={c("page.insights.w14.aria")}
            className="flex flex-col gap-1.5"
          >
            {adapters.map((adapter) => (
              <div
                key={adapter.adapter}
                className="grid grid-cols-[10rem_1fr] items-center gap-3 text-[12px]"
              >
                <span
                  className="truncate text-[var(--color-fg-muted)] font-mono"
                  title={adapter.adapter}
                >
                  {adapter.adapter}
                </span>
                <span className="flex items-center gap-1">
                  {adapter.cells.map((cell) => (
                    <span
                      key={cell.day}
                      title={`${cell.day} · ${cell.status} · ${cell.count}`}
                      className="h-4 w-4 rounded-[3px] flex-shrink-0"
                      style={{
                        backgroundColor: STATUS_COLOR[cell.status],
                        opacity: STATUS_OPACITY[cell.status],
                      }}
                    />
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
