"use client";

import Link from "next/link";
import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import type { NewlyActiveResponse } from "@/lib/types";

export function NewlyActiveList() {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<NewlyActiveResponse>(
    "insights.newlyActive.14d",
    () => api.insights.newlyActive("14d"),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const repos = data?.repos ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{c("page.insights.w08.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {isLoading && (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-4 rounded-[3px] bg-[var(--color-bg-elev)] opacity-50" />
            ))}
          </div>
        )}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && repos.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w08.empty")}</p>
        )}
        {!variant && repos.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {repos.map((row) => (
              <li key={row.repo} className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/tasks?repo=${encodeURIComponent(row.repo)}`}
                  className="truncate font-mono text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                  title={row.repo}
                >
                  {row.repo}
                </Link>
                <span className="tabular text-[var(--color-fg-dim)] whitespace-nowrap">
                  {c("page.insights.w08.item", { n: row.new_tasks })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
