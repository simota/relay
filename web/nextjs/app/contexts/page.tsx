"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { ContextItem } from "@/components/context-item";
import { Input } from "@/components/ui/input";
import { PageState } from "@/components/page-state";
import { c, formatNumber } from "@/lib/copy";
import type { RelayContext } from "@/lib/types";

export default function ContextsPage() {
  const { data: contexts = [] } = useSWR<RelayContext[]>(
    "/api/contexts?limit=100",
    () => api.contexts(undefined, 100),
  );
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return contexts;
    const q = filter.toLowerCase();
    return contexts.filter(
      (c) =>
        c.repo.toLowerCase().includes(q) ||
        c.branch.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q),
    );
  }, [filter, contexts]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6 space-y-5 max-w-[900px]">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">{c("contexts.title")}</h1>
            <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
              {c("contexts.subtitle", {
                count: formatNumber(contexts.length),
                noun: contexts.length === 1 ? c("common.savedSnapshot.noun.one") : c("common.savedSnapshot.noun.many"),
              })}
            </p>
          </div>
          <Input
            placeholder={c("contexts.filter")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-[240px] font-mono"
          />
        </div>

        <div className="relative">
          {filtered.length === 0 ? (
            <PageState
              variant="empty"
              title={
                contexts.length === 0
                  ? c("page.contexts.emptyTitle")
                  : c("contexts.noMatch", { filter })
              }
              hint={
                contexts.length === 0
                  ? c("page.contexts.emptyHint")
                  : c("page.tasks.emptyHint")
              }
            />
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/40 divide-y divide-[var(--color-border)]/60">
              {filtered.map((c, i) => (
                <ContextItem key={c.hash} ctx={c} isLast={i === filtered.length - 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
