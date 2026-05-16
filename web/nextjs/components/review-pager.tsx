"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Check, ChevronLeft, ChevronRight, Pause, X } from "lucide-react";
import { api, type ReviewData } from "@/lib/api";
import { c, formatShortDate } from "@/lib/copy";
import type { Task } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";

type PaneKey = keyof ReviewData;
type Decision = "keep" | "snooze" | "close";

interface Pane {
  key: PaneKey;
  label: string;
}

const PANES: Pane[] = [
  { key: "closed", label: c("review.closedLastWeek") },
  { key: "stale", label: c("review.stale7d") },
  { key: "new", label: c("review.newThisWeek") },
  { key: "unsnoozed", label: c("review.recentlyUnsnoozed") },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function ReviewPager({ initialWeek }: { initialWeek: string }) {
  const online = useOnlineStatus();
  const [week, setWeek] = useState(initialWeek);
  const [activePane, setActivePane] = useState<PaneKey>("closed");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [reviewedIds, setReviewedIds] = useState<Set<number>>(() => new Set());
  const [summary, setSummary] = useState<{ kept: number; snoozed: number; closed: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { mutate } = useSWRConfig();

  const { data, error, isLoading, mutate: refresh } = useSWR<ReviewData>(
    `/api/review?week=${week}`,
    () => api.review(week),
  );

  const activeRows = data?.[activePane] ?? [];
  const allIds = useMemo(() => {
    const ids = new Set<number>();
    if (!data) return ids;
    for (const pane of PANES) {
      for (const task of data[pane.key]) ids.add(task.id);
    }
    return ids;
  }, [data]);

  const complete = allIds.size === 0 || reviewedIds.size >= allIds.size;
  const selectedTask = activeRows.find((task) => task.id === selectedId) ?? activeRows[0] ?? null;
  const nextWeekUntil = useMemo(() => weekStartIso(week, 7), [week]);
  const stateVariant = stateVariantFromError(error, online);

  useEffect(() => {
    setDecisions({});
    setReviewedIds(new Set());
    setSummary(null);
    setSelectedId(null);
  }, [week]);

  useEffect(() => {
    if (selectedTask && selectedTask.id === selectedId) return;
    setSelectedId(activeRows[0]?.id ?? null);
  }, [activePane, activeRows, selectedId, selectedTask]);

  useEffect(() => {
    if (selectedId === null) return;
    const el = listRef.current?.querySelector(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId, activePane]);

  const moveRow = useCallback((delta: number) => {
    if (!activeRows.length) return;
    const current = activeRows.findIndex((task) => task.id === selectedTask?.id);
    const base = current >= 0 ? current : 0;
    const next = Math.max(0, Math.min(activeRows.length - 1, base + delta));
    setSelectedId(activeRows[next]?.id ?? null);
  }, [activeRows, selectedTask]);

  const selectPaneByOffset = useCallback((delta: number) => {
    const current = PANES.findIndex((pane) => pane.key === activePane);
    const next = (current + delta + PANES.length) % PANES.length;
    setActivePane(PANES[next]!.key);
  }, [activePane]);

  const markSelected = useCallback((decision: Decision) => {
    if (!selectedTask) return;
    setDecisions((current) => ({ ...current, [selectedTask.id]: decision }));
    setReviewedIds((current) => {
      const next = new Set(current);
      next.add(selectedTask.id);
      return next;
    });

    const currentIndex = activeRows.findIndex((task) => task.id === selectedTask.id);
    const nextTask = activeRows[currentIndex + 1];
    if (nextTask) {
      setSelectedId(nextTask.id);
      return;
    }
    selectPaneByOffset(1);
  }, [activeRows, selectPaneByOffset, selectedTask]);

  const finishReview = useCallback(async () => {
    if (!data || submitting || !complete) return;
    const snoozeIds = Object.entries(decisions)
      .filter(([, decision]) => decision === "snooze")
      .map(([id]) => Number(id));
    const closeIds = Object.entries(decisions)
      .filter(([, decision]) => decision === "close")
      .map(([id]) => Number(id));

    setSubmitting(true);
    try {
      const [snoozeResult, closeResult] = await Promise.all([
        snoozeIds.length ? api.bulkSnooze(snoozeIds, nextWeekUntil) : Promise.resolve({ ok: true, count: 0 }),
        closeIds.length ? api.bulkClose(closeIds) : Promise.resolve({ ok: true, count: 0 }),
      ]);
      const changed = snoozeResult.count + closeResult.count;
      setSummary({
        kept: Math.max(0, allIds.size - changed),
        snoozed: snoozeResult.count,
        closed: closeResult.count,
      });
      await Promise.all([
        refresh(),
        mutate((key) => typeof key === "string" && key.startsWith("/api/counts")),
      ]);
    } finally {
      setSubmitting(false);
    }
  }, [allIds.size, complete, data, decisions, mutate, nextWeekUntil, refresh, submitting]);

  useHotkeys([
    { key: "j", handler: (event) => { event.preventDefault(); moveRow(1); } },
    { key: "k", handler: (event) => { event.preventDefault(); moveRow(-1); } },
    { key: "Shift+j", handler: (event) => { event.preventDefault(); selectPaneByOffset(1); } },
    { key: "s", handler: (event) => { event.preventDefault(); markSelected("snooze"); }, enabled: !submitting },
    { key: "c", handler: (event) => { event.preventDefault(); markSelected("close"); }, enabled: !submitting },
    { key: "Enter", handler: (event) => { event.preventDefault(); markSelected("keep"); }, enabled: !submitting },
    { key: " ", handler: (event) => { event.preventDefault(); markSelected("keep"); }, enabled: !submitting },
  ]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Sunday Review</h1>
          <p className="text-[12px] text-[var(--color-fg-muted)] font-mono mt-0.5">{week}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" aria-label="Previous week" onClick={() => setWeek(shiftWeek(week, -1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Next week" onClick={() => setWeek(shiftWeek(week, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="primary"
            disabled={!complete || submitting}
            onClick={() => { void finishReview(); }}
          >
            <Check className="w-3.5 h-3.5" />
            Finish review
          </Button>
        </div>
      </div>

      <div className="px-6 border-y border-[var(--color-border)] bg-[var(--color-bg-elev)]/35">
        <div className="flex items-center gap-1 h-11 overflow-x-auto">
          {PANES.map((pane) => {
            const count = data?.[pane.key].length ?? 0;
            return (
              <button
                key={pane.key}
                onClick={() => setActivePane(pane.key)}
                className={cn(
                  "h-8 px-3 rounded-[var(--radius)] text-[12px] whitespace-nowrap transition-colors",
                  activePane === pane.key
                    ? "bg-[var(--color-bg-elev)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-elev)]/70",
                )}
              >
                {pane.label}
                <span className="ml-2 tabular text-[var(--color-fg-dim)]">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {summary && (
        <div className="px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]/55 text-[13px]">
          next-week prep: {summary.kept} kept, {summary.snoozed} snoozed until {formatDate(nextWeekUntil)}, {summary.closed} closed.
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {isLoading && <div className="px-6 py-10 text-[13px] text-[var(--color-fg-dim)]">loading...</div>}
        {stateVariant && (
          <div className="p-6">
            <PageState
              variant={stateVariant}
              hint={stateVariant === "unauthorized" ? "Review data requires reconnecting a source." : "Review data could not be loaded."}
              action={() => refresh()}
            />
          </div>
        )}
        {!isLoading && !stateVariant && (
          <div ref={listRef} className="h-full overflow-y-auto divide-y divide-[var(--color-border)]/60">
            {activeRows.length === 0 ? (
              <div className="p-6">
                <PageState variant="empty" hint="No tasks are available in this review pane." />
              </div>
            ) : (
              activeRows.map((task) => (
                <ReviewRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTask?.id}
                  decision={decisions[task.id] ?? "keep"}
                  reviewed={reviewedIds.has(task.id)}
                  onSelect={setSelectedId}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewRow({
  task,
  selected,
  decision,
  reviewed,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  decision: Decision;
  reviewed: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      data-id={task.id}
      onClick={() => onSelect(task.id)}
      className={cn(
        "w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-left text-[13px] transition-colors border-l-2",
        selected
          ? "bg-[var(--color-bg-elev)] border-l-[var(--color-accent)]"
          : "border-l-transparent hover:bg-[var(--color-bg-elev)]/60",
      )}
    >
      <StatusDot status={task.status} className="shrink-0" />
      <span className="tabular text-[11px] text-[var(--color-fg-dim)] w-12 shrink-0">#{task.id}</span>
      <span className="font-mono text-[11.5px] text-[var(--color-cool)] w-[150px] truncate shrink-0">{task.repo}</span>
      <span className="font-mono text-[11px] text-[var(--color-fg-dim)] w-[108px] truncate shrink-0">{task.assignee}</span>
      <span className={cn("flex-1 truncate", selected && "text-[var(--color-fg)]")}>{task.title}</span>
      <div className="flex items-center gap-2 shrink-0">
        <DecisionMark decision={decision} reviewed={reviewed} />
        <Badge source={task.source_type} />
        <span className="text-[10.5px] text-[var(--color-fg-dim)] tabular w-8 text-right">{timeAgo(task.updated_at)}</span>
      </div>
    </button>
  );
}

function DecisionMark({ decision, reviewed }: { decision: Decision; reviewed: boolean }) {
  if (!reviewed) {
    return <span className="w-6 text-center text-[var(--color-fg-dim)]">-</span>;
  }
  if (decision === "snooze") return <Pause className="w-3.5 h-3.5 text-[var(--color-warm)]" />;
  if (decision === "close") return <X className="w-3.5 h-3.5 text-[var(--color-fg-muted)]" />;
  return <Check className="w-3.5 h-3.5 text-[var(--color-cool)]" />;
}

function shiftWeek(week: string, delta: number): string {
  const start = parseWeekStart(week);
  start.setUTCDate(start.getUTCDate() + delta * 7);
  return formatIsoWeek(start);
}

function weekStartIso(week: string, offsetDays: number): string {
  const start = parseWeekStart(week);
  start.setUTCDate(start.getUTCDate() + offsetDays);
  return start.toISOString();
}

function parseWeekStart(week: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(week);
  const year = match ? Number(match[1]) : new Date().getUTCFullYear();
  const weekNo = match ? Number(match[2]) : 1;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekOneMonday = new Date(jan4.getTime() - (jan4Day - 1) * DAY_MS);
  return new Date(weekOneMonday.getTime() + (weekNo - 1) * 7 * DAY_MS);
}

function formatIsoWeek(date: Date): string {
  const year = isoWeekYear(date);
  const start = isoWeekStart(date);
  const yearStart = isoWeekStart(new Date(Date.UTC(year, 0, 4)));
  const week = Math.floor((start.getTime() - yearStart.getTime()) / (7 * DAY_MS)) + 1;
  return `${year}-${String(week).padStart(2, "0")}`;
}

function isoWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return d.getUTCFullYear();
}

function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function formatDate(value: string): string {
  return formatShortDate(new Date(value));
}
