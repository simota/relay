"use client";

// Permission request chip for the sessions page header. Paired with
// useSessionWaitingNotifications — that hook fires Notifications only
// when permission is `granted`, so the user needs an obvious way to opt
// in. Browser policy requires the request to be tied to a user gesture,
// which is exactly what a button click is.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Perm = NotificationPermission | "unsupported";

export function NotificationPermissionButton({ className }: { className?: string }) {
  const [perm, setPerm] = useState<Perm>("unsupported");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPerm("unsupported");
      return;
    }
    setPerm(Notification.permission);
  }, []);

  if (perm === "unsupported") return null;

  // Permission is granted — show a tiny confirmation chip so the user
  // knows notifications are armed. Kept passive (no click handler) since
  // the only way to revoke from inside a page is browser settings.
  if (perm === "granted") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] border text-[11px] border-[var(--color-border)] text-[var(--color-fg-muted)]",
          className,
        )}
        title="Browser notifications enabled for sessions waiting on user input"
        role="status"
      >
        <span aria-hidden>🔔</span>
        notifications on
      </span>
    );
  }

  // Permission was previously denied — we cannot programmatically re-prompt;
  // surface the state and point the user at browser settings.
  if (perm === "denied") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] border text-[11px] border-[var(--color-border)] text-[var(--color-fg-dim)]",
          className,
        )}
        title="Notifications are blocked. Allow them from your browser's site settings to re-enable."
        role="status"
      >
        <span aria-hidden>🔕</span>
        notifications blocked
      </span>
    );
  }

  // perm === "default" → ask the user.
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          const next = await Notification.requestPermission();
          setPerm(next);
        } catch {
          // Some browsers throw if called outside a user gesture or in
          // an unsupported context. Fall back to "denied" visual so the
          // user gets feedback that the action did not stick.
          setPerm("denied");
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] border text-[11px] border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-fg-muted)] transition-colors",
        className,
      )}
      title="Allow browser notifications when a session needs user input"
    >
      <span aria-hidden>🔔</span>
      enable notifications
    </button>
  );
}
