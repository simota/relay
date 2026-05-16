"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { c, formatNumber } from "@/lib/copy";
import { timeAgo } from "@/lib/utils";
import type { RelayContext } from "@/lib/types";

export function ContextItem({ ctx, isLast }: { ctx: RelayContext; isLast: boolean }) {
  return (
    <Link
      href={`/context?hash=${encodeURIComponent(ctx.hash)}`}
      className="group relative block pl-8 pr-4 py-4 hover:bg-[var(--color-bg-elev)]/40 transition-colors"
    >
      <span className="absolute left-2 top-5 w-2 h-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-bg)] z-10" />
      {!isLast && (
        <span className="absolute left-[11px] top-7 bottom-0 w-px bg-[var(--color-border)]" />
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-mono text-[10.5px] text-[var(--color-fg-dim)] tabular group-hover:text-[var(--color-fg-muted)]">
              {ctx.hash.slice(0, 10)}
            </span>
            <span className="text-[var(--color-fg-dim)]">·</span>
            <Link
              href={`/tasks?status=open&repo=${encodeURIComponent(ctx.repo)}`}
              onClick={(e) => e.stopPropagation()}
              title={c("contexts.scopeTasks", { repo: ctx.repo })}
              className="font-mono text-[var(--color-cool)] hover:underline hover:text-[var(--color-fg)] transition-colors"
            >
              {ctx.repo}
            </Link>
            <span className="text-[var(--color-fg-dim)]">/</span>
            <span className="font-mono text-[var(--color-fg-muted)]">{ctx.branch}</span>
            <span className="font-mono text-[10.5px] text-[var(--color-fg-dim)] tabular">
              {ctx.headSha.slice(0, 7)}
            </span>
            {ctx.dirtyFiles.length > 0 && (
              <span className="text-[10.5px] font-mono text-[var(--color-warm)]">
                {c("contexts.dirty", { count: formatNumber(ctx.dirtyFiles.length) })}
              </span>
            )}
            {ctx.sessionId && (
              <span
                className="text-[10.5px] font-mono text-[var(--color-accent)] inline-flex items-center gap-1"
                title={c("contexts.resumableTitle")}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                {c("contexts.resumable")}
              </span>
            )}
            <ArrowUpRight className="w-3 h-3 text-[var(--color-fg-dim)] opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
          </div>
          <pre className="mt-1.5 font-mono text-[11.5px] text-[var(--color-fg-muted)] whitespace-pre-wrap leading-relaxed">
            {ctx.summary}
          </pre>
        </div>
        <div className="text-[10.5px] font-mono text-[var(--color-fg-dim)] whitespace-nowrap pt-0.5">
          {timeAgo(ctx.createdAt)} ago
        </div>
      </div>
    </Link>
  );
}
