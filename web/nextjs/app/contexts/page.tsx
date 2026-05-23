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
import { PageState } from "@/components/page-state";
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

  const grouped = useMemo(() => groupByRepo(filtered), [filtered]);

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

      {isTrueEmpty ? (
        <div className="px-6 pb-6">
          <OnboardingCta />
        </div>
      ) : isFilteredEmpty ? (
        <div className="px-6 pb-6">
          <PageState
            variant="empty"
            title={c("contexts.noMatch", { filter })}
            hint={c("page.tasks.emptyHint")}
          />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(0,520px)] overflow-hidden border-t border-[var(--color-border)]/0">
          <div className="overflow-y-auto border-r border-[var(--color-border)] px-6 py-4 space-y-6">
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
  for (const [repo, list] of map) groups.push({ repo, contexts: list });
  groups.sort((a, b) => {
    const aTop = a.contexts[0]?.createdAt ?? "";
    const bTop = b.contexts[0]?.createdAt ?? "";
    if (bTop !== aTop) return bTop.localeCompare(aTop);
    return a.repo.localeCompare(b.repo);
  });
  return groups;
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
