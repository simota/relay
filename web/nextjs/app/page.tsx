"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { StatCard } from "@/components/stat-card";
import { TaskList } from "@/components/task-list";
import { TaskDetail } from "@/components/task-detail";
import { SourceMix } from "@/components/source-mix";
import { StandupPanel } from "@/components/standup-panel";
import { SyncButton } from "@/components/sync-button";
import { TrackReposDialog } from "@/components/track-repos-dialog";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { Button } from "@/components/ui/button";
import { useUndoToast } from "@/components/toast";
import { fuzzyFilter, type Filtered } from "@/lib/fuzzy";
import type { Counts, Task } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { c, formatNumber } from "@/lib/copy";

export default function TodayPage() {
  const { data: counts } = useSWR<Counts>("/api/counts", () => api.counts());
  const { data: tasks = [], mutate: refresh } = useSWR<Task[]>(
    "/api/today?limit=20",
    () => api.today(20),
    { refreshInterval: 60_000 },
  );
  // Focus is a singleton across CLI / TUI / Web — driven by the same
  // ~/.relay/state.json file the `relay focus` command writes. We poll once
  // a minute (cheap, file-backed) so a CLI-side change becomes visible
  // without a hard reload.
  const { data: focusState, mutate: refreshFocus } = useSWR<{
    focus_task_id: number | null;
  }>("/api/focus", () => api.focus.get(), { refreshInterval: 60_000 });
  const focusTaskId = focusState?.focus_task_id ?? null;
  const { data: focusedTask } = useSWR<Task | null>(
    focusTaskId !== null ? `/api/tasks/${focusTaskId}` : null,
    () => (focusTaskId !== null ? api.task(focusTaskId) : Promise.resolve(null)),
  );
  const exitFocus = useCallback(async () => {
    try {
      await api.focus.clear();
      await Promise.all([refreshFocus(), refresh()]);
    } catch (e) {
      console.warn("exit focus failed", e);
    }
  }, [refresh, refreshFocus]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  // Date is rendered post-hydration to avoid build-time vs runtime mismatch
  // (static export bakes the build date into HTML; React #418 otherwise).
  const [todayLabel, setTodayLabel] = useState<string>("");
  useEffect(() => {
    setTodayLabel(new Date().toISOString().slice(0, 10));
  }, []);

  const rows = useMemo(() => fuzzyFilter(tasks, ""), [tasks]);
  // Split Today into two stacks: things I drive ("self") on top, things
  // waiting on someone else (reviewer/external/scheduled) collapsed below.
  // Things-original Today: a single list of 20+ rows mixed PR-review-waits
  // with my own write-the-code tasks, which made morning triage useless.
  const selfRows = useMemo(
    () => rows.filter((row) => (row.task.wait_on ?? "self") === "self"),
    [rows],
  );
  const waitingRows = useMemo(
    () => rows.filter((row) => (row.task.wait_on ?? "self") !== "self"),
    [rows],
  );
  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? tasks[0] ?? null,
    [tasks, selectedId],
  );

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

  const moveSelection = useCallback((delta: number) => {
    if (!rows.length) return;
    const idx = rows.findIndex((r) => r.task.id === (selected?.id ?? -1));
    const next = Math.max(0, Math.min(rows.length - 1, idx + delta));
    selectTask(rows[next]!.task.id);
  }, [rows, selected, selectTask]);

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

  const copyRunCli = useCallback(async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(`relay run ${selected.id}`);
    } catch {}
  }, [selected]);

  const addSelectedToQueue = useCallback(async () => {
    if (!selected) return;
    try {
      await api.queue.add(selected.id);
      await swrMutate("/api/queue");
    } catch (e) {
      console.warn("add to queue failed", e);
    }
  }, [selected, swrMutate]);

  useHotkeys([
    { key: "j", handler: () => moveSelection(1), enabled: !bulkOpen },
    { key: "k", handler: () => moveSelection(-1), enabled: !bulkOpen },
    { key: "s", handler: () => { void mutateTask("snooze"); }, enabled: selectedIds.length === 0 && !bulkOpen },
    { key: "c", handler: () => { void mutateTask("close"); }, enabled: selectedIds.length === 0 && !bulkOpen },
    { key: "o", handler: () => { void mutateTask("reopen"); }, enabled: !bulkOpen },
    { key: "r", handler: () => { void copyRunCli(); }, enabled: !bulkOpen },
    { key: "a", handler: () => { void addSelectedToQueue(); }, enabled: !bulkOpen },
  ]);

  const todayMedianAge = useMemo(() => formatMedianAge(tasks), [tasks]);
  const oldestTask = useMemo(() => findOldestTask(tasks), [tasks]);

  const isFirstRun =
    !!counts && counts.repos === 0 && counts.open === 0 && counts.snoozed === 0 && counts.done === 0;

  // Branch priority: focus > onboarding > normal Today. Focus is an explicit
  // user action ("I just told relay to focus #N") so it should win even on
  // an empty DB; the onboarding view exists to bootstrap users who haven't
  // sync'd yet, but `relay focus` already proves they're past that step.
  if (focusTaskId !== null) {
    return (
      <FocusView
        task={focusedTask ?? null}
        focusTaskId={focusTaskId}
        onExit={() => { void exitFocus(); }}
        onChange={() => { void refresh(); }}
        todayLabel={todayLabel}
      />
    );
  }

  if (isFirstRun) {
    return (
      <>
        <OnboardingGuide
          onAddTask={() => setAddTaskOpen(true)}
          onTrackRepos={() => setTrackOpen(true)}
        />
        <TrackReposDialog open={trackOpen} onClose={() => setTrackOpen(false)} />
        <NewTaskDialog open={addTaskOpen} onClose={() => setAddTaskOpen(false)} />
      </>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6 space-y-6 max-w-[1400px]">
        {/* Title row */}
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">{c("today.hero.title")}</h1>
            <p className="text-[13px] text-[var(--color-fg-muted)] mt-0.5">
              {tasks.length > 0
                ? c("common.itemCount", { count: formatNumber(tasks.length) })
                : c("today.hero.empty")}
            </p>
          </div>
          <div className="text-[11px] text-[var(--color-fg-dim)] font-mono tabular">
            {todayLabel}
          </div>
        </div>

        {/* Standup — auto-hides when all three sections are empty. */}
        <StandupPanel onSelectTask={selectTask} />

        {/* Bento grid — 12 col integer layout.
            Row 1: Today(6) + Open(3) + Snoozed(3)
            Row 2: Repos(6) + Contexts(6) */}
        <div className="grid grid-cols-12 gap-3">
          <StatCard
            className="col-span-6"
            label={c("nav.today")}
            value={counts?.today ?? "·"}
            tone="accent"
            size="hero"
          >
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">{c("today.stat.ageMedian")}</div>
            <div className="tabular font-mono text-[12px]">{todayMedianAge}</div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">{c("today.stat.oldestTask")}</div>
            {oldestTask ? (
              <button
                type="button"
                className="max-w-full truncate text-left font-mono text-[12px] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                title={oldestTask.title}
                onClick={() => selectTask(oldestTask.id)}
              >
                {oldestTask.title.slice(0, 24)}
              </button>
            ) : (
              <div className="font-mono text-[12px]">{c("common.none")}</div>
            )}
          </StatCard>
          <StatCard
            className="col-span-3"
            label={c("nav.open")}
            value={counts?.open ?? "·"}
            hint={c("today.stat.openHint")}
            tone="default"
          />
          <StatCard
            className="col-span-3"
            label={c("nav.snoozed")}
            value={counts?.snoozed ?? "·"}
            tone="warm"
          />
          <StatCard
            className="col-span-6"
            label={c("nav.repos")}
            value={counts?.repos ?? "·"}
            tone="cool"
          />
          <StatCard
            className="col-span-6"
            label={c("nav.contexts")}
            value={counts?.contexts ?? "·"}
            hint={c("today.stat.contextsHint")}
          />
        </div>

        {/* Today list + Detail */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 h-10 border-b border-[var(--color-border)]">
            <CardTitle>{c("today.queue.title")}</CardTitle>
            <Link href="/tasks?status=open" className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] flex items-center gap-1">
              {c("today.queue.seeAllOpen")} <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,420px)] min-h-[480px]">
            <div className="overflow-y-auto max-h-[60vh] border-r border-[var(--color-border)]">
              {rows.length === 0 ? (
                <TodayEmptyState />
              ) : (
                <>
                  {/* Stack 1 — "self": things I drive. Always expanded. */}
                  <div>
                    <div className="sticky top-0 z-[5] flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg)]">
                        {c("today.waitOn.self.title")}
                      </span>
                      <span className="text-[11px] tabular text-[var(--color-fg-dim)]">
                        {formatNumber(selfRows.length)}
                      </span>
                      <span className="ml-auto text-[11px] text-[var(--color-fg-dim)]">
                        {c("today.waitOn.self.hint")}
                      </span>
                    </div>
                    {selfRows.length === 0 ? (
                      <div className="px-6 py-6 text-[12.5px] text-[var(--color-fg-dim)]">
                        {c("today.waitOn.self.empty")}
                      </div>
                    ) : (
                      <TaskList
                        rows={selfRows.slice(0, 20)}
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

                  {/* Stack 2 — "waiting on others": reviewer / external / scheduled.
                      Collapsed by default so the morning view stays clean. */}
                  {waitingRows.length > 0 && (
                    <details className="group border-t border-[var(--color-border)]">
                      <summary className="sticky top-0 z-[5] flex cursor-pointer list-none items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-1.5 hover:bg-[var(--color-bg-elev)]/60">
                        <ChevronRight
                          className="w-3 h-3 text-[var(--color-fg-dim)] transition-transform group-open:rotate-90 shrink-0"
                          aria-hidden
                        />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">
                          {c("today.waitOn.others.title")}
                        </span>
                        <span className="text-[11px] tabular text-[var(--color-fg-dim)]">
                          {formatNumber(waitingRows.length)}
                        </span>
                        <span className="ml-auto text-[11px] text-[var(--color-fg-dim)]">
                          {c("today.waitOn.others.hint")}
                        </span>
                      </summary>
                      <TaskList
                        rows={waitingRows.slice(0, 20)}
                        selectedId={selected?.id ?? null}
                        selectedIds={selectedIds}
                        onSelect={selectTask}
                        onRangeSelect={setSelectedIds}
                        onBulkSnooze={(ids) => { void bulkMutate("snooze", ids); }}
                        onBulkClose={(ids) => { void bulkMutate("close", ids); }}
                        onBulkOpenChange={setBulkOpen}
                      />
                    </details>
                  )}
                </>
              )}
            </div>
            <div className="bg-[var(--color-bg-elev)]/30">
              <TaskDetail task={selected} onChange={() => refresh()} />
            </div>
          </div>
        </Card>

        {/* Source breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>{c("today.sourceMix")}</CardTitle>
          </CardHeader>
          <CardBody>
            <SourceMix counts={counts} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

const TODAY_EMPTY_LINKS = [
  { href: "/tasks?status=open&sort=age_desc&limit=5", label: c("today.empty.reviewOldest") },
  { href: "/contexts?from=yesterday", label: c("today.empty.checkYesterday") },
  { href: "/repos?filter=stale", label: c("today.empty.staleRepos") },
] as const;

function TodayEmptyState() {
  return (
    <div className="px-6 py-10">
      <nav aria-label={c("today.empty.recoveryLinks")} className="flex flex-col items-start gap-2">
        {TODAY_EMPTY_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm text-fg-muted transition-colors hover:text-[var(--color-cool)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function FocusView({
  task,
  focusTaskId,
  onExit,
  onChange,
  todayLabel,
}: {
  task: Task | null;
  focusTaskId: number;
  onExit: () => void;
  onChange: () => void;
  todayLabel: string;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6 space-y-6 max-w-[1400px]">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">
              {c("today.focus.banner")}
              <span className="ml-2 font-mono text-[var(--color-accent)]">#{focusTaskId}</span>
            </h1>
            <p className="text-[13px] text-[var(--color-fg-muted)] mt-0.5">
              {c("today.focus.hint")}
            </p>
          </div>
          <div className="text-[11px] text-[var(--color-fg-dim)] font-mono tabular">
            {todayLabel}
          </div>
        </div>

        <Card className="overflow-hidden border-l-2 border-l-[var(--color-accent)]">
          <div className="flex items-center justify-between px-5 h-10 border-b border-[var(--color-border)]">
            <CardTitle>{c("today.focus.taskLabel")}</CardTitle>
            <Button variant="ghost" onClick={onExit}>
              {c("today.focus.exit")}
            </Button>
          </div>
          {task ? (
            <TaskDetail task={task} onChange={onChange} />
          ) : (
            <CardBody>
              <p className="text-[13px] text-[var(--color-fg-muted)]">
                {c("today.focus.missing")}
              </p>
              <div className="mt-3">
                <Button variant="default" onClick={onExit}>
                  {c("today.focus.exit")}
                </Button>
              </div>
            </CardBody>
          )}
        </Card>
      </div>
    </div>
  );
}

function OnboardingGuide({
  onAddTask,
  onTrackRepos,
}: {
  onAddTask: () => void;
  onTrackRepos: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-6 py-12 space-y-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{c("onboarding.title")}</h1>
          <p className="mt-1.5 text-[13px] text-[var(--color-fg-muted)]">{c("onboarding.subtitle")}</p>
        </div>
        <ol className="space-y-3">
          <OnboardingStep
            title={c("onboarding.sync.title")}
            description={c("onboarding.sync.desc")}
            action={<SyncButton />}
          />
          <OnboardingStep
            title={c("onboarding.track.title")}
            description={c("onboarding.track.desc")}
            action={
              <Button variant="default" onClick={onTrackRepos}>
                {c("onboarding.trackRepos")}
              </Button>
            }
          />
          <OnboardingStep
            title={c("onboarding.add.title")}
            description={c("onboarding.add.desc")}
            action={
              <Button variant="default" onClick={onAddTask}>
                {c("onboarding.addTask")}
              </Button>
            }
          />
        </ol>
      </div>
    </div>
  );
}

function OnboardingStep({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/40 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[var(--color-fg)]">{title}</div>
          <p className="mt-1 text-[12.5px] text-[var(--color-fg-muted)]">{description}</p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </li>
  );
}

function formatMedianAge(tasks: Task[]): string {
  const now = Date.now();
  const ages = tasks
    .map((task) => now - new Date(task.created_at).getTime())
    .filter((age) => Number.isFinite(age) && age >= 0)
    .sort((a, b) => a - b);

  if (!ages.length) return c("common.none");

  const mid = Math.floor(ages.length / 2);
  const median = ages.length % 2 === 0
    ? ((ages[mid - 1] ?? 0) + (ages[mid] ?? 0)) / 2
    : ages[mid] ?? 0;

  return formatAgeDuration(median);
}

function formatAgeDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return c("common.now");
  if (mins < 60) return `${formatNumber(mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${formatNumber(hours)}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${formatNumber(days)}d`;
  return `${formatNumber(Math.round(days / 30))}mo`;
}

function findOldestTask(tasks: Task[]): Task | null {
  let oldest: Task | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;

  for (const task of tasks) {
    const createdAt = new Date(task.created_at).getTime();
    if (Number.isFinite(createdAt) && createdAt < oldestTime) {
      oldest = task;
      oldestTime = createdAt;
    }
  }

  return oldest;
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
