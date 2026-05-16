"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, type ContextGraphData } from "@/lib/api";
import { ContextGraph } from "@/components/context-graph";
import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Input } from "@/components/ui/input";

export default function ContextGraphPage() {
  const online = useOnlineStatus();
  const [repo, setRepo] = useState("");
  const activeRepo = repo.trim();
  const key = activeRepo
    ? `/api/contexts/graph?repo=${encodeURIComponent(activeRepo)}&limit=200`
    : "/api/contexts/graph?limit=200";
  const { data, error, isLoading, mutate } = useSWR<ContextGraphData>(key, () =>
    api.contextGraph({ repo: activeRepo || undefined, limit: 200 }),
  );
  const stateVariant = stateVariantFromError(error, online);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold">Context Graph</h1>
            <p className="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
              contexts, tasks, and repos connected by captured context state
            </p>
          </div>
          <Input
            placeholder="repo filter"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            className="w-[260px] font-mono"
          />
        </div>

        {stateVariant ? (
          <PageState
            variant={stateVariant}
            hint={stateVariant === "unauthorized" ? "Context graph requires reconnecting a source." : "Context graph data could not be loaded."}
            action={() => mutate()}
          />
        ) : isLoading || !data ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-12 text-center text-[12px] text-[var(--color-fg-dim)]">
            loading graph...
          </div>
        ) : data.nodes.length === 0 ? (
          <PageState variant="empty" hint="No context graph data is available for the current repo filter." />
        ) : (
          <ContextGraph data={data} />
        )}
      </div>
    </div>
  );
}
