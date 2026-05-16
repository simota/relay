"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { MarkdownView } from "@/components/markdown-view";
import { Badge, StatusDot } from "@/components/ui/badge";
import { cn, timeAgo } from "@/lib/utils";
import type { RepoAgentsResponse, AgentFileEntry, Task, Status } from "@/lib/types";

type DetailTab = "agents" | "tasks";

const TASK_STATUS_FILTERS: ReadonlyArray<{ value: Status | "all"; label: string }> = [
  { value: "all", label: "all" },
  { value: "open", label: "open" },
  { value: "snoozed", label: "snoozed" },
  { value: "done", label: "done" },
];

export default function RepoDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-[13px] text-[var(--color-fg-dim)]">Loading…</div>
      }
    >
      <RepoDetailBoard />
    </Suspense>
  );
}

function RepoDetailBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const repoName = params.get("name") ?? "";
  const selectedFile = params.get("file") ?? "";
  const tab: DetailTab = params.get("tab") === "agents" ? "agents" : "tasks";
  const taskStatus = (params.get("taskStatus") as Status | "all" | null) ?? "all";

  const { data, isLoading, error } = useSWR<RepoAgentsResponse>(
    repoName && tab === "agents"
      ? `/api/repos/${encodeURIComponent(repoName)}/agents`
      : null,
    () => api.repoAgents(repoName),
    { refreshInterval: 0 },
  );

  const setTab = useCallback(
    (next: DetailTab) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "tasks") sp.delete("tab");
      else sp.set("tab", next);
      router.replace(`/repos/detail?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const setTaskStatus = useCallback(
    (next: Status | "all") => {
      const sp = new URLSearchParams(params.toString());
      if (next === "all") sp.delete("taskStatus");
      else sp.set("taskStatus", next);
      router.replace(`/repos/detail?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const selectFile = useCallback(
    (name: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.set("file", name);
      router.replace(`/repos/detail?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const activeFile: AgentFileEntry | undefined = useMemo(() => {
    if (!data?.files.length) return undefined;
    const found = data.files.find((f) => f.name === selectedFile);
    return found ?? data.files[0];
  }, [data, selectedFile]);

  if (!repoName) {
    return (
      <div className="p-8 text-[13px] text-[var(--color-fg-dim)]">
        No repo specified. <Link href="/repos" className="underline">Back to repos</Link>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader repoName={repoName} data={data ?? null} tab={tab} onTabChange={setTab} />
      <div className="flex-1 min-h-0 overflow-hidden border-t border-[var(--color-border)]">
        {tab === "agents" ? (
          <AgentsTab
            isLoading={isLoading}
            error={error}
            data={data}
            repoName={repoName}
            activeFile={activeFile}
            onSelectFile={selectFile}
          />
        ) : (
          <TasksTab
            repoName={repoName}
            taskStatus={taskStatus}
            onStatusChange={setTaskStatus}
          />
        )}
      </div>
    </div>
  );
}

function AgentsTab({
  isLoading,
  error,
  data,
  repoName,
  activeFile,
  onSelectFile,
}: {
  isLoading: boolean;
  error: unknown;
  data: RepoAgentsResponse | undefined;
  repoName: string;
  activeFile: AgentFileEntry | undefined;
  onSelectFile: (name: string) => void;
}) {
  if (isLoading) {
    return <div className="p-8 text-[13px] text-[var(--color-fg-dim)]">Loading…</div>;
  }
  if (error) {
    return (
      <div className="p-8 text-[13px] text-[var(--color-warm,var(--color-fg-muted))]">
        Failed to load: {String(error)}
      </div>
    );
  }
  if (data && !data.exists) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[13px] text-[var(--color-fg-dim)]">
          リポジトリが見つかりません (<code className="font-mono">{repoName}</code> は scan.roots 配下に存在しません)
        </p>
      </div>
    );
  }
  if (data && data.exists && data.files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[13px] text-[var(--color-fg-dim)]">
          .agents/ が空です — Markdown ファイルが見つかりませんでした
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      <aside className="w-[280px] shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
        <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)] font-mono">
          Files
        </div>
        <ul className="space-y-0.5 px-2 pb-4">
          {data?.files.map((f) => (
            <li key={f.name}>
              <button
                type="button"
                onClick={() => onSelectFile(f.name)}
                className={cn(
                  "w-full text-left rounded-[var(--radius-sm)] px-2.5 py-1.5 flex items-baseline justify-between gap-2 text-[12px] font-mono transition-colors",
                  activeFile?.name === f.name
                    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                    : "text-[var(--color-fg)] hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-fg)]",
                )}
              >
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-[10px] text-[var(--color-fg-dim)]">
                  {timeAgo(f.mtime)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
        {activeFile ? (
          <>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="font-mono text-[14px] font-semibold text-[var(--color-fg)]">
                {activeFile.name}
              </h2>
              <span className="text-[11px] font-mono text-[var(--color-fg-dim)]">
                {formatBytes(activeFile.sizeBytes)} · {timeAgo(activeFile.mtime)}
              </span>
            </div>
            <MarkdownView content={activeFile.content} />
            {activeFile.truncated && (
              <p className="mt-6 text-[11px] font-mono text-[var(--color-fg-dim)] italic">
                … (truncated — file exceeds 200 KB display limit)
              </p>
            )}
          </>
        ) : (
          <p className="text-[13px] text-[var(--color-fg-dim)]">ファイルを選択してください</p>
        )}
      </main>
    </div>
  );
}

function TasksTab({
  repoName,
  taskStatus,
  onStatusChange,
}: {
  repoName: string;
  taskStatus: Status | "all";
  onStatusChange: (next: Status | "all") => void;
}) {
  const { data: tasks = [], isLoading } = useSWR<Task[]>(
    `/api/tasks?repo=${encodeURIComponent(repoName)}&status=${taskStatus}`,
    () =>
      api.tasks({
        repo: repoName,
        status: taskStatus === "all" ? undefined : taskStatus,
        limit: 500,
      }),
    { refreshInterval: 30_000 },
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: tasks.length };
    for (const t of tasks) m[t.status] = (m[t.status] ?? 0) + 1;
    return m;
  }, [tasks]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-3 border-b border-[var(--color-border)] flex items-center gap-2 flex-wrap">
        <div className="flex rounded-[var(--radius)] border border-[var(--color-border)] p-0.5">
          {TASK_STATUS_FILTERS.map((f) => {
            const active = taskStatus === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => onStatusChange(f.value)}
                aria-pressed={active}
                className={cn(
                  "h-6 px-2.5 rounded-[var(--radius-sm)] font-mono text-[11px] transition-colors",
                  active
                    ? "bg-[var(--color-bg-elev)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] font-mono text-[var(--color-fg-dim)]">
          {counts[taskStatus] ?? tasks.length} task(s)
        </span>
        <div className="flex-1" />
        <Link
          href={`/tasks?repo=${encodeURIComponent(repoName)}${taskStatus !== "all" ? `&status=${taskStatus}` : ""}`}
          className="text-[11px] text-[var(--color-cool)] hover:underline"
        >
          Open full task list →
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-[13px] text-[var(--color-fg-dim)]">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="p-8 text-[13px] text-[var(--color-fg-dim)] text-center">
            No {taskStatus === "all" ? "" : `${taskStatus} `}tasks in this repo.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]/60">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tasks?repo=${encodeURIComponent(repoName)}&status=${t.status === "in_progress" ? "open" : t.status}`}
                  className="flex items-center gap-3 px-6 py-2 text-[12.5px] hover:bg-[var(--color-bg-elev)]/60 transition-colors"
                >
                  <StatusDot status={t.status} className="shrink-0" />
                  <Badge source={t.source_type} />
                  <span className="flex-1 min-w-0 truncate text-[var(--color-fg)]">
                    {t.title}
                  </span>
                  <span className="shrink-0 text-[10.5px] font-mono text-[var(--color-fg-dim)]">
                    {timeAgo(t.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PageHeader({
  repoName,
  data,
  tab,
  onTabChange,
}: {
  repoName: string;
  data: RepoAgentsResponse | null;
  tab: DetailTab;
  onTabChange: (next: DetailTab) => void;
}) {
  const fileCount = data?.files.length ?? 0;
  const latestMtime = data?.files[0]?.mtime;

  return (
    <header className="flex-shrink-0 px-6 pt-4 pb-3 flex items-end gap-4 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-0.5">
          <Link
            href="/repos"
            className="text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            ← Back to repos
          </Link>
          <span className="text-[var(--color-fg-dim)] text-[12px]">·</span>
        </div>
        <h1 className="font-mono text-[18px] font-semibold text-[var(--color-cool)]">
          {repoName}
        </h1>
        {tab === "agents" && fileCount > 0 && (
          <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5 font-mono">
            {fileCount} agent file{fileCount !== 1 ? "s" : ""}
            {latestMtime && ` · last ${new Date(latestMtime).toLocaleString()}`}
          </p>
        )}
      </div>
      <nav className="flex border-b border-transparent gap-1" aria-label="Repo detail tabs">
        {(["agents", "tasks"] as const).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onTabChange(t)}
              aria-pressed={active}
              className={cn(
                "h-7 px-3 rounded-[var(--radius)] font-mono text-[12px] transition-colors border",
                active
                  ? "bg-[var(--color-bg-elev)] text-[var(--color-fg)] border-[var(--color-border)]"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] border-transparent",
              )}
            >
              {t === "agents" ? ".agents" : "Tasks"}
            </button>
          );
        })}
      </nav>
    </header>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
