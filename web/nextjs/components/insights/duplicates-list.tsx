"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { DuplicatesResponse } from "@/lib/types";

export function DuplicatesList() {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<DuplicatesResponse>(
    "insights.duplicates",
    () => api.insights.duplicates(),
    { refreshInterval: 300_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const clusters = data?.clusters ?? [];
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const { mutate: globalMutate } = useSWRConfig();

  // Keep `keepId`, merge the rest of its cluster into it.
  async function merge(clusterTasks: Array<{ id: number }>, keepId: number) {
    const others = clusterTasks.map((t) => t.id).filter((id) => id !== keepId);
    if (others.length === 0) return;
    setMerging(keepId);
    setNotice(null);
    try {
      const result = await api.mergeTasks(keepId, others);
      setNotice({
        tone: "ok",
        text: `merged ${result.merged.map((id) => `#${id}`).join(", ")} into #${result.keep} · ⌘Z reverts`,
      });
      await Promise.all([
        mutate(),
        globalMutate(
          (key) =>
            typeof key === "string" &&
            (key.startsWith("/api/tasks") || key.startsWith("/api/today") || key.startsWith("/api/counts")),
        ),
      ]);
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "merge failed" });
    } finally {
      setMerging(null);
    }
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>Possible duplicates</CardTitle>
        {!isLoading && !variant && clusters.length > 0 && (
          <span className="text-[11px] tabular font-mono text-[var(--color-fg-dim)]">
            {clusters.length} cluster{clusters.length !== 1 ? "s" : ""}
          </span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && <ClusterSkeleton />}
        {variant && (
          <PageState
            variant={variant}
            hint="Could not load duplicate detection data."
            action={() => mutate()}
          />
        )}
        {!variant && !isLoading && clusters.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">
            No near-duplicate open tasks detected.
          </p>
        )}
        {notice && (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={`mb-2 text-[11.5px] ${notice.tone === "error" ? "text-[var(--color-critical)]" : "text-[var(--color-fg-muted)]"}`}
          >
            {notice.text}
          </p>
        )}
        {!variant && clusters.length > 0 && (
          <ul className="flex flex-col gap-2">
            {clusters.map((cluster) => {
              const isOpen = expanded.has(cluster.id);
              const sample = cluster.tasks[0];
              return (
                <li
                  key={cluster.id}
                  className="rounded-[var(--radius)] border border-[var(--color-border)] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggle(cluster.id)}
                    className="w-full flex items-center justify-between px-3 py-2 text-[12px] text-left hover:bg-[var(--color-bg-elev)] transition-colors"
                    aria-expanded={isOpen}
                  >
                    <span className="truncate font-mono text-[var(--color-fg)]" title={sample?.title}>
                      {sample?.title ?? "(untitled)"}
                    </span>
                    <span className="ml-2 flex-shrink-0 flex items-center gap-2 text-[var(--color-fg-dim)]">
                      <span className="rounded-full bg-[var(--color-warm)] bg-opacity-20 px-1.5 text-[10px] font-mono text-[var(--color-warm)]">
                        {cluster.tasks.length}
                      </span>
                      <span className="text-[10px]">{isOpen ? "▲" : "▼"}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)] bg-[var(--color-bg-elev)]">
                      {cluster.tasks.map((task) => (
                        <li key={task.id} className="px-3 py-1.5 flex items-baseline gap-2 text-[11px]">
                          <Link
                            href={`/tasks/${task.id}`}
                            className="truncate font-mono text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                            title={task.title}
                          >
                            {task.title}
                          </Link>
                          <span className="flex-shrink-0 text-[var(--color-fg-dim)]">
                            {task.repo}
                          </span>
                          <span className="flex-shrink-0 text-[var(--color-fg-dim)] opacity-60">
                            {task.source_type}
                          </span>
                          <button
                            type="button"
                            disabled={merging !== null}
                            onClick={() => { void merge(cluster.tasks, task.id); }}
                            title={`Keep #${task.id}; close the other ${cluster.tasks.length - 1} and move their tags, dependencies and notes onto it`}
                            className="ml-auto flex-shrink-0 rounded-[var(--radius)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-cool)] hover:bg-[var(--color-bg)] hover:underline disabled:opacity-50 ring-focus"
                          >
                            {merging === task.id ? "merging…" : "keep this, merge others"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function ClusterSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-8 rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />
      ))}
    </div>
  );
}
