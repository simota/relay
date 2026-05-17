"use client";

// In-app banner for "session is waiting for user input" notices.
//
// Sibling to the OS Notification path mounted in AppShell:
//   - OS notifications can be suppressed when the relay tab itself is
//     focused (macOS Safari, some Chrome configurations) or when the
//     user has never granted Notification permission.
//   - This banner fires regardless, so the user always sees the cue
//     when they actually need to act on a session.
//
// Distinct from the bottom-right undo toast: positioned top-right with
// the warm "attention" color so it cannot be confused with the green
// undo flow, and stays put until clicked/dismissed (no auto-timeout)
// because the whole point is to surface a pending decision.

import Link from "next/link";
import { X } from "lucide-react";
import type { SessionType } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface WaitingNotice {
  id: number;
  type: SessionType;
  sessionId: string;
  repo: string | null;
  title: string;
  createdAt: number;
}

const MAX_VISIBLE = 5;

export function WaitingNoticesBanner({
  notices,
  onDismiss,
}: {
  notices: WaitingNotice[];
  onDismiss: (id: number) => void;
}) {
  if (notices.length === 0) return null;

  // Newest first. Overflow stays in the queue but is hidden; once the
  // user dismisses one, the next surfaces. This caps visual clutter
  // without losing transitions for sessions that piled up while the
  // tab was hidden.
  const visible = [...notices].slice(-MAX_VISIBLE).reverse();
  const hiddenCount = Math.max(0, notices.length - MAX_VISIBLE);

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Sessions waiting for user input"
      className="fixed right-4 top-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 pointer-events-none"
    >
      {hiddenCount > 0 && (
        <div className="self-end text-[10.5px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] pointer-events-auto">
          +{hiddenCount} more waiting
        </div>
      )}
      {visible.map((n) => (
        <div
          key={n.id}
          role="status"
          className={cn(
            "pointer-events-auto rounded-[var(--radius-md)] border px-3 py-2.5",
            "border-[var(--color-warm)] bg-[color-mix(in_oklch,var(--color-warm)_10%,var(--color-bg-elev))]",
            "shadow-[var(--shadow-pop)]",
          )}
        >
          <div className="flex items-start gap-2">
            <span
              className="relay-attention mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-warm)]">
                waiting for user
              </div>
              <Link
                href={`/sessions/detail?s=${n.type}:${encodeURIComponent(n.sessionId)}`}
                onClick={() => onDismiss(n.id)}
                className="mt-0.5 block text-[13px] leading-snug text-[var(--color-fg)] hover:text-[var(--color-accent)] hover:underline"
                title={n.title}
              >
                <span className="font-mono text-[var(--color-fg-muted)]">
                  {n.repo ?? "—"}
                </span>
                <span className="text-[var(--color-fg-dim)]"> · </span>
                <span className="line-clamp-1 inline">{n.title}</span>
              </Link>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(n.id)}
              aria-label="Dismiss notice"
              title="Dismiss"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
