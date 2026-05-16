"use client";

import Link from "next/link";
import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import type { OrphansResponse } from "@/lib/types";

interface OrphansTableProps {
  age?: number;
  limit?: number;
}

export function OrphansTable({ age = 30, limit = 20 }: OrphansTableProps) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<OrphansResponse>(
    ["insights.orphans", age, limit],
    () => api.insights.orphans(age, limit),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const rows = data?.rows ?? [];
  const ageDays = data?.age_days ?? age;

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>{c("page.insights.section6Title")}</CardTitle>
        {!isLoading && !variant && rows.length > 0 && (
          <span className="text-[11px] tabular text-[var(--color-fg-dim)] font-mono">
            {c("page.insights.w17.subtitle", { age: ageDays, limit })}
          </span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-5 rounded-[3px] bg-[var(--color-bg-elev)] opacity-50" />
            ))}
          </div>
        )}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && rows.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w17.empty")}</p>
        )}
        {!variant && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
                  <th className="py-1 pr-3 font-mono">{c("page.insights.w17.col.id")}</th>
                  <th className="py-1 pr-3">{c("page.insights.w17.col.repo")}</th>
                  <th className="py-1 pr-3">{c("page.insights.w17.col.title")}</th>
                  <th className="py-1 pr-3 text-right">{c("page.insights.w17.col.priority")}</th>
                  <th className="py-1 pr-0 text-right">{c("page.insights.w17.col.age")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-[var(--color-border)]/60 hover:bg-[var(--color-bg-elev)]/40"
                  >
                    <td className="py-1.5 pr-3 font-mono text-[var(--color-fg-dim)]">{row.id}</td>
                    <td className="py-1.5 pr-3 font-mono text-[var(--color-fg-muted)] truncate max-w-[12rem]">
                      {row.repo}
                    </td>
                    <td className="py-1.5 pr-3 max-w-0">
                      <Link
                        href={`/tasks/${row.id}`}
                        className="block truncate text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                        title={row.title}
                      >
                        {row.title}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[var(--color-fg-dim)]">{row.priority}</td>
                    <td className="py-1.5 pr-0 text-right text-[var(--color-warm)] font-mono">
                      {c("page.insights.w17.ageDays", { n: row.days_since_updated })}
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
