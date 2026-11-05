"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Plus, Search } from "lucide-react";
import { useSWRConfig } from "swr";
import { Sidebar } from "@/components/sidebar";
import { CommandMenu } from "@/components/command-menu";
import { SyncButton } from "@/components/sync-button";
import { SyncPreviewButton } from "@/components/sync-preview-button";
import { SyncPill } from "@/components/sync-pill";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { QueueTray } from "@/components/queue-tray";
import { Cheatsheet } from "@/components/cheatsheet";
import { ToastProvider, errorMessage, useUndoToast } from "@/components/toast";
import {
  WaitingNoticesBanner,
  type WaitingNotice,
} from "@/components/waiting-notices-banner";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useConfigSync } from "@/hooks/use-config-sync";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useSessionWaitingNotifications } from "@/hooks/use-session-waiting-notifications";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [cmdRequest, setCmdRequest] = useState(0);
  // Below the md breakpoint the sidebar becomes an off-canvas drawer so the
  // main column keeps the full viewport width.
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRef, navOpen);
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
  ]);

  return (
    <ToastProvider>
      <UndoHotkeys />
      <WaitingNoticesBanner notices={waitingNotices} onDismiss={dismissWaitingNotice} />
      <div className="h-screen flex">
        <div className="hidden md:flex h-full">
          <Suspense fallback={<SidebarPlaceholder />}>
            <Sidebar />
          </Suspense>
        </div>
        {navOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-[var(--color-bg-overlay)] backdrop-blur-[1px]"
              onClick={() => setNavOpen(false)}
              aria-hidden
            />
            <div
              ref={drawerRef}
              id="mobile-nav"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="absolute inset-y-0 left-0 flex bg-[var(--color-bg)] shadow-[var(--shadow-pop)]"
              onKeyDown={(e) => {
                if (e.key === "Escape") setNavOpen(false);
              }}
              onClick={(e) => {
                // Close after picking a destination.
                if ((e.target as HTMLElement).closest("a[href]")) setNavOpen(false);
              }}
            >
              <Suspense fallback={<SidebarPlaceholder />}>
                <Sidebar />
              </Suspense>
            </div>
          </div>
        )}
        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-12 shrink-0 border-b border-[var(--color-border)] flex items-center justify-between gap-2 px-3 md:px-5">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              aria-controls="mobile-nav"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="w-4 h-4" aria-hidden />
            </Button>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-2.5 h-7 min-w-0 flex-1 md:flex-none md:min-w-[200px] max-w-[320px] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] hover:bg-[var(--color-bg-elev-2)] text-[12px] text-[var(--color-fg-muted)] transition-colors ring-focus"
              onClick={() => setCmdRequest((n) => n + 1)}
            >
              <Search className="w-3 h-3 shrink-0" aria-hidden />
              <span className="truncate">Search…</span>
              <Kbd className="ml-auto hidden md:inline-flex">⌘K</Kbd>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <SyncPill />
              <Button size="sm" onClick={() => setNewTaskOpen(true)} aria-label="New task">
                <Plus className="w-3 h-3" aria-hidden />
                <span className="hidden sm:inline">New task</span>
                <Kbd className="ml-1 hidden sm:inline-flex">N</Kbd>
              </Button>
              <div className="hidden md:block">
                <SyncPreviewButton />
              </div>
              <SyncButton hotkey />
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

/**
 * Global ⌘Z / ⇧⌘Z (server-side undo log). Rendered inside ToastProvider so
 * a failed undo/redo is reported to the user instead of only the console.
 */
function UndoHotkeys() {
  const { mutate } = useSWRConfig();
  const { pushError } = useUndoToast();

  const runUndo = async (redo: boolean) => {
    try {
      await api.undo(redo);
      await mutate(
        (key) =>
          typeof key === "string" &&
          (key.startsWith("/api/tasks") ||
            key.startsWith("/api/today") ||
            key.startsWith("/api/counts") ||
            key.startsWith("/api/undo")),
      );
    } catch (error) {
      console.warn(redo ? "redo failed" : "undo failed", error);
      pushError(c(redo ? "toast.redoFailed" : "toast.undoFailed", { reason: errorMessage(error) }));
    }
  };

  useHotkeys([
    { key: "Meta+z", handler: (event) => { event.preventDefault(); void runUndo(false); } },
    { key: "Meta+Shift+z", handler: (event) => { event.preventDefault(); void runUndo(true); } },
  ]);

  return null;
}

function SidebarPlaceholder() {
  return (
    <aside
      className="h-full w-[220px] shrink-0 border-r border-[var(--color-border)]"
      aria-hidden
    />
  );
}
