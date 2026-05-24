"use client";

// Right-column detail pane for /contexts. Selecting a row on the left
// timeline reveals the full snapshot here — dirty files list, session
// pointer, linked tasks (fetched on demand), and copy-to-clipboard for
// the full hash. Mirrors the master/detail pattern used on /tasks so
// users have one mental model for "click a row, read the detail beside".

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import {
  Check, Copy, ExternalLink, FileCode, GitBranch, GitCommit, MessageSquare,
} from "lucide-react";
import { api } from "@/lib/api";
import { contextSessionHref, contextSessionLabel, contextSessionType } from "@/lib/context-session";
import { Badge, StatusDot } from "@/components/ui/badge";
import { cn, timeAgo } from "@/lib/utils";
import { formatNumber } from "@/lib/copy";
import type { RelayContext, Task } from "@/lib/types";

export function ContextDetailPanel({ ctx }: { ctx: RelayContext | null }) {
  if (!ctx) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-[var(--color-fg-dim)] px-6 text-center">
        Select a context on the left to see its files, summary, and linked tasks.
      </div>
    );
  }
  return <Panel ctx={ctx} />;
}

function Panel({ ctx }: { ctx: RelayContext }) {
  // Linked tasks fetched on demand keyed by hash so navigation between
  // contexts swaps the underlying SWR entry rather than refetching the
  // same data on every render.
  const { data: tasks = [], isLoading: tasksLoading } = useSWR<Task[]>(
    ctx.linkedTasksCount > 0 ? `/api/tasks?context=${encodeURIComponent(ctx.hash)}` : null,
    () => api.tasks({ context: ctx.hash, limit: 100 }),
  );

  const sessionType = contextSessionType(ctx);
  const sessionLabel = contextSessionLabel(sessionType);
  const sessionHref = contextSessionHref(ctx);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 space-y-5">
        <header className="space-y-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link
              href={`/tasks?status=open&repo=${encodeURIComponent(ctx.repo)}`}
              className="font-mono text-[14px] text-[var(--color-cool)] hover:underline"
            >
              {ctx.repo}
            </Link>
            <span className="text-[var(--color-fg-dim)]">·</span>
            <span className="inline-flex items-center gap-1 font-mono text-[12px] text-[var(--color-fg-muted)]">
              <GitBranch className="w-3 h-3" aria-hidden />
              {ctx.branch}
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--color-fg-dim)] tabular">
              <GitCommit className="w-3 h-3" aria-hidden />
              {ctx.headSha.slice(0, 7)}
            </span>
            <span className="ml-auto text-[10.5px] font-mono text-[var(--color-fg-dim)] tabular">
              {timeAgo(ctx.createdAt)} ago
            </span>
          </div>
          <HashRow hash={ctx.hash} />
          {sessionHref && (
            <Link
              href={sessionHref}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius)] border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06] text-[11.5px] font-mono text-[var(--color-accent)] hover:bg-[var(--color-accent)]/15 transition-colors"
              title={`Open the ${sessionLabel} session that produced this snapshot`}
            >
              <MessageSquare className="w-3.5 h-3.5" aria-hidden />
              Open {sessionLabel} session
              <span className="text-[10px] opacity-70">{sessionType}:{ctx.sessionId!.slice(0, 8)}</span>
            </Link>
          )}
          <Link
            href={`/context?hash=${encodeURIComponent(ctx.hash)}`}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/55 text-[11.5px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-elev-2)] transition-colors"
            title="Open the full context detail page with resume command"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            Open full context
          </Link>
        </header>

        <Section title="Summary">
          {ctx.summary?.trim() ? (
            <pre className="font-mono text-[12px] text-[var(--color-fg)] whitespace-pre-wrap leading-relaxed">
              {ctx.summary}
            </pre>
          ) : (
            <p className="text-[12px] text-[var(--color-fg-dim)] italic">
              No summary captured.
            </p>
          )}
        </Section>

        <Section
          title={`Dirty files · ${formatNumber(ctx.dirtyFiles.length)}`}
          hint={ctx.dirtyFiles.length === 0 ? "working tree was clean at save time" : undefined}
        >
          {ctx.dirtyFiles.length > 0 && (
            <ul className="font-mono text-[11.5px] text-[var(--color-fg-muted)] space-y-0.5">
              {ctx.dirtyFiles.map((f) => (
                <li key={f} className="flex items-center gap-1.5 leading-snug">
                  <FileCode className="w-3 h-3 text-[var(--color-fg-dim)] shrink-0" aria-hidden />
                  <span className="truncate" title={f}>{f}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={`Linked tasks · ${formatNumber(ctx.linkedTasksCount)}`}
          hint={
            ctx.linkedTasksCount === 0
              ? "no tasks pointed at this context via tasks.context_hash"
              : undefined
          }
        >
          {ctx.linkedTasksCount > 0 && (
            tasksLoading ? (
              <p className="text-[11.5px] text-[var(--color-fg-dim)]">loading…</p>
            ) : tasks.length === 0 ? (
              // The COUNT() said >0 but the JOIN returned []. Could happen
              // if tasks were closed/deleted between server queries; report
              // the discrepancy rather than silently showing an empty list.
              <p className="text-[11.5px] text-[var(--color-fg-dim)]">
                count says {ctx.linkedTasksCount} but no rows came back —
                try `relay sync`?
              </p>
            ) : (
              <ul className="space-y-1">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/tasks?selected=${t.id}`}
                      className="group flex items-start gap-2 rounded-[var(--radius)] px-1.5 py-1 text-[12px] hover:bg-[var(--color-bg-elev-2)] transition-colors"
                    >
                      <StatusDot status={t.status} className="mt-1.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-[10px] text-[var(--color-fg-dim)] shrink-0">
                            #{t.id}
                          </span>
                          <span className="font-mono text-[10.5px] text-[var(--color-cool)] truncate">
                            {t.source_type}
                          </span>
                        </div>
                        <div className="text-[12px] text-[var(--color-fg)] truncate group-hover:text-[var(--color-fg)]">
                          {t.title}
                        </div>
                      </div>
                      {t.status !== "open" && (
                        <Badge className="shrink-0">{t.status}</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )
          )}
        </Section>
      </div>
    </div>
  );
}

function HashRow({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      // 1.5s is the sweet spot — long enough to register the success,
      // short enough that the icon swap doesn't linger when the user
      // moves on to another context.
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard denied — best-effort; leave the icon unchanged.
    }
  };
  return (
    <div className="flex items-center gap-2">
      <code className="font-mono text-[10.5px] text-[var(--color-fg-dim)] tabular break-all">
        {hash}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="copy hash"
        title={copied ? "copied!" : "copy full hash"}
        className={cn(
          "shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-fg-muted)] transition-colors",
          copied && "text-[var(--color-accent)] border-[var(--color-accent)]/50",
        )}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
          {title}
        </h3>
        {hint && (
          <span className="text-[10.5px] text-[var(--color-fg-dim)] italic">{hint}</span>
        )}
      </div>
      {children}
    </section>
  );
}
