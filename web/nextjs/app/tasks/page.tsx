"use client";

import { useCallback, useMemo, useRef, useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import { FilterBar } from "@/components/filter-bar";
import { TaskList } from "@/components/task-list";
import { TaskDetail } from "@/components/task-detail";
import { useUndoToast } from "@/components/toast";
import { fuzzyMatchMulti } from "@/lib/fuzzy";
import type { SourceType, Status, Task } from "@/lib/types";
import type { ViewFilter } from "@/lib/api";
import type { Filtered } from "@/lib/fuzzy";
import { parseFilterDsl, type FilterDslAst } from "@/lib/filter-dsl";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageState } from "@/components/page-state";

// Order mirrors the sidebar Sources section so the segment control reads
// in the same direction users already scan.
const SOURCE_FILTERS: ReadonlyArray<{ value: SourceType | "all"; label: string }> = [
  { value: "all", label: "all" },
  { value: "code_todo", label: "code" },
  { value: "github_issue", label: "issue" },
  { value: "github_pr", label: "PR" },
  { value: "claude_session_todo", label: "claude" },
  { value: "codex_session_todo", label: "codex" },
  { value: "antigravity_session_todo", label: "antigravity" },
  { value: "cursor_session_todo", label: "cursor" },
  { value: "agents_note", label: ".agents" },
  { value: "manual", label: "manual" },
];

const TITLE_MAP: Partial<Record<Status, string>> = {
  open: c("tasks.title.open"),
  in_progress: c("tasks.title.active"),
  snoozed: c("nav.snoozed"),
  done: c("nav.done"),
};

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--color-fg-dim)]">{c("common.loading")}</div>}>
      <TasksInner />
    </Suspense>
  );
}

