"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Home, Inbox, Pause, Check, Box, Clock,
  RefreshCw, ArrowRight, Plus,
} from "lucide-react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import { fuzzyFilter } from "@/lib/fuzzy";
import { cn, highlight } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import type { Task } from "@/lib/types";
import type { SavedView, ViewFilter } from "@/lib/api";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useHotkeys } from "@/hooks/use-hotkeys";

interface MenuAction {
  type: "nav" | "action" | "task" | "view";
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void | Promise<void>;
  task?: Task;
  titleIndices?: number[];
}

interface CommandMenuProps {
  externalOpen?: number;       // bump to request open
  onNewTask?: () => void;
}

export function CommandMenu({ externalOpen, onNewTask }: CommandMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  const { data: tasks = [] } = useSWR<Task[]>(
    open ? "/api/tasks?limit=500" : null,
    () => api.tasks({ limit: 500 }),
  );
  const { data: views = [] } = useSWR<SavedView[]>(
    open ? "/api/views" : null,
    () => api.views.list(),
  );

  // External open requests
  useEffect(() => {
    if (externalOpen !== undefined && externalOpen > 0) setOpen(true);
  }, [externalOpen]);

  useHotkeys([
    {
      key: "Meta+k",
      handler: (e) => { e.preventDefault(); setOpen((v) => !v); },
      allowInInput: true,
    },
  ]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open]);

  const baseActions: MenuAction[] = useMemo(() => [
    { type: "action", label: c("command.newTask"), hint: c("command.newTaskHint"), icon: <Plus className="w-3.5 h-3.5" />, run: () => onNewTask?.() },
    { type: "nav", label: c("nav.today"), icon: <Home className="w-3.5 h-3.5" />, run: () => router.push("/") },
    { type: "nav", label: c("nav.openTasks"), icon: <Inbox className="w-3.5 h-3.5" />, run: () => router.push("/tasks?status=open") },
    { type: "nav", label: c("nav.snoozed"), icon: <Pause className="w-3.5 h-3.5" />, run: () => router.push("/tasks?status=snoozed") },
    { type: "nav", label: c("nav.done"), icon: <Check className="w-3.5 h-3.5" />, run: () => router.push("/tasks?status=done") },
    { type: "nav", label: c("nav.repos"), icon: <Box className="w-3.5 h-3.5" />, run: () => router.push("/repos") },
    { type: "nav", label: c("nav.contexts"), icon: <Clock className="w-3.5 h-3.5" />, run: () => router.push("/contexts") },
    { type: "action", label: c("command.runSync"), hint: c("command.runSyncHint"), icon: <RefreshCw className="w-3.5 h-3.5" />, run: async () => { await api.sync(); } },
  ], [router, onNewTask]);

  const items: MenuAction[] = useMemo(() => {
    const viewActions = views.map<MenuAction>((view) => ({
      type: "view",
      label: c("command.view", { name: view.name }),
      hint: c("common.items", { count: formatNumber(view.count) }),
      icon: <Inbox className="w-3.5 h-3.5" />,
      run: () => router.push(viewHref(view.filter)),
    }));
    if (!q.trim()) return [...baseActions, ...viewActions];
    const navMatches = baseActions.filter((a) =>
      a.label.toLowerCase().includes(q.toLowerCase()),
    );
    const viewMatches = viewActions.filter((a) =>
      a.label.toLowerCase().includes(q.toLowerCase()),
    );
    const taskMatches = fuzzyFilter(tasks, q).slice(0, 12).map<MenuAction>((r) => ({
      type: "task",
      label: r.task.title,
      hint: `${r.task.repo} · #${r.task.id}`,
      icon: <ArrowRight className="w-3.5 h-3.5" />,
      run: () => router.push(`/tasks?status=${r.task.status}`),
      task: r.task,
      titleIndices: r.titleIndices,
    }));
    return [...navMatches, ...viewMatches, ...taskMatches];
  }, [q, baseActions, views, tasks, router]);

  useHotkeys([
    {
      key: "ArrowDown",
      handler: (e) => { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); },
      enabled: open,
      allowInInput: true,
    },
    {
      key: "ArrowUp",
      handler: (e) => { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); },
      enabled: open,
      allowInInput: true,
    },
    {
      key: "Enter",
      handler: (e) => {
        e.preventDefault();
        const item = items[idx];
        if (item) {
          item.run();
          setOpen(false);
        }
      },
      enabled: open,
      allowInInput: true,
    },
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] glass"
      onClick={() => setOpen(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={c("command.menu")}
        className="w-[640px] max-w-[92vw] rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-bg-elev)] shadow-[var(--shadow-pop)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 h-12 border-b border-[var(--color-border)]">
          <Search className="w-3.5 h-3.5 text-[var(--color-fg-dim)]" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            placeholder={c("command.placeholder")}
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-[var(--color-fg-dim)]"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1.5">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-[var(--color-fg-dim)] text-center">{c("common.noResults")}</div>
          ) : (
            items.map((item, i) => (
              <button
                key={`${item.type}-${i}-${item.label}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => { item.run(); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 h-9 text-left text-[13px]",
                  i === idx
                    ? "bg-[var(--color-bg-elev-2)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elev-2)]",
                )}
              >
                <span className="text-[var(--color-fg-dim)]">{item.icon}</span>
                <span className="flex-1 truncate">
                  {item.titleIndices ? highlight(item.label, item.titleIndices) : item.label}
                </span>
                {item.hint && (
                  <span className="text-[11px] text-[var(--color-fg-dim)] font-mono">{item.hint}</span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between px-4 h-8 border-t border-[var(--color-border)] text-[10.5px] text-[var(--color-fg-dim)]">
          <span>{c("command.footer")}</span>
          <span className="flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            <span>{c("command.toggle")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function viewHref(filter: ViewFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.repo) params.set("repo", filter.repo);
  if (filter.source) params.set("source", filter.source);
  if (filter.age) params.set("age", filter.age);
  const qs = params.toString();
  return `/tasks${qs ? `?${qs}` : ""}`;
}
