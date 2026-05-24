"use client";

import Link from "next/link";
import { ListChecks, MessageSquare } from "lucide-react";
import { contextSessionHref, contextSessionLabel, contextSessionType } from "@/lib/context-session";
import { c, formatNumber } from "@/lib/copy";
import { cn, timeAgo } from "@/lib/utils";
import type { RelayContext } from "@/lib/types";

/**
 * One row in the repo-grouped contexts timeline. Click selects the row
 * (master/detail pattern — detail renders in the right column). Chips for
 * linked tasks / session jump stay clickable independently via
 * stopPropagation so a user can drill into the linked surface without
 * losing the selected detail in the right pane.
 */
export function ContextItem({
  ctx,
  isLast,
  selected,
  onSelect,
}: {
  ctx: RelayContext;
  isLast: boolean;
  selected: boolean;
  onSelect: (hash: string) => void;
}) {
  const sessionType = contextSessionType(ctx);
  const sessionHref = contextSessionHref(ctx);
  const sessionLabel = contextSessionLabel(sessionType);
  const tasksHref = ctx.linkedTasksCount > 0
    ? `/tasks?status=open&repo=${encodeURIComponent(ctx.repo)}`
    : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(ctx.hash)}
      aria-pressed={selected}
      className={cn(
        "group relative block w-full text-left pl-8 pr-4 py-4 transition-colors",
        selected
          ? "bg-[var(--color-accent)]/[0.08]"
          : "hover:bg-[var(--color-bg-elev)]/40",
      )}
    >
      <span
        className={cn(
          "absolute left-2 top-5 w-2 h-2 rounded-full shadow-[0_0_0_3px_var(--color-bg)] z-10",
          selected ? "bg-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/40" : "bg-[var(--color-accent)]",
        )}
      />
      {!isLast && (
        <span className="absolute left-[11px] top-7 bottom-0 w-px bg-[var(--color-border)]" />
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[12px] flex-wrap">
            <span className="font-mono text-[10.5px] text-[var(--color-fg-dim)] tabular group-hover:text-[var(--color-fg-muted)]">
              {ctx.hash.slice(0, 10)}
            </span>
            <span className="text-[var(--color-fg-dim)]">·</span>
            <span className="font-mono text-[var(--color-fg-muted)]">{ctx.branch}</span>
            <span className="font-mono text-[10.5px] text-[var(--color-fg-dim)] tabular">
              {ctx.headSha.slice(0, 7)}
            </span>
            {ctx.dirtyFiles.length > 0 && (
              <span className="text-[10.5px] font-mono text-[var(--color-warm)]">
                {c("contexts.dirty", { count: formatNumber(ctx.dirtyFiles.length) })}
              </span>
            )}
            {ctx.linkedTasksCount > 0 && tasksHref && (
              <Link
                href={tasksHref}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-fg-muted)] transition-colors"
                title={`${ctx.linkedTasksCount} linked task${ctx.linkedTasksCount === 1 ? "" : "s"} in this repo`}
              >
                <ListChecks className="w-3 h-3" aria-hidden />
                <span className="tabular">{formatNumber(ctx.linkedTasksCount)}</span>
              </Link>
            )}
            {ctx.sessionId && sessionHref && (
              <Link
                href={sessionHref}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06] text-[10px] font-mono text-[var(--color-accent)] hover:bg-[var(--color-accent)]/15 transition-colors"
                title={`Jump to ${sessionLabel} session ${ctx.sessionId}`}
              >
                <MessageSquare className="w-3 h-3" aria-hidden />
                <span className="tabular">{sessionType}:{ctx.sessionId.slice(0, 8)}</span>
              </Link>
            )}
          </div>
          <pre className="mt-1.5 font-mono text-[11.5px] text-[var(--color-fg-muted)] whitespace-pre-wrap leading-relaxed line-clamp-3">
            {ctx.summary}
          </pre>
        </div>
        <div className="text-[10.5px] font-mono text-[var(--color-fg-dim)] whitespace-nowrap pt-0.5">
          {timeAgo(ctx.createdAt)} ago
        </div>
      </div>
    </button>
  );
}
