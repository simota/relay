"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { c, formatNumber } from "@/lib/copy";
import { cn, highlight, timeAgo } from "@/lib/utils";
import { StatusDot, Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { Assignee, Task } from "@/lib/types";

const ASSIGNEES: Assignee[] = ["claude-code", "codex", "antigravity", "self", "human-review"];
import type { Filtered } from "@/lib/fuzzy";

interface TaskListProps {
  rows: Filtered<Task>[];
  selectedId: number | null;
  selectedIds?: number[];
  onSelect: (id: number, extend?: boolean) => void;
  onToggleSelect?: (id: number) => void;
  onRangeSelect?: (ids: number[]) => void;
  onBulkSnooze?: (ids: number[]) => void;
  onBulkClose?: (ids: number[]) => void;
  /** Add the selection to the AI job queue (run later with `relay queue run`). */
  onBulkQueue?: (ids: number[]) => void;
  /** Hand the selection to one agent. */
  onBulkAssign?: (ids: number[], assignee: Assignee) => void;
  /** Add / remove tags on the selection. */
  onBulkTag?: (ids: number[]) => void;
  /** task id → open blocker ids (dependency-blocked rows get a ⛓ badge). */
  blockedMap?: ReadonlyMap<number, number[]>;
  onBulkOpenChange?: (open: boolean) => void;
  showBulkBar?: boolean;
}

export function TaskList({
  rows,
  selectedId,
  selectedIds = [],
  onSelect,
  onToggleSelect,
  onRangeSelect,
  onBulkSnooze,
  onBulkClose,
  onBulkQueue,
  onBulkAssign,
  onBulkTag,
  blockedMap,
  onBulkOpenChange,
  showBulkBar = true,
}: TaskListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const bulkIds = useMemo(
    () => (selectedIds.length > 0 ? selectedIds : selectedId === null ? [] : [selectedId]),
    [selectedId, selectedIds],
  );
  const visibleIds = useMemo(() => rows.map((row) => row.task.id), [rows]);
  const selectedVisibleCount = useMemo(
    () => visibleIds.filter((id) => selectedSet.has(id)).length,
    [selectedSet, visibleIds],
  );
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

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

  const runBulkQueue = useCallback(() => {
    if (!onBulkQueue || bulkIds.length === 0) return;
    onBulkQueue(bulkIds);
    setBulkMode(false);
  }, [bulkIds, onBulkQueue, setBulkMode]);

  const runBulkAssign = useCallback(
    (assignee: Assignee) => {
      if (!onBulkAssign || bulkIds.length === 0) return;
      onBulkAssign(bulkIds, assignee);
    },
    [bulkIds, onBulkAssign],
  );

  const toggleAllVisible = useCallback(() => {
    if (!onRangeSelect) return;
    if (allVisibleSelected) {
      onRangeSelect(selectedIds.filter((id) => !visibleIds.includes(id)));
      return;
    }
    onRangeSelect(Array.from(new Set([...selectedIds, ...visibleIds])));
  }, [allVisibleSelected, onRangeSelect, selectedIds, visibleIds]);

  useHotkeys([
    { key: "Shift+j", handler: (event) => { event.preventDefault(); selectRange(1); }, enabled: Boolean(onRangeSelect) },
    { key: "Shift+k", handler: (event) => { event.preventDefault(); selectRange(-1); }, enabled: Boolean(onRangeSelect) },
    {
      key: "b",
      handler: (event) => { event.preventDefault(); setBulkMode(true); },
      enabled: Boolean(onBulkSnooze || onBulkClose || onBulkQueue) && bulkIds.length > 0,
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
    {
      key: "a",
      handler: (event) => { event.preventDefault(); runBulkQueue(); },
      enabled: bulkOpen && Boolean(onBulkQueue) && bulkIds.length > 0,
    },
    { key: "Escape", handler: () => setBulkMode(false), enabled: bulkOpen },
  ]);

  if (rows.length === 0) {
    return <div className="px-6 py-10 text-[13px] text-[var(--color-fg-dim)]">{c("tasks.empty")}</div>;
  }

  return (
    <div ref={ref} className="@container relative divide-y divide-[var(--color-border)]/60">
      {showBulkBar && Boolean(onRangeSelect) && (
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-2 text-[12px] text-[var(--color-fg-muted)]">
          <label className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected;
              }}
              onChange={toggleAllVisible}
              className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
              aria-label="toggle visible tasks"
            />
            <span>
              {bulkIds.length > 0 ? `${formatNumber(bulkIds.length)} selected` : "Select visible"}
            </span>
          </label>
          <div className="flex items-center gap-2">
            {bulkOpen && <Kbd>B</Kbd>}
            <button
              type="button"
              className="rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg)]"
              disabled={bulkIds.length === 0}
              onClick={runBulkSnooze}
            >
              <Kbd>S</Kbd> snooze
            </button>
            <button
              type="button"
              className="rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1 text-[var(--color-critical)] hover:bg-[var(--color-critical)]/10"
              disabled={bulkIds.length === 0}
              onClick={runBulkClose}
            >
              <Kbd>C</Kbd> close
            </button>
            {onBulkQueue && (
              <button
                type="button"
                className="rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg)]"
                disabled={bulkIds.length === 0}
                onClick={runBulkQueue}
                title="Add to the AI job queue (relay queue run)"
              >
                <Kbd>A</Kbd> queue
              </button>
            )}
            {onBulkTag && (
              <button
                type="button"
                className="rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg)]"
                disabled={bulkIds.length === 0}
                onClick={() => onBulkTag(bulkIds)}
                title="Add or remove tags on the selection (⌘Z to undo)"
              >
                # tag…
              </button>
            )}
            {onBulkAssign && (
              <select
                aria-label="assign selected tasks to"
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-1.5 py-1 text-[12px] hover:bg-[var(--color-bg)]"
                disabled={bulkIds.length === 0}
                value=""
                onChange={(event) => {
                  const value = event.target.value as Assignee;
                  if (value) runBulkAssign(value);
                  event.target.blur();
                }}
              >
                <option value="">assign…</option>
                {ASSIGNEES.map((assignee) => (
                  <option key={assignee} value={assignee}>{assignee}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg)]"
              disabled={selectedIds.length === 0 && !bulkOpen}
              onClick={() => {
                onRangeSelect?.([]);
                setBulkMode(false);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {rows.map((row) => (
        <TaskRow
          key={row.task.id}
          row={row}
          selected={row.task.id === selectedId}
          rangeSelected={selectedSet.has(row.task.id)}
          selectionMode={selectedIds.length > 0 || bulkOpen}
          blockers={blockedMap?.get(row.task.id)}
          onSelect={onSelect}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}

function TaskRow({
  row,
  selected,
  rangeSelected,
  selectionMode,
  blockers,
  onSelect,
  onToggleSelect,
}: {
  row: Filtered<Task>;
  selected: boolean;
  rangeSelected: boolean;
  selectionMode: boolean;
  blockers?: number[];
  onSelect: (id: number, extend?: boolean) => void;
  onToggleSelect?: (id: number) => void;
}) {
  const t = row.task;
  const priorityTone = priorityToneFor(t.priority);
  const age = ageChipFor(t.created_at);
  const snoozedMarker = snoozedMarkerFor(t);

  return (
    <div
      data-id={t.id}
      onClick={(event) => {
        if (selectionMode) return;
        onSelect(t.id, event.shiftKey);
      }}
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
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={rangeSelected}
          onChange={() => onToggleSelect(t.id)}
          onClick={(event) => event.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          aria-label={`select task ${t.id}`}
        />
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
      <span className={cn("flex-1 truncate min-w-[96px]", selected && "text-[var(--color-fg)]")}>
        {row.titleIndices.length ? highlight(t.title, row.titleIndices) : t.title}
      </span>
      {(t.tags?.length ?? 0) > 0 && (
        // Tags yield space to the title: the strip shrinks first, and chips
        // that no longer fit wrap onto a clipped second line (whole chips
        // disappear instead of being squeezed into slivers).
        // Hidden when the list column is narrow; the detail panel, sidebar
        // and `tag:` filter still surface tags there.
        <div className="hidden @[760px]:flex h-[18px] min-w-0 shrink-[2] flex-wrap items-center gap-1 overflow-hidden" aria-label={`tags: ${t.tags!.join(", ")}`}>
          {t.tags!.slice(0, 2).map((tag) => (
            <Link
              key={tag}
              href={`/tasks?status=open&tag=${encodeURIComponent(tag)}`}
              onClick={(e) => e.stopPropagation()}
              title={`show open tasks tagged #${tag}`}
              className="shrink-0 max-w-[88px] truncate rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] leading-none font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-border-strong)]"
            >
              #{tag}
            </Link>
          ))}
          {t.tags!.length > 2 && (
            <span className="shrink-0 text-[11px] text-[var(--color-fg-dim)]" title={t.tags!.slice(2).map((tag) => `#${tag}`).join(" ")}>
              +{formatNumber(t.tags!.length - 2)}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 shrink-0">
        {blockers && blockers.length > 0 && (
          <span
            role="img"
            aria-label={`blocked by ${blockers.map((id) => `task ${id}`).join(", ")}`}
            title={`waiting on ${blockers.map((id) => `#${id}`).join(" ")} — hidden from Today until done`}
            className="rounded border border-[var(--color-warm)]/40 bg-[var(--color-warm)]/10 px-1.5 py-0.5 text-[11px] leading-none tabular text-[var(--color-warm)]"
          >
            ⛓ {blockers.length === 1 ? `#${blockers[0]}` : formatNumber(blockers.length)}
          </span>
        )}
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
