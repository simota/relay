"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type SessionTaskSummary, type SessionType } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";

// SessionTasksPanel — F-4 task↔session bidirectional nav.
// Collapsed by default to preserve vertical space for the message stream;
// click the header row to expand the full sample list.
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
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCount(null);
    setSample([]);
    setError(null);
    setExpanded(false);
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

  // Hide the panel while loading, on error, and when no tasks exist —
  // none of these are actionable for the viewer and would only steal
  // vertical space from the live message stream.
  if (error) {
    if (typeof console !== "undefined") {
      console.warn(`[relay] sessionTasks fetch failed for ${type}:${sessionId}:`, error);
    }
    return null;
  }
  if (count === null || count === 0) return null;

  const first = sample[0];
  const remaining = count - 1;

  return (
    <div
      className={cn(
        "flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-elev)]/30",
        compact ? "px-3 py-0.5" : "px-4 py-1",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left hover:text-[var(--color-fg)]"
        aria-expanded={expanded}
      >
        <span
          className={cn(
            "font-mono text-[var(--color-fg-dim)] select-none",
            compact ? "text-[10px]" : "text-[10.5px]",
          )}
        >
          {expanded ? "▾" : "▸"}
        </span>
        <span
          className={cn(
            "uppercase tracking-wider font-mono text-[var(--color-fg-dim)] flex-shrink-0",
            compact ? "text-[10px]" : "text-[10.5px]",
          )}
        >
          {c("sessions.detail.tasksHeading", { count: formatNumber(count) })}
        </span>
        {!expanded && first && (
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[var(--color-fg-muted)]",
              compact ? "text-[11px]" : "text-[12px]",
            )}
            title={`#${first.id} · ${first.repo} · ${first.status} · ${first.title}`}
          >
            <span className="text-[var(--color-fg-dim)]">#{first.id}</span>{" "}
            <span className="text-[var(--color-cool)]">{first.repo}</span>{" "}
            <span>{first.title}</span>
            {remaining > 0 && (
              <span className="text-[var(--color-fg-dim)]">
                {" "}
                +{formatNumber(remaining)}
              </span>
            )}
          </span>
        )}
      </button>
      {expanded && (
        <ul className="flex flex-col gap-0.5 mt-1">
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
            <li
              className={cn(
                "text-[var(--color-fg-dim)] font-mono pt-0.5",
                compact ? "text-[10.5px]" : "text-[11px]",
              )}
            >
              + {formatNumber(count - sample.length)} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
