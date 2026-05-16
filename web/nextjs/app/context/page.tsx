"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft, Copy, ExternalLink, GitBranch, GitCommit,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { StatusDot, Badge } from "@/components/ui/badge";
import type { RelayContext, Task } from "@/lib/types";

export default function ContextPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[var(--color-fg-dim)]">loading…</div>}>
      <ContextInner />
    </Suspense>
  );
}

function ContextInner() {
  const params = useSearchParams();
  const hash = params.get("hash") ?? "";
  const { data: ctx, error, isLoading } = useSWR<RelayContext | null>(
    hash ? `/api/contexts/${hash}` : null,
    () => (hash ? api.context(hash) : Promise.resolve(null)),
  );

  if (!hash) return <Empty title="No hash" body="Append ?hash=<prefix-or-full> to the URL." />;
  if (isLoading) return <Empty title="Loading…" />;
  if (error || !ctx) return <Empty title="Context not found" body={`No context matches "${hash}".`} backHref="/contexts" />;

  return <Detail ctx={ctx} />;
}

function Detail({ ctx }: { ctx: RelayContext }) {
  const [copied, setCopied] = useState<string | null>(null);

  // Resolve the repo's absolute path so the resume command is copy-paste-correct.
  // First try the path API (scan.roots resolution); fall back to scan_roots[0]
  // from /api/config so the command is still right when the repo is under a
  // configured root but not yet on disk (e.g. cloned later).
  const { data: pathInfo } = useSWR<{ path: string } | null>(
    `/api/repos/${ctx.repo}/path`,
    async () => {
      try { return await api.repoPath(ctx.repo); } catch { return null; }
    },
  );
  const { data: cfg } = useSWR("/api/config", () => api.config());
  const fallbackBase = cfg?.scan_roots[0] ?? "~/repos/github.com";
  const repoPath = pathInfo?.path ?? `${fallbackBase}/${ctx.repo}`;

  // Tasks linked to this context (by context_hash). Useful for "where does
  // this snapshot apply?" — and for finding the source of session_id.
  const { data: linkedTasks = [] } = useSWR<Task[]>(
    `/api/tasks?context=${ctx.hash}&limit=20`,
    () => api.tasks({ context: ctx.hash, limit: 20 }),
  );

  const resumeCmd = ctx.sessionId
    ? `cd ${repoPath} && claude --resume ${ctx.sessionId}`
    : null;

  const copy = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // permissions blocked — ignore
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[860px] mx-auto px-6 py-6 space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
          <Link href="/contexts" className="inline-flex items-center gap-1 hover:text-[var(--color-fg)]">
            <ArrowLeft className="w-3 h-3" /> Contexts
          </Link>
          <span className="text-[var(--color-fg-dim)]">/</span>
          <span className="font-mono text-[var(--color-fg-dim)]">{ctx.hash.slice(0, 10)}</span>
        </div>

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-[18px] text-[var(--color-cool)]">{ctx.repo}</h1>
            <span className="text-[var(--color-fg-dim)]">·</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-[var(--color-fg-muted)]">
              <GitBranch className="w-3.5 h-3.5" /> {ctx.branch}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[var(--color-fg-dim)]">
              <GitCommit className="w-3.5 h-3.5" /> {ctx.headSha.slice(0, 10)}
            </span>
            {ctx.sessionId && (
              <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--color-accent)] uppercase tracking-wider font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" /> resumable
              </span>
            )}
          </div>
          <div className="text-[12px] text-[var(--color-fg-dim)] font-mono">
            saved {timeAgo(ctx.createdAt)} ago
            {ctx.dirtyFiles.length > 0 && (
              <span className="ml-3 text-[var(--color-warm)]">+{ctx.dirtyFiles.length} dirty files</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 items-center">
          {resumeCmd ? (
            <Button variant="primary" onClick={() => copy("resume", resumeCmd)}>
              <Copy className="w-3 h-3" />
              {copied === "resume" ? "copied!" : "Copy resume command"}
            </Button>
          ) : (
            <span className="text-[12px] text-[var(--color-fg-dim)] font-mono">
              no session linked · <code className="text-[var(--color-fg-muted)]">relay backfill</code> may fix
            </span>
          )}
          <Link
            href={`/tasks?status=open&repo=${encodeURIComponent(ctx.repo)}`}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] hover:bg-[var(--color-bg-elev-2)] text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open tasks in {ctx.repo}
          </Link>
        </div>

        {resumeCmd && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/40 overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
                resume command
              </span>
              <button
                onClick={() => copy("resume2", resumeCmd)}
                className="text-[10.5px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] inline-flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                {copied === "resume2" ? "copied" : "copy"}
              </button>
            </div>
            <pre className="px-3 py-3 text-[12px] font-mono text-[var(--color-fg)] overflow-x-auto whitespace-pre">
{resumeCmd}
            </pre>
          </div>
        )}

        {/* Linked tasks */}
        {linkedTasks.length > 0 && (
          <Section title={`linked tasks (${linkedTasks.length})`}>
            <div className="divide-y divide-[var(--color-border)]/60 -my-2">
              {linkedTasks.map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks?status=${t.status === "done" ? "done" : t.status === "snoozed" ? "snoozed" : "open"}&repo=${encodeURIComponent(t.repo)}`}
                  className="flex items-center gap-3 py-2 text-[13px] hover:bg-[var(--color-bg-elev)]/40 -mx-2 px-2 rounded transition-colors"
                >
                  <StatusDot status={t.status} className="shrink-0" />
                  <span className="tabular text-[11px] text-[var(--color-fg-dim)] w-12 shrink-0">
                    #{t.id}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--color-fg-dim)] w-[100px] truncate shrink-0">
                    {t.assignee}
                  </span>
                  <span className="flex-1 truncate text-[var(--color-fg)]">
                    {t.title}
                  </span>
                  <Badge source={t.source_type} />
                  {t.session_id && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0"
                      title={`has session ${t.session_id}`}
                    />
                  )}
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* Meta grid */}
        <Section title="metadata">
          <Meta label="hash" mono>{ctx.hash}</Meta>
          {ctx.sessionId && <Meta label="session" mono><span className="text-[var(--color-accent)]">{ctx.sessionId}</span></Meta>}
          <Meta label="HEAD" mono>{ctx.headSha}</Meta>
          <Meta label="branch" mono>{ctx.branch}</Meta>
          <Meta label="repo" mono><span className="text-[var(--color-cool)]">{ctx.repo}</span></Meta>
          <Meta label="saved" mono>{ctx.createdAt}</Meta>
        </Section>

        {/* Dirty files */}
        {ctx.dirtyFiles.length > 0 && (
          <Section title={`dirty files (${ctx.dirtyFiles.length})`}>
            <ul className="font-mono text-[12px] text-[var(--color-warm)] space-y-1">
              {ctx.dirtyFiles.map((f) => <li key={f}>+ {f}</li>)}
            </ul>
          </Section>
        )}

        {/* Summary */}
        {ctx.summary && (
          <Section title="summary">
            <pre className="font-mono text-[12.5px] text-[var(--color-fg-muted)] whitespace-pre-wrap leading-relaxed">
              {ctx.summary}
            </pre>
          </Section>
        )}

        <div className="pt-4 border-t border-[var(--color-border)] flex items-center justify-between text-[11px] text-[var(--color-fg-dim)]">
          <span>
            <Kbd>⌘</Kbd>+click to copy hash:
            <button
              onClick={() => copy("hash", ctx.hash)}
              className="ml-2 font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              {ctx.hash}
            </button>
          </span>
          <Link href="/contexts" className="hover:text-[var(--color-fg)]">all contexts →</Link>
        </div>
      </div>
    </div>
  );
}

function Empty({ title, body, backHref }: { title: string; body?: string; backHref?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="text-[18px] font-medium">{title}</div>
      {body && <div className="text-[13px] text-[var(--color-fg-muted)] font-mono">{body}</div>}
      {backHref && (
        <Link href={backHref} className="text-[12px] text-[var(--color-accent)] hover:underline mt-2">
          ← back
        </Link>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">{title}</div>
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/40 p-4">
        {children}
      </div>
    </div>
  );
}

function Meta({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-x-4 text-[12px] py-1">
      <span className="text-[var(--color-fg-dim)] font-mono">{label}</span>
      <span className={cn("text-[var(--color-fg)] break-all", mono && "font-mono")}>{children}</span>
    </div>
  );
}
