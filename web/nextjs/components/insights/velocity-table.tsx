"use client";

import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { VelocityResponse } from "@/lib/types";

export function VelocityTable({ weeks = 4 }: { weeks?: number }) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<VelocityResponse>(
    ["insights.velocity", weeks],
    () => api.insights.velocity(weeks),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>Velocity per repo</CardTitle>
        {!isLoading && !variant && rows.length > 0 && (
          <span className="text-[11px] tabular font-mono text-[var(--color-fg-dim)]">
            last {weeks}w
          </span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && <ListSkeleton rows={5} />}
        {variant && (
          <PageState variant={variant} hint="Could not load velocity data." action={() => mutate()} />
        )}
        {!variant && !isLoading && rows.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">
            No closed tasks in this window.
          </p>
        )}
        {!variant && rows.length > 0 && (
          <div className="max-h-[160px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[var(--color-fg-dim)]">
                  <th className="pb-1.5 text-left font-medium">Repo</th>
                  <th className="pb-1.5 text-right font-medium">Closed</th>
                  <th className="pb-1.5 text-right font-medium">Avg days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map((row) => (
                  <tr key={row.repo} className="hover:bg-[var(--color-bg-elev)] transition-colors">
                    <td className="py-1 pr-2 font-mono text-[var(--color-fg)] truncate max-w-[180px]" title={row.repo}>
                      {row.repo}
                    </td>
                    <td className="py-1 text-right tabular text-[var(--color-accent)] font-semibold">
                      {row.closed}
                    </td>
                    <td className="py-1 pl-4 text-right tabular text-[var(--color-fg-muted)]">
                      {row.avg_lifetime_days.toFixed(1)}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded-[3px] bg-[var(--color-bg-elev)] opacity-50" />
      ))}
    </div>
  );
}
