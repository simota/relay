"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type SessionTaskSummary, type SessionType } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SessionTasksPanel — F-4 task↔session bidirectional nav.
// Fetches `/api/sessions/:type/:id/tasks` once per session id and renders a
// compact panel between the tile header and the tab bar.
// ---------------------------------------------------------------------------
export function SessionTasksPanel({
  type,
  sessionId,
  compact,
}: {
  type: SessionType;
  sessionId: string;
  compact: boolean;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [sample, setSample] = useState<SessionTaskSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCount(null);
    setSample([]);
    setError(null);
    void api
      .sessionTasks(type, sessionId)
      .then((res) => {
        if (cancelled) return;
        setCount(res.count);
        setSample(res.sample);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [type, sessionId]);

  // Hide the panel while loading and on error — both are non-actionable for
  // the user and would only add visual noise to a viewer focused on the
  // live message stream. Errors still surface in the browser console.
  if (error) {
    if (typeof console !== "undefined") {
      console.warn(`[relay] sessionTasks fetch failed for ${type}:${sessionId}:`, error);
    }
    return null;
  }
  if (count === null) return null;

  return (
    <div
      className={cn(
        "flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-elev)]/30",
        compact ? "px-3 py-1.5" : "px-4 py-2",
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            "uppercase tracking-wider font-mono text-[var(--color-fg-dim)]",
            compact ? "text-[10px]" : "text-[10.5px]",
          )}
        >
          {c("sessions.detail.tasksHeading", { count: formatNumber(count) })}
        </span>
      </div>
      {count === 0 ? (
        <p className={cn("text-[var(--color-fg-dim)]", compact ? "text-[11px]" : "text-[12px]")}>
          {c("sessions.detail.noTasks")}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sample.map((t) => {
            // Tasks page expects a `status` query (defaults to "open" when
            // omitted) and a `repo` filter. Linking with the row's actual
            // status keeps closed/snoozed tasks visible from the panel,
            // which matters for sessions whose todos are already done.
            const href = `/tasks?status=${encodeURIComponent(t.status)}&repo=${encodeURIComponent(t.repo)}`;
            return (
              <li key={t.id}>
                <Link
                  href={href}
                  className={cn(
                    "block truncate font-mono hover:text-[var(--color-fg)] hover:underline text-[var(--color-fg-muted)]",
                    compact ? "text-[11px]" : "text-[12px]",
                  )}
                  title={`#${t.id} · ${t.repo} · ${t.status} · ${t.title}`}
                >
                  <span className="text-[var(--color-fg-dim)]">#{t.id}</span>{" "}
                  <span className="text-[var(--color-cool)]">{t.repo}</span>{" "}
                  <span>{t.title}</span>
                </Link>
              </li>
            );
          })}
          {count > sample.length && (
            <li className={cn("text-[var(--color-fg-dim)] font-mono pt-0.5", compact ? "text-[10.5px]" : "text-[11px]")}>
              + {formatNumber(count - sample.length)} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