function TasksInner() {
  const router = useRouter();
  const params = useSearchParams();
  const status = (params.get("status") as Status | null) ?? "open";
  const repo = params.get("repo") ?? undefined;
  const source = params.get("source") ?? undefined;
  const age = params.get("age") ?? undefined;

  const setSource = useCallback(
    (next: SourceType | "all") => {
      const sp = new URLSearchParams(params.toString());
      if (next === "all") sp.delete("source");
      else sp.set("source", next);
      const qs = sp.toString();
      router.replace(`/tasks${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const [filter, setFilter] = useState("");
  const parsedFilter = useMemo(() => parseFilterDsl(filter), [filter]);
  const taskFilter = useMemo(
    () => compactFilter({ status, repo, source, age, ...parsedFilter.query }),
    [age, parsedFilter.query, repo, source, status],
  );

  const key = tasksKey(taskFilter);
  const { data: tasks = [], mutate: refresh } = useSWR<Task[]>(
    key,
    () => api.tasks({ ...taskFilter, limit: 500 }),
  );

  const [savingView, setSavingView] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // For 'open' filter, also fetch in_progress and merge (scoped to repo if present)
  const inProgKey = taskFilter.status === "open"
    ? tasksKey({ ...taskFilter, status: "in_progress" })
    : null;
  const { data: inProg = [] } = useSWR<Task[]>(
    inProgKey,
    () => api.tasks({ ...taskFilter, status: "in_progress", limit: 500 }),
  );

  const allTasks = useMemo(
    () => taskFilter.status === "open" ? [...inProg, ...tasks] : tasks,
    [taskFilter.status, tasks, inProg],
  );

  const rows = useMemo(
    () => filterTasks(allTasks, parsedFilter.ast, parsedFilter.titleQuery),
    [allTasks, parsedFilter.ast, parsedFilter.titleQuery],
  );
  const selected = useMemo(() => {
    if (selectedId !== null) {
      const t = allTasks.find((t) => t.id === selectedId);
      if (t) return t;
    }
    return rows[0]?.task ?? null;
  }, [allTasks, rows, selectedId]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedIds([]);
  }, [taskFilter.status, taskFilter.repo, taskFilter.source, taskFilter.age]);

  const { mutate: swrMutate } = useSWRConfig();
  const { pushUndo } = useUndoToast();

  const selectTask = useCallback((id: number, extend = false) => {
    setSelectedId(id);
    if (!extend) {
      setSelectedIds([]);
      return;
    }
    const anchorId = selectedIds[0] ?? selected?.id ?? id;
    setSelectedIds(rangeIds(rows, anchorId, id));
  }, [rows, selected?.id, selectedIds]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (!rows.length) return;
      const idx = rows.findIndex((r) => r.task.id === selected?.id);
      const next = Math.max(0, Math.min(rows.length - 1, idx + delta));
      selectTask(rows[next]!.task.id);
    },
    [rows, selected, selectTask],
  );

  const mutateTask = useCallback(
    async (action: "snooze" | "close" | "reopen") => {
      if (!selected) return;
      try {
        if (action === "snooze") {
          await api.snooze(selected.id);
          pushUndo("snooze", selected);
        }
        if (action === "close") {
          await api.close(selected.id);
          pushUndo("close", selected);
        }
        if (action === "reopen") await api.reopen(selected.id);
        await Promise.all([
          refresh(),
          swrMutate((key) => typeof key === "string" && key.startsWith("/api/counts")),
        ]);
      } catch (e) {
        console.warn(`${action} failed`, e);
      }
    },
    [pushUndo, selected, refresh, swrMutate],
  );

  const copyRunCli = useCallback(async () => {
    if (!selected) return;
    const cmd = `relay run ${selected.id}`;
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      // permissions blocked — best effort
    }
  }, [selected]);

  const bulkMutate = useCallback(
    async (action: "snooze" | "close", ids: number[]) => {
      if (!ids.length) return;
      try {
        if (action === "snooze") {
          await api.bulk({ action, ids, until: nextWeekUntil() });
        } else {
          await api.bulk({ action, ids });
        }
        setSelectedIds([]);
        await Promise.all([
          refresh(),
          swrMutate((key) => typeof key === "string" && key.startsWith("/api/counts")),
        ]);
      } catch (e) {
        console.warn(`bulk ${action} failed`, e);
      }
    },
    [refresh, swrMutate],
  );

  const addSelectedToQueue = useCallback(async () => {
    if (!selected) return;
    try {
      await api.queue.add(selected.id);
      await swrMutate("/api/queue");
    } catch (e) {
      console.warn("add to queue failed", e);
    }
  }, [selected, swrMutate]);

  const saveCurrentView = useCallback(async () => {
    const defaultName = viewDefaultName(taskFilter);
    const name = window.prompt(c("tasks.savePrompt"), defaultName)?.trim();
    if (!name) return;
    setSavingView(true);
    try {
      await api.views.create({
        name,
        filter: taskFilter,
        pinned: true,
      });
      await swrMutate("/api/views");
    } catch (e) {
      console.warn("save view failed", e);
    } finally {
      setSavingView(false);
    }
  }, [swrMutate, taskFilter]);

  useHotkeys([
    { key: "/", handler: (e) => { e.preventDefault(); inputRef.current?.focus(); } },
    {
      key: "Escape",
      handler: () => { if (filter) setFilter(""); inputRef.current?.blur(); },
      allowInInput: true,
    },
    { key: "j", handler: () => moveSelection(1), enabled: !bulkOpen },
    { key: "k", handler: () => moveSelection(-1), enabled: !bulkOpen },
    { key: "s", handler: () => { void mutateTask("snooze"); }, enabled: selectedIds.length === 0 && !bulkOpen },
    { key: "c", handler: () => { void mutateTask("close"); }, enabled: selectedIds.length === 0 && !bulkOpen },
    { key: "o", handler: () => { void mutateTask("reopen"); }, enabled: !bulkOpen },
    { key: "r", handler: () => { void copyRunCli(); }, enabled: !bulkOpen },
    { key: "a", handler: () => { void addSelectedToQueue(); }, enabled: !bulkOpen },
  ]);

  const title = TITLE_MAP[(taskFilter.status as Status | undefined) ?? status] ?? c("tasks.title.default");
  const scopeLabel = scopeDescription(taskFilter);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-3 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
          {scopeLabel && (
            <p className="text-[12px] text-[var(--color-fg-muted)] font-mono mt-0.5">
              {scopeLabel}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-y-1 rounded-[var(--radius)] border border-[var(--color-border)] p-0.5 shrink-0">
          {SOURCE_FILTERS.map((s) => {
            const active = s.value === "all" ? !source : source === s.value;
            return (
              <Button
                key={s.value}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSource(s.value)}
                aria-pressed={active}
                className={cn(
                  "h-6 px-2 rounded-[var(--radius-sm)] font-mono text-[11px]",
                  active && "bg-[var(--color-bg-elev)] text-[var(--color-fg)]",
                )}
              >
                {s.label}
              </Button>
            );
          })}
        </div>
      </div>

      <FilterBar
        value={filter}
        onChange={setFilter}
        matched={rows.length}
        total={allTasks.length}
        inputRef={inputRef}
        onSaveView={saveCurrentView}
        savingView={savingView}
      />

      <div className="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(0,520px)] overflow-hidden border-t border-[var(--color-border)]/0">
        <div className="overflow-y-auto border-r border-[var(--color-border)]">
          {rows.length === 0 && filter.trim() ? (
            <div className="px-3 py-4">
              <PageState
                variant="empty"
                title={c("page.tasks.emptyTitle")}
                hint={c("page.tasks.emptyHint")}
              />
            </div>
          ) : (
            <TaskList
              rows={rows}
              selectedId={selected?.id ?? null}
              selectedIds={selectedIds}
              onSelect={selectTask}
              onRangeSelect={setSelectedIds}
              onBulkSnooze={(ids) => { void bulkMutate("snooze", ids); }}
              onBulkClose={(ids) => { void bulkMutate("close", ids); }}
              onBulkOpenChange={setBulkOpen}
            />
          )}
        </div>
        <div className="overflow-hidden bg-[var(--color-bg-elev)]/30">
          <TaskDetail task={selected} onChange={() => refresh()} />
        </div>
      </div>
    </div>
  );
}

function tasksKey(filter: ViewFilter & { limit?: number }): string {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.repo) params.set("repo", filter.repo);
  if (filter.source) params.set("source", filter.source);
  if (filter.age) params.set("age", filter.age);
  params.set("limit", String(filter.limit ?? 500));
  return `/api/tasks?${params.toString()}`;
}

function compactFilter(filter: ViewFilter): ViewFilter {
  const compact: ViewFilter = {};
  if (filter.status) compact.status = filter.status;
  if (filter.repo) compact.repo = filter.repo;
  if (filter.source) compact.source = filter.source;
  if (filter.age) compact.age = filter.age;
  return compact;
}

function viewDefaultName(filter: ViewFilter): string {
  const parts = [
    filter.status ?? "tasks",
    filter.repo ? `repo:${filter.repo}` : "",
    filter.source ? `source:${filter.source}` : "",
    filter.age ? filter.age.replace("older-", "older than ") : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function scopeDescription(filter: ViewFilter): string {
  const parts = [
    filter.repo ? `repo: ${filter.repo}` : "",
    filter.source ? `source: ${filter.source}` : "",
    filter.age ? `age: ${filter.age.replace("older-", "older than ")}d` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function filterTasks(tasks: Task[], ast: FilterDslAst, titleQuery: string): Filtered<Task>[] {
  const fieldTerms = ast.terms.filter((term) => term.type === "field");
  const matched: Filtered<Task>[] = [];

  for (const task of tasks) {
    if (!fieldTerms.every((term) => matchesFieldTerm(task, term))) continue;

    const titleMatch = fuzzyMatchMulti(titleQuery, task.title);
    if (!titleMatch) continue;

    matched.push({
      task,
      score: titleMatch.score,
      titleIndices: titleMatch.indices,
    });
  }

  matched.sort((a, b) => b.score - a.score);
  return matched;
}

function matchesFieldTerm(task: Task, term: FilterDslAst["terms"][number]): boolean {
  if (term.type !== "field") return true;

  if (term.key === "age") return matchesAgeTerm(task, term.operator, term.value);

  const candidate = term.key === "source" ? task.source_type : task[term.key];
  if (term.operator === ":" || term.operator === "=") return term.values.includes(candidate);
  return false;
}

function matchesAgeTerm(task: Task, operator: string, value: string): boolean {
  const want = Number(value);
  if (!Number.isFinite(want)) return false;

  const created = new Date(task.created_at).getTime();
  if (!Number.isFinite(created)) return false;

  const ageDays = (Date.now() - created) / 86_400_000;
  if (operator === ">") return ageDays > want;
  if (operator === "<") return ageDays < want;
  return Math.floor(ageDays) === want;
}

function rangeIds(rows: Filtered<Task>[], anchorId: number, targetId: number): number[] {
  const anchor = rows.findIndex((row) => row.task.id === anchorId);
  const target = rows.findIndex((row) => row.task.id === targetId);
  if (anchor < 0 || target < 0) return [targetId];
  const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
  return rows.slice(from, to + 1).map((row) => row.task.id);
}

function nextWeekUntil(): string {
  const until = new Date();
  until.setUTCDate(until.getUTCDate() + 7);
  return until.toISOString();
}
