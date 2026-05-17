"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useSWRConfig } from "swr";
import { Sidebar } from "@/components/sidebar";
import { CommandMenu } from "@/components/command-menu";
import { SyncButton } from "@/components/sync-button";
import { SyncPreviewButton } from "@/components/sync-preview-button";
import { SyncPill } from "@/components/sync-pill";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { QueueTray } from "@/components/queue-tray";
import { Cheatsheet } from "@/components/cheatsheet";
import { ToastProvider } from "@/components/toast";
import {
  WaitingNoticesBanner,
  type WaitingNotice,
} from "@/components/waiting-notices-banner";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useConfigSync } from "@/hooks/use-config-sync";
import { useSessionWaitingNotifications } from "@/hooks/use-session-waiting-notifications";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [cmdRequest, setCmdRequest] = useState(0);
  const { mutate } = useSWRConfig();

  useConfigSync();

  // In-app banner state for sessions waiting on user input. Complements
  // the OS Notification path inside useSessionWaitingNotifications —
  // banner fires for every transition regardless of permission/focus,
  // OS notification fires when allowed. Stable callback so the hook's
  // useEffect dependency does not churn each render.
  const [waitingNotices, setWaitingNotices] = useState<WaitingNotice[]>([]);
  const nextWaitingIdRef = useRef(1);
  const handleWaitingTransition = useCallback(
    (session: {
      type: WaitingNotice["type"];
      id: string;
      repo: string | null;
      title: string;
    }) => {
      setWaitingNotices((current) => {
        const id = nextWaitingIdRef.current++;
        return [
          ...current,
          {
            id,
            type: session.type,
            sessionId: session.id,
            repo: session.repo,
            title: session.title,
            createdAt: Date.now(),
          },
        ];
      });
    },
    [],
  );
  const dismissWaitingNotice = useCallback((id: number) => {
    setWaitingNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  // Global notifier mounted at shell. Fires on every page; the in-app
  // banner ensures users see the cue even when OS notifications are
  // suppressed (focused tab, denied permission, unsupported browser).
  useSessionWaitingNotifications({ onWaitingTransition: handleWaitingTransition });

  const refreshTaskData = async () => {
    await mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/tasks") ||
          key.startsWith("/api/today") ||
          key.startsWith("/api/counts") ||
          key.startsWith("/api/undo")),
    );
  };

  const runUndo = async (redo: boolean) => {
    try {
      await api.undo(redo);
      await refreshTaskData();
    } catch (error) {
      console.warn(redo ? "redo failed" : "undo failed", error);
    }
  };

  useHotkeys([
    // g-leader navigation (vim-style)
    { key: "g t", handler: () => router.push("/") },
    { key: "g a", handler: () => router.push("/agenda") },
    { key: "g o", handler: () => router.push("/tasks?status=open") },
    { key: "g s", handler: () => router.push("/tasks?status=snoozed") },
    { key: "g d", handler: () => router.push("/tasks?status=done") },
    { key: "g r", handler: () => router.push("/repos") },
    { key: "g c", handler: () => router.push("/contexts") },
    { key: "g n", handler: () => setNewTaskOpen(true) },

    // Quick single-key aliases (only when not in an input)
    { key: "n", handler: () => setNewTaskOpen(true), enabled: !newTaskOpen },
    { key: "Meta+z", handler: (event) => { event.preventDefault(); void runUndo(false); } },
    { key: "Meta+Shift+z", handler: (event) => { event.preventDefault(); void runUndo(true); } },
  ]);

  return (
    <ToastProvider>
      <WaitingNoticesBanner notices={waitingNotices} onDismiss={dismissWaitingNotice} />
      <div className="h-screen flex">
        <Suspense
          fallback={
            <aside
              className="h-full w-[220px] shrink-0 border-r border-[var(--color-border)]"
              aria-hidden
            />
          }
        >
          <Sidebar />
        </Suspense>
        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-12 shrink-0 border-b border-[var(--color-border)] flex items-center justify-between px-5">
            <button
              className="inline-flex items-center gap-2 px-2.5 h-7 min-w-[200px] max-w-[320px] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] hover:bg-[var(--color-bg-elev-2)] text-[12px] text-[var(--color-fg-muted)] transition-colors"
              onClick={() => setCmdRequest((n) => n + 1)}
            >
              <Search className="w-3 h-3" aria-hidden />
              <span>Search…</span>
              <Kbd className="ml-auto">⌘K</Kbd>
            </button>
            <div className="flex items-center gap-2">
              <SyncPill />
              <Button size="sm" onClick={() => setNewTaskOpen(true)}>
                <Plus className="w-3 h-3" />
                New task
                <Kbd className="ml-1">N</Kbd>
              </Button>
              <SyncPreviewButton />
              <SyncButton />
            </div>
          </header>
          <div className="flex-1 overflow-hidden">{children}</div>
          <QueueTray />
        </main>
      </div>
      <CommandMenu
        externalOpen={cmdRequest}
        onNewTask={() => setNewTaskOpen(true)}
      />
      <Cheatsheet />
      <NewTaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
    </ToastProvider>
  );
}
