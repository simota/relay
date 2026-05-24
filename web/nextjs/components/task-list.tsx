"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { c, formatNumber } from "@/lib/copy";
import { cn, highlight, timeAgo } from "@/lib/utils";
import { StatusDot, Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { Task } from "@/lib/types";
import type { Filtered } from "@/lib/fuzzy";

interface TaskListProps {
  rows: Filtered<Task>[];
  selectedId: number | null;
  selectedIds?: number[];
  onSelect: (id: number, extend?: boolean) => void;
  onRangeSelect?: (ids: number[]) => void;
  onBulkSnooze?: (ids: number[]) => void;
  onBulkClose?: (ids: number[]) => void;
  onBulkOpenChange?: (open: boolean) => void;
}

export function TaskList({
  rows,
  selectedId,
  selectedIds = [],
  onSelect,
  onRangeSelect,
  onBulkSnooze,
  onBulkClose,
  onBulkOpenChange,
}: TaskListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const bulkIds = useMemo(
    () => (selectedIds.length > 0 ? selectedIds : selectedId === null ? [] : [selectedId]),
    [selectedId, selectedIds],
  );

  const setBulkMode = useCallback(
    (open: boolean) => {
      setBulkOpen(open);
      onBulkOpenChange?.(open);
    },
    [onBulkOpenChange],
  );

  useEffect(() => {
    if (selectedId === null) return;
    const el = ref.current?.querySelector(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const selectRange = useCallback(
    (delta: number) => {
      if (!rows.length || !onRangeSelect) return;
      const current = rows.findIndex((row) => row.task.id === selectedId);
      const start = current >= 0 ? current : 0;
      const end = Math.max(0, Math.min(rows.length - 1, start + delta));
      const [from, to] = start <= end ? [start, end] : [end, start];
      const ids = rows.slice(from, to + 1).map((row) => row.task.id);
      onSelect(rows[end]!.task.id);
      onRangeSelect(ids);
    },
    [onRangeSelect, onSelect, rows, selectedId],
  );

  const runBulkSnooze = useCallback(() => {
    if (!onBulkSnooze || bulkIds.length === 0) return;
    onBulkSnooze(bulkIds);
    setBulkMode(false);
  }, [bulkIds, onBulkSnooze, setBulkMode]);

  const runBulkClose = useCallback(() => {
    if (!onBulkClose || bulkIds.length === 0) return;
    onBulkClose(bulkIds);
    setBulkMode(false);
  }, [bulkIds, onBulkClose, setBulkMode]);

  useHotkeys([
    { key: "Shift+j", handler: (event) => { event.preventDefault(); selectRange(1); }, enabled: Boolean(onRangeSelect) },
    { key: "Shift+k", handler: (event) => { event.preventDefault(); selectRange(-1); }, enabled: Boolean(onRangeSelect) },
    {
      key: "b",
      handler: (event) => { event.preventDefault(); setBulkMode(true); },
      enabled: Boolean(onBulkSnooze || onBulkClose) && bulkIds.length > 0,
    },
    {
      key: "s",
      handler: (event) => { event.preventDefault(); runBulkSnooze(); },
      enabled: bulkOpen && Boolean(onBulkSnooze) && bulkIds.length > 0,
    },
    {
      key: "c",
      handler: (event) => { event.preventDefault(); runBulkClose(); },
      enabled: bulkOpen && Boolean(onBulkClose) && bulkIds.length > 0,
    },
    { key: "Escape", handler: () => setBulkMode(false), enabled: bulkOpen },
  ]);

  if (rows.length === 0) {
    return <div className="px-6 py-10 text-[13px] text-[var(--color-fg-dim)]">{c("tasks.empty")}</div>;
  }

  return (
    <div ref={ref} className="relative divide-y divide-[var(--color-border)]/60">
      {(selectedIds.length > 1 || bulkOpen) && (
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-2 text-[12px] text-[var(--color-fg-muted)]">
          <span>{formatNumber(bulkIds.length)} selected</span>
          <div className="flex items-center gap-2">
            {bulkOpen ? (
              <>
                <button
                  type="button"
                  className="rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg)]"
                  onClick={runBulkSnooze}
                >
                  <Kbd>S</Kbd> snooze
                </button>
                <button
                  type="button"
                  className="rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg)]"
                  onClick={runBulkClose}
                >
                  <Kbd>C</Kbd> close
                </button>
                <button
                  type="button"
                  className="rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg)]"
                  onClick={() => setBulkMode(false)}
                >
                  Esc
                </button>
              </>
            ) : (
              <span>
                <Kbd>B</Kbd> bulk
              </span>
            )}
          </div>
        </div>
      )}
      {rows.map((row) => (
        <TaskRow
          key={row.task.id}
          row={row}
          selected={row.task.id === selectedId}
          rangeSelected={selectedSet.has(row.task.id)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TaskRow({
  row,
  selected,
  rangeSelected,
  onSelect,
}: {
  row: Filtered<Task>;
  selected: boolean;
  rangeSelected: boolean;
  onSelect: (id: number, extend?: boolean) => void;
}) {
  const t = row.task;
  const priorityTone = priorityToneFor(t.priority);
  const age = ageChipFor(t.created_at);
  const snoozedMarker = snoozedMarkerFor(t);

  return (
    <div
      data-id={t.id}
      onClick={(event) => onSelect(t.id, event.shiftKey)}
      className={cn(
        "group w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-left text-[13px] transition-colors cursor-pointer select-none",
        "border-l-2",
        selected
          ? "bg-[var(--color-bg-elev)] border-l-[var(--color-accent)]"
          : rangeSelected
            ? "bg-[var(--color-bg-elev)]/70 border-l-[var(--color-cool)]"
          : "border-l-transparent hover:bg-[var(--color-bg-elev)]/60",
      )}
    >
      {snoozedMarker ? (
        <span
          className="shrink-0 w-10 text-[12px] tabular text-[var(--color-warm)]"
          title={t.due_at ? c("task.snoozedUntil", { date: t.due_at }) : c("task.snoozed")}
        >
          {snoozedMarker}
        </span>
      ) : (
        <StatusDot status={t.status} className="shrink-0" />
      )}
      <span className="tabular text-[12px] text-[var(--color-fg-dim)] w-12 shrink-0">
        #{t.id}
      </span>
      <Link
        href={`/tasks?status=open&repo=${encodeURIComponent(t.repo)}`}
        onClick={(e) => e.stopPropagation()}
        title={c("task.scopeToRepo", { repo: t.repo })}
        className="font-mono text-[12px] text-[var(--color-cool)] w-[140px] truncate shrink-0 hover:underline hover:text-[var(--color-fg)] transition-colors"
      >
        {t.repo}
      </Link>
      <span className="font-mono text-[12px] text-[var(--color-fg-dim)] w-[100px] truncate shrink-0">
        {t.assignee}
      </span>
      <span
        role="img"
        aria-label={`priority: ${priorityTone}`}
        className={cn("priority-dot inline-block w-1 h-1 shrink-0", PRIORITY_DOT_CLASS[priorityTone])}
      />
      <span className={cn("flex-1 truncate min-w-0", selected && "text-[var(--color-fg)]")}>
        {row.titleIndices.length ? highlight(t.title, row.titleIndices) : t.title}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <Badge source={t.source_type} />
        {age && (
          <span
            className={cn(
              "age-chip rounded border px-1.5 py-0.5 text-[11px] leading-none tabular",
              AGE_CHIP_CLASS[age.tone],
            )}
            title={c("task.createdAt", { date: t.created_at })}
          >
            {age.label}
          </span>
        )}
        <span className="text-[11px] text-[var(--color-fg-dim)] tabular w-8 text-right">
          {timeAgo(t.updated_at)}
        </span>
      </div>
    </div>
  );
}

type PriorityTone = "high" | "normal" | "low";

const PRIORITY_DOT_CLASS: Record<PriorityTone, string> = {
  high: "priority-high bg-[var(--color-critical)]",
  normal: "priority-normal bg-[var(--color-fg-muted)]",
  low: "priority-low bg-[var(--color-bg)] border border-[var(--color-border-strong)]",
};

type AgeTone = "week" | "fortnight" | "month";

const AGE_CHIP_CLASS: Record<AgeTone, string> = {
  week: "border-[var(--color-border)] text-[var(--color-fg-dim)] bg-[var(--color-bg-elev)]",
  fortnight: "border-[var(--color-warm)]/40 text-[var(--color-warm)] bg-[var(--color-warm)]/10",
  month: "border-[var(--color-critical)]/40 text-[var(--color-critical)] bg-[var(--color-critical)]/10",
};

function priorityToneFor(priority: number): PriorityTone {
  if (priority >= 70) return "high";
  if (priority < 50) return "low";
  return "normal";
}

function ageChipFor(createdAt: string): { label: string; tone: AgeTone } | null {
  const days = daysSince(createdAt);
  if (days === null || days < 7) return null;
  if (days >= 30) return { label: `${formatNumber(30)}d+`, tone: "month" };
  if (days >= 14) return { label: `${formatNumber(14)}d+`, tone: "fortnight" };
  return { label: `${formatNumber(7)}d`, tone: "week" };
}

function snoozedMarkerFor(task: Task): string | null {
  if (task.status !== "snoozed") return null;
  if (!task.due_at) return "⏸";

  const remainingDays = daysUntil(task.due_at);
  if (remainingDays === null) return "⏸";

  return `⏸ ${formatNumber(remainingDays)}d`;
}

function daysSince(value: string): number | null {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;

  return Math.floor((Date.now() - time) / 86_400_000);
}

function daysUntil(value: string): number | null {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;

  return Math.max(0, Math.ceil((time - Date.now()) / 86_400_000));
}
