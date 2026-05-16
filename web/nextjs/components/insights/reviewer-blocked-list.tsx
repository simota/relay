"use client";

import Link from "next/link";
import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import type { Task } from "@/lib/types";

export function ReviewerBlockedList({ limit = 5 }: { limit?: number }) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<Task[]>(
    ["insights.reviewerBlocked", limit],
    () => api.tasks({ wait_on: "reviewer", source: "github_pr", status: "open", limit }),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const tasks = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{c("page.insights.w11.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {isLoading && (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: limit }).map((_, i) => (
              <div key={i} className="h-4 rounded-[3px] bg-[var(--color-bg-elev)] opacity-50" />
            ))}
          </div>
        )}
        {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
        {!variant && !isLoading && tasks.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w11.empty")}</p>
        )}
        {!variant && tasks.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/tasks/${task.id}`}
                  className="truncate text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                  title={task.title}
                >
                  {task.title}
                </Link>
                <span className="tabular text-[var(--color-fg-dim)] font-mono whitespace-nowrap">
                  {task.repo}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
