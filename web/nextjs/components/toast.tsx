"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { c, formatNumber, formatWeekday } from "@/lib/copy";
import type { Task } from "@/lib/types";
import { useHotkeys } from "@/hooks/use-hotkeys";

type UndoAction = "snooze" | "close";

interface UndoToast {
  id: number;
  taskIds: number[];
  action: UndoAction;
  opKind: UndoAction;
  label: string;
  count: number;
  exiting: boolean;
}

interface ErrorNotice {
  id: number;
  message: string;
  exiting: boolean;
}

interface ToastContextValue {
  pushUndo: (action: UndoAction, task: Task) => void;
  pushError: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_TTL_MS = 5_000;
const MAX_TOASTS = 5;
const TOAST_EXIT_MS = 120;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<UndoToast[]>([]);
  const [errors, setErrors] = useState<ErrorNotice[]>([]);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const errorTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextIdRef = useRef(1);
  const { mutate } = useSWRConfig();

  const removeToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const timer = timersRef.current.get(id);
      if (timer) clearTimeout(timer);
      timersRef.current.delete(id);
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)),
      );
      setTimeout(() => removeToast(id), TOAST_EXIT_MS);
    },
    [removeToast],
  );

  const refreshTaskData = useCallback(async () => {
    await mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/tasks") ||
          key.startsWith("/api/today") ||
          key.startsWith("/api/counts")),
    );
  }, [mutate]);

  const undoToast = useCallback(async (toast: UndoToast) => {
    dismiss(toast.id);
    try {
      await Promise.all(toast.taskIds.map((taskId) => api.reopen(taskId)));
      await refreshTaskData();
    } catch (error) {
      console.warn("undo failed", error);
    }
  }, [dismiss, refreshTaskData]);

  const undoLatest = useCallback(async () => {
    const latest = toasts.at(-1);
    if (!latest) return;
    await undoToast(latest);
  }, [toasts, undoToast]);

  const pushUndo = useCallback(
    (action: UndoAction, task: Task) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      const toast: UndoToast = {
        id,
        taskIds: [task.id],
        action,
        opKind: action,
        label: action === "snooze" ? formatSnoozeLabel(task) : c("toast.closed"),
        count: 1,
        exiting: false,
      };

      const timer = setTimeout(() => dismiss(id), TOAST_TTL_MS);
      timersRef.current.set(id, timer);
      setToasts((current) => {
        const latest = current.at(-1);
        if (latest && latest.opKind === action && !latest.exiting) {
          const latestTimer = timersRef.current.get(latest.id);
          if (latestTimer) clearTimeout(latestTimer);
          timersRef.current.delete(latest.id);
          timersRef.current.set(latest.id, setTimeout(() => dismiss(latest.id), TOAST_TTL_MS));
          clearTimeout(timer);
          timersRef.current.delete(id);

          return current.map((existing) =>
            existing.id === latest.id
              ? {
                  ...existing,
                  taskIds: [...existing.taskIds, task.id],
                  count: existing.count + 1,
                  label: formatCollapsedLabel(action, existing.count + 1),
                }
              : existing,
          );
        }

        const active = current.filter((existing) => !existing.exiting);
        const oldestActive = active.length >= MAX_TOASTS ? active[0] : undefined;
        if (oldestActive) {
          const oldestTimer = timersRef.current.get(oldestActive.id);
          if (oldestTimer) clearTimeout(oldestTimer);
          timersRef.current.delete(oldestActive.id);
          setTimeout(() => removeToast(oldestActive.id), TOAST_EXIT_MS);
        }

        const marked = oldestActive
          ? current.map((existing) =>
              existing.id === oldestActive.id ? { ...existing, exiting: true } : existing,
            )
          : current;
        return [...marked, toast];
      });
    },
    [dismiss, removeToast],
  );

  const dismissError = useCallback((id: number) => {
    const timer = errorTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    errorTimersRef.current.delete(id);
    setErrors((current) =>
      current.map((notice) => (notice.id === id ? { ...notice, exiting: true } : notice)),
    );
    setTimeout(() => {
      setErrors((current) => current.filter((notice) => notice.id !== id));
    }, TOAST_EXIT_MS);
  }, []);

  const pushError = useCallback(
    (message: string) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      errorTimersRef.current.set(id, setTimeout(() => dismissError(id), TOAST_TTL_MS));
      setErrors((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, message, exiting: false }]);
    },
    [dismissError],
  );

  useHotkeys([
    { key: "u", handler: (event) => { event.preventDefault(); void undoLatest(); }, enabled: toasts.length > 0 },
  ]);

  const value = useMemo(() => ({ pushUndo, pushError }), [pushUndo, pushError]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-live="polite"
        aria-label={c("toast.notifications")}
        className="fixed right-4 bottom-4 z-50 flex w-[min(420px,calc(100vw-32px))] flex-col gap-2"
      >
        {errors.map((notice) => (
          <div
            key={`err-${notice.id}`}
            role="alert"
            className={[
              "rounded-[var(--radius-md)] border border-[var(--color-critical)]/50 bg-[var(--color-bg-elev)] px-3 py-2.5 shadow-[var(--shadow-pop)]",
              notice.exiting
                ? "animate-[relay-toast-fade_var(--duration-fast)_var(--ease-out)_reverse_forwards]"
                : "motion-safe:animate-[relay-toast-enter_var(--duration-base)_var(--ease-out)] motion-reduce:animate-[relay-toast-fade_var(--duration-fast)_var(--ease-out)]",
            ].join(" ")}
          >
            <div className="flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 font-medium text-[var(--color-critical)]">
                {notice.message}
              </span>
              <button
                type="button"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                onClick={() => dismissError(notice.id)}
                aria-label={c("toast.dismiss")}
                title={c("common.dismiss")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={[
              "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-2.5 shadow-[var(--shadow-pop)]",
              toast.exiting
                ? "animate-[relay-toast-fade_var(--duration-fast)_var(--ease-out)_reverse_forwards]"
                : "motion-safe:animate-[relay-toast-enter_var(--duration-base)_var(--ease-out)] motion-reduce:animate-[relay-toast-fade_var(--duration-fast)_var(--ease-out)]",
            ].join(" ")}
          >
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-[var(--color-fg)]">{toast.label}</span>
                {toast.count > 1 ? (
                  <>
                    <span> · </span>
                    <span className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg)]">
                      {c("common.actions", { count: formatNumber(toast.count) })}
                    </span>
                  </>
                ) : null}
                <span> · </span>
                <span className="font-mono">⌘Z</span>
                <span> {c("common.toUndo")} · </span>
                <Link href="/tasks?status=snoozed" className="text-[var(--color-accent)] hover:text-[var(--color-fg)]">
                  {c("toast.viewSnoozed")}
                </Link>
              </span>
              <button
                type="button"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                onClick={() => { void undoToast(toast); }}
                aria-label={c("toast.undoAction", {
                  count: formatNumber(toast.count),
                  action: toast.action,
                  noun: toast.count === 1 ? c("toast.action.one") : c("toast.action.many"),
                })}
                title={c("toast.undo")}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                onClick={() => dismiss(toast.id)}
                aria-label={c("toast.dismiss")}
                title={c("common.dismiss")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes relay-toast-enter {
          from {
            opacity: 0;
            transform: translateY(0.5rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes relay-toast-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useUndoToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useUndoToast must be used within ToastProvider");
  }
  return context;
}

function formatSnoozeLabel(task: Task): string {
  if (!task.due_at) return c("toast.snoozed");

  const due = new Date(task.due_at);
  const ms = due.getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return c("toast.snoozed");

  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return c("toast.snoozedUntilWeekday", { days: formatNumber(days), weekday: formatWeekday(due) });
}

function formatCollapsedLabel(action: UndoAction, count: number): string {
  const verb = action === "snooze" ? c("toast.snoozed") : c("toast.closed");
  return `${verb} ${c("common.actions", { count: formatNumber(count) })}`;
}
