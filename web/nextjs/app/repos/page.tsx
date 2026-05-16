"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { RepoCard } from "@/components/repo-card";
import { TrackReposDialog } from "@/components/track-repos-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageState } from "@/components/page-state";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { RepoStat } from "@/lib/types";

type SortMode = "recent" | "open" | "name";
const DEFAULT_SORT: SortMode = "recent"; // recent maps to last_activity desc.

// Extracts the owner/organization from https://github.com/<org>/<repo>(/...)
// Returns null when the URL is missing, malformed, or not a github.com URL —
// those repos collapse into the "no-org" bucket.
function extractOrg(githubUrl: string | null | undefined): string | null {
  if (!githubUrl) return null;
  const m = githubUrl.match(/^https?:\/\/github\.com\/([^/]+)\//);
  return m?.[1] ?? null;
}

export default function ReposPage() {
  const { data: repos = [] } = useSWR<RepoStat[]>("/api/repos", () => api.repos(), {
    refreshInterval: 60_000,
  });
  const [filter, setFilter] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(DEFAULT_SORT);
  const [org, setOrg] = useState<string>("all");
  const [trackDialogOpen, setTrackDialogOpen] = useState(false);

  // Hide repos whose directory no longer exists under scan.roots — the cards
  // would only show stale counts and link to a 404 detail page.
  const present = useMemo(() => repos.filter((r) => r.exists !== false), [repos]);

  // Owners sorted by repo count desc — gives stable, expected dropdown order
  // even when the underlying repo list re-fetches.
  const orgOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let unknown = 0;
    for (const r of present) {
      const o = extractOrg(r.github_url);
      if (!o) unknown += 1;
      else counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    const entries = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const list: Array<{ value: string; label: string; count: number }> = [
      { value: "all", label: "all orgs", count: present.length },
      ...entries.map(([o, n]) => ({ value: o, label: o, count: n })),
    ];
    if (unknown > 0) list.push({ value: "__none__", label: "(no org)", count: unknown });
    return list;
  }, [present]);

  // If the currently-selected org disappears from the dataset (e.g. user
  // pruned its repos), gracefully fall back to "all" on the next render.
  const effectiveOrg = orgOptions.some((o) => o.value === org) ? org : "all";

  const filtered = useMemo(() => {
    let rows = present;
    if (effectiveOrg === "__none__") {
      rows = rows.filter((r) => extractOrg(r.github_url) === null);
    } else if (effectiveOrg !== "all") {
      rows = rows.filter((r) => extractOrg(r.github_url) === effectiveOrg);
    }
    const sorted = [...rows].sort((a, b) => compareRepos(a, b, sortMode));
    if (!filter.trim()) return sorted;
    const q = filter.toLowerCase();
    return sorted.filter((r) => r.name.toLowerCase().includes(q));
  }, [filter, present, sortMode, effectiveOrg]);

  const scale = useMemo(
    () => Math.max(1, ...present.map((r) => r.open + r.in_progress)),
    [present],
  );

  return (
    <div className="h-full overflow-y-auto">
      <TrackReposDialog open={trackDialogOpen} onClose={() => setTrackDialogOpen(false)} />
      <div className="px-6 py-6 space-y-5 max-w-[1400px]">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">{c("repos.title")}</h1>
            <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
              {c("common.repositories", { count: formatNumber(present.length) })} · {c("common.activeItems", { count: formatNumber(present.reduce((a, b) => a + b.open + b.in_progress, 0)) })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setTrackDialogOpen(true)}
              className="h-7 px-2 text-[12px] border border-[var(--color-border)]"
            >
              + Track repos
            </Button>
            <select
              value={effectiveOrg}
              onChange={(e) => setOrg(e.target.value)}
              aria-label="Filter by organization"
              className="h-7 px-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[12px] font-mono text-[var(--color-fg)] hover:bg-[var(--color-bg-elev-2)] focus:outline-none"
            >
              {orgOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} ({formatNumber(o.count)})
                </option>
              ))}
            </select>
            <div className="flex rounded-[var(--radius)] border border-[var(--color-border)] p-0.5">
              {(["recent", "open", "name"] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSortMode(mode)}
                  aria-pressed={sortMode === mode}
                  className={cn(
                    "h-6 px-2 rounded-[var(--radius-sm)]",
                    sortMode === mode && "bg-[var(--color-bg-elev)] text-[var(--color-fg)]",
                  )}
                >
                  {mode}
                </Button>
              ))}
            </div>
            <Input
              placeholder={c("repos.filter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-[240px] font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {filtered.map((r) => (
            <RepoCard key={r.name} repo={r} scale={scale} />
          ))}
        </div>

        {filtered.length === 0 && (
          <PageState
            variant="empty"
            title={
              repos.length === 0
                ? c("page.repos.emptyTitle")
                : c("repos.noMatch", { filter })
            }
            hint={
              repos.length === 0
                ? c("page.repos.emptyHint")
                : c("page.tasks.emptyHint")
            }
          />
        )}
      </div>
    </div>
  );
}

function compareRepos(a: RepoStat, b: RepoStat, sortMode: SortMode): number {
  if (sortMode === "name") {
    return a.name.localeCompare(b.name);
  }
  if (sortMode === "open") {
    return (b.open + b.in_progress) - (a.open + a.in_progress) || a.name.localeCompare(b.name);
  }
  return new Date(b.lastTouched).getTime() - new Date(a.lastTouched).getTime() || a.name.localeCompare(b.name);
}
