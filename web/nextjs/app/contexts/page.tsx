"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { ChevronRight, FolderGit2, ScrollText, Terminal } from "lucide-react";
import { api } from "@/lib/api";
import { ContextItem } from "@/components/context-item";
import { ContextDetailPanel } from "@/components/context-detail-panel";
import { Input } from "@/components/ui/input";
import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { RelayContext } from "@/lib/types";

export default function ContextsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[var(--color-fg-dim)] text-[13px]">{c("common.loading")}</div>
      }
    >
      <ContextsInner />
    </Suspense>
  );
}

function ContextsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedHash = params.get("hash");
  const online = useOnlineStatus();
  const { data: contexts = [], error, isLoading, mutate } = useSWR<RelayContext[]>(
    "/api/contexts?limit=100",
    () => api.contexts(undefined, 100),
  );
  const [filter, setFilter] = useState("");
  const [repoFilter, setRepoFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return contexts.filter((ctx) => {
      if (repoFilter && ctx.repo !== repoFilter) return false;
      if (!q) return true;
      return (
        ctx.repo.toLowerCase().includes(q) ||
        ctx.branch.toLowerCase().includes(q) ||
        ctx.summary.toLowerCase().includes(q) ||
        ctx.hash.toLowerCase().includes(q) ||
        ctx.headSha.toLowerCase().includes(q) ||
        (ctx.sessionId ?? "").toLowerCase().includes(q) ||
        ctx.dirtyFiles.some((file) => file.toLowerCase().includes(q))
      );
    });
  }, [filter, repoFilter, contexts]);

  const grouped = useMemo(() => groupByRepo(filtered), [filtered]);
  const repoSummaries = useMemo(() => repoSummaryList(contexts), [contexts]);
  const stats = useMemo(() => contextStats(contexts), [contexts]);
  const errorVariant = stateVariantFromError(error, online);

  // Resolve the currently-selected context object. Falls back to the
  // newest entry so the detail pane never sits empty when there IS data
  // — matches the "selection always exists once rows are present" pattern
  // /tasks uses.
  const selected = useMemo<RelayContext | null>(() => {
    if (filtered.length === 0) return null;
    const exact = selectedHash
      ? filtered.find((c) => c.hash === selectedHash)
      : null;
    return exact ?? filtered[0] ?? null;
  }, [filtered, selectedHash]);

  const handleSelect = useCallback(
    (hash: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.set("hash", hash);
      router.replace(`/contexts?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const isTrueEmpty = contexts.length === 0;
  const isFilteredEmpty = !isTrueEmpty && filtered.length === 0;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-3 flex items-baseline justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight">{c("contexts.title")}</h1>
          <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
            {c("contexts.subtitle", {
              count: formatNumber(contexts.length),
              noun:
                contexts.length === 1
                  ? c("common.savedSnapshot.noun.one")
                  : c("common.savedSnapshot.noun.many"),
            })}
            {grouped.length > 0 && (
              <span> · {formatNumber(grouped.length)} repo{grouped.length === 1 ? "" : "s"}</span>
            )}
          </p>
        </div>
        {!isTrueEmpty && (
          <Input
            placeholder={c("contexts.filter")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-[240px] font-mono"
          />
        )}
      </div>

      {error ? (
        <div className="px-6 pb-6">
          <PageState
            variant={errorVariant ?? "empty"}
            title="Could not load contexts"
            hint="Context snapshots could not be loaded from the local API."
            action={() => mutate()}
          />
        </div>
      ) : isLoading ? (
        <div className="px-6 pb-6">
          <ContextsLoading />
        </div>
      ) : isTrueEmpty ? (
        <div className="px-6 pb-6">
          <OnboardingCta />
        </div>
      ) : isFilteredEmpty ? (
        <div className="px-6 pb-6">
          <PageState
            variant="empty"
            title={repoFilter ? `No contexts for ${repoFilter}` : c("contexts.noMatch", { filter })}
            hint="Try repo, branch, summary, hash, HEAD SHA, session id, or dirty file path."
          />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(0,520px)] overflow-hidden border-t border-[var(--color-border)]/0">
          <div className="overflow-y-auto border-r border-[var(--color-border)] px-6 py-4 space-y-6">
            <ContextStatsBar stats={stats} visibleCount={filtered.length} />
            <RepoFilterList
              repos={repoSummaries}
              activeRepo={repoFilter}
              onSelect={setRepoFilter}
            />
            {grouped.map((group) => (
              <RepoTimelineGroup
                key={group.repo}
                group={group}
                selectedHash={selected?.hash ?? null}
                onSelect={handleSelect}
              />
            ))}
          </div>
          <div className="overflow-hidden bg-[var(--color-bg-elev)]/30">
            <ContextDetailPanel ctx={selected} />
          </div>
        </div>
      )}
    </div>
  );
}

interface RepoGroup {
  repo: string;
  contexts: RelayContext[];
}

function groupByRepo(contexts: RelayContext[]): RepoGroup[] {
  const map = new Map<string, RelayContext[]>();
  for (const ctx of contexts) {
    const list = map.get(ctx.repo) ?? [];
    list.push(ctx);
    map.set(ctx.repo, list);
  }
  const groups: RepoGroup[] = [];
  for (const [repo, list] of map) {
    groups.push({
      repo,
      contexts: [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  }
  groups.sort((a, b) => {
    const aTop = a.contexts[0]?.createdAt ?? "";
    const bTop = b.contexts[0]?.createdAt ?? "";
    if (bTop !== aTop) return bTop.localeCompare(aTop);
    return a.repo.localeCompare(b.repo);
  });
  return groups;
}

function contextStats(contexts: readonly RelayContext[]) {
  return {
    repos: new Set(contexts.map((ctx) => ctx.repo)).size,
    dirty: contexts.filter((ctx) => ctx.dirtyFiles.length > 0).length,
    resumable: contexts.filter((ctx) => ctx.sessionId).length,
    linkedTasks: contexts.reduce((sum, ctx) => sum + ctx.linkedTasksCount, 0),
  };
}

interface RepoSummary {
  repo: string;
  count: number;
  dirty: number;
  resumable: number;
  latest: string;
}

function repoSummaryList(contexts: readonly RelayContext[]): RepoSummary[] {
  const map = new Map<string, RepoSummary>();
  for (const ctx of contexts) {
    const current = map.get(ctx.repo);
    if (current) {
      current.count += 1;
      current.dirty += ctx.dirtyFiles.length > 0 ? 1 : 0;
      current.resumable += ctx.sessionId ? 1 : 0;
      if (ctx.createdAt > current.latest) current.latest = ctx.createdAt;
    } else {
      map.set(ctx.repo, {
        repo: ctx.repo,
        count: 1,
        dirty: ctx.dirtyFiles.length > 0 ? 1 : 0,
        resumable: ctx.sessionId ? 1 : 0,
        latest: ctx.createdAt,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (b.latest !== a.latest) return b.latest.localeCompare(a.latest);
    return a.repo.localeCompare(b.repo);
  });
}

function RepoFilterList({
  repos,
  activeRepo,
  onSelect,
}: {
  repos: readonly RepoSummary[];
  activeRepo: string | null;
  onSelect: (repo: string | null) => void;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/30 overflow-hidden">
      <header className="px-3 py-2 border-b border-[var(--color-border)]/60 flex items-center gap-2">
        <FolderGit2 className="w-3.5 h-3.5 text-[var(--color-fg-muted)]" aria-hidden />
        <h2 className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
          Repos
        </h2>
        {activeRepo && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ml-auto text-[10.5px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            clear
          </button>
        )}
      </header>
      <div className="max-h-[220px] overflow-y-auto p-2 space-y-1">
        <RepoFilterButton
          label="All repos"
          count={repos.reduce((sum, repo) => sum + repo.count, 0)}
          selected={activeRepo === null}
          onClick={() => onSelect(null)}
        />
        {repos.map((repo) => (
          <RepoFilterButton
            key={repo.repo}
            label={repo.repo}
            count={repo.count}
            selected={activeRepo === repo.repo}
            onClick={() => onSelect(repo.repo)}
            meta={[
              repo.resumable > 0 ? `${formatNumber(repo.resumable)} resumable` : null,
              repo.dirty > 0 ? `${formatNumber(repo.dirty)} dirty` : null,
            ].filter(Boolean).join(" · ")}
          />
        ))}
      </div>
    </section>
  );
}

function RepoFilterButton({
  label,
  count,
  selected,
  onClick,
  meta,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  meta?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-[var(--radius)] px-2.5 py-2 text-left transition-colors",
        "border font-mono",
        selected
          ? "border-[var(--color-accent)]/45 bg-[var(--color-accent)]/[0.08]"
          : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-elev)]/60",
      )}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="truncate text-[11.5px] text-[var(--color-fg)]">{label}</span>
        <span className="ml-auto text-[10.5px] tabular text-[var(--color-fg-dim)]">
          {formatNumber(count)}
        </span>
      </div>
      {meta && (
        <div className="mt-0.5 truncate text-[9.5px] text-[var(--color-fg-dim)]">
          {meta}
        </div>
      )}
    </button>
  );
}

function ContextStatsBar({
  stats,
  visibleCount,
}: {
  stats: ReturnType<typeof contextStats>;
  visibleCount: number;
}) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
      <StatChip label="visible" value={visibleCount} />
      <StatChip label="repos" value={stats.repos} />
      <StatChip label="resumable" value={stats.resumable} />
      <StatChip label="linked tasks" value={stats.linkedTasks} tone={stats.linkedTasks > 0 ? "cool" : "muted"} />
      {stats.dirty > 0 && <StatChip label="dirty snapshots" value={stats.dirty} tone="warm" />}
    </div>
  );
}

function StatChip({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "cool" | "warm";
}) {
  const color =
    tone === "cool"
      ? "text-[var(--color-cool)]"
      : tone === "warm"
        ? "text-[var(--color-warm)]"
        : "text-[var(--color-fg-muted)]";
  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/35 px-3 py-2">
      <div className={cn("font-mono text-[15px] tabular", color)}>{formatNumber(value)}</div>
      <div className="mt-0.5 text-[9.5px] uppercase tracking-wider text-[var(--color-fg-dim)]">
        {label}
      </div>
    </div>
  );
}

function ContextsLoading() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/30 p-4 space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse space-y-2">
          <div className="h-3 w-1/3 rounded bg-[var(--color-border)]/70" />
          <div className="h-2.5 w-full rounded bg-[var(--color-border)]/50" />
          <div className="h-2.5 w-2/3 rounded bg-[var(--color-border)]/40" />
        </div>
      ))}
    </div>
  );
}

function RepoTimelineGroup({
  group,
  selectedHash,
  onSelect,
}: {
  group: RepoGroup;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/40 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-[var(--color-border)]/60 flex items-baseline gap-2">
        <FolderGit2 className="w-3.5 h-3.5 text-[var(--color-fg-muted)] self-center" aria-hidden />
        <Link
          href={`/tasks?status=open&repo=${encodeURIComponent(group.repo)}`}
          className="font-mono text-[13px] text-[var(--color-cool)] hover:underline"
          title={c("contexts.scopeTasks", { repo: group.repo })}
        >
          {group.repo}
        </Link>
        <span className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] ml-auto">
          {formatNumber(group.contexts.length)} snapshot{group.contexts.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="divide-y divide-[var(--color-border)]/40">
        {group.contexts.map((ctx, i) => {
          const older = group.contexts[i + 1];
          return (
            <div key={ctx.hash}>
              <ContextItem
                ctx={ctx}
                isLast={i === group.contexts.length - 1}
                selected={selectedHash === ctx.hash}
                onSelect={onSelect}
              />
              {older && <DeltaConnector newer={ctx} older={older} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DeltaConnector({ newer, older }: { newer: RelayContext; older: RelayContext }) {
  const sameSha = newer.headSha === older.headSha;
  const dirtyDelta = newer.dirtyFiles.length - older.dirtyFiles.length;
  return (
    <div className="pl-8 pr-4 py-1.5 text-[10.5px] font-mono text-[var(--color-fg-dim)] flex items-center gap-2 bg-[var(--color-bg)]/40">
      <span className="inline-flex items-center gap-1">
        {sameSha ? (
          <span title="HEAD did not move between these snapshots">
            same SHA <span className="tabular">{newer.headSha.slice(0, 7)}</span>
          </span>
        ) : (
          <>
            <span className="tabular">{older.headSha.slice(0, 7)}</span>
            <ChevronRight className="w-3 h-3" aria-hidden />
            <span className="tabular text-[var(--color-fg-muted)]">{newer.headSha.slice(0, 7)}</span>
          </>
        )}
      </span>
      {dirtyDelta !== 0 && (
        <span
          className={cn(
            "tabular",
            dirtyDelta > 0 ? "text-[var(--color-warm)]" : "text-[var(--color-accent)]",
          )}
          title="change in uncommitted-file count since the previous snapshot"
        >
          {dirtyDelta > 0 ? `+${dirtyDelta}` : dirtyDelta} dirty
        </span>
      )}
      {newer.branch !== older.branch && (
        <span className="text-[var(--color-fg-muted)]" title="branch changed between snapshots">
          {older.branch} → {newer.branch}
        </span>
      )}
    </div>
  );
}

function OnboardingCta() {
  return (
    <section className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-elev)]/30 p-5">
      <div className="flex items-start gap-3">
        <ScrollText className="w-5 h-5 text-[var(--color-fg-muted)] mt-0.5 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight">No snapshots yet</h2>
          <p className="text-[12px] text-[var(--color-fg-muted)] mt-1 leading-relaxed">
            Contexts are repo-state snapshots — branch, HEAD SHA, dirty files, and a
            one-line summary — saved automatically at the end of each Claude Code
            session. Once set up, every Stop hook fire produces an entry here.
          </p>
          <div className="mt-3 space-y-2">
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] mb-1">
                One-time install
              </div>
              <CmdLine cmd="relay hook install" />
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] mb-1">
                Verify
              </div>
              <CmdLine cmd="relay hook status" />
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] mb-1">
                Try one save manually
              </div>
              <CmdLine cmd='relay context save --summary "first manual snapshot"' />
            </div>
          </div>
          <p className="text-[10.5px] text-[var(--color-fg-dim)] mt-3 leading-relaxed">
            If <code className="font-mono">relay hook status</code> shows installed but
            this page is still empty, the hook may be silently failing — usually a
            broken <code className="font-mono">~/.bun/bin/relay</code> symlink after a
            repo move. Re-run <code className="font-mono">bun link</code> from the
            relay project root to fix it.
          </p>
        </div>
      </div>
    </section>
  );
}

function CmdLine({ cmd }: { cmd: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--color-fg)]">
      <Terminal className="w-3 h-3 text-[var(--color-fg-dim)] shrink-0" aria-hidden />
      <code className="flex-1 truncate select-all">{cmd}</code>
    </div>
  );
}
