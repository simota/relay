"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Pause, Check, RotateCcw, ExternalLink, ChevronDown } from "lucide-react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { useUndoToast } from "@/components/toast";
import { sourceTypeToSessionType, stripSessionIdPrefix } from "@/lib/session-link";
import type { Task, SourceType } from "@/lib/types";

export function TaskDetail({ task, onChange }: { task: Task | null; onChange?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const { pushUndo, pushError } = useUndoToast();
  const { data: contextRow } = useSWR(
    task?.context_hash ? `/api/contexts/${task.context_hash}` : null,
    () => task?.context_hash ? api.context(task.context_hash) : null,
  );

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-[var(--color-fg-dim)]">
        {c("task.select")}
      </div>
    );
  }

  const handle = async (action: "snooze" | "close" | "reopen") => {
    setBusy(action);
    try {
      if (action === "snooze") {
        await api.snooze(task.id);
        pushUndo("snooze", task);
      }
      if (action === "close") {
        await api.close(task.id);
        pushUndo("close", task);
      }
      if (action === "reopen") await api.reopen(task.id);
      onChange?.();
    } catch {
      pushError(c("toast.actionFailed", { action }));
    } finally {
      setBusy(null);
    }
  };

  const copyCli = async () => {
    try {
      await navigator.clipboard.writeText(`relay run ${task.id}`);
    } catch {}
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 space-y-5">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
            <StatusDot status={task.status} />
            <span>{task.status.replace("_", " ")}</span>
            <span>·</span>
            <Badge source={task.source_type} />
            <span className="tabular ml-auto">#{task.id}</span>
          </div>
          <h1 className="text-[20px] leading-snug font-semibold tracking-tight text-[var(--color-fg)]">
            {task.title}
          </h1>
        </div>

        {/* why-now */}
        <div className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-4 border-l-2 border-[var(--color-border)] pl-3 text-sm">
          <WhyNowRow label={c("task.source")}>
            <span className="inline-flex items-center gap-2 min-w-0">
              <Badge source={task.source_type} />
              <SourceDetailValue detail={sourceDetail(task)} />
            </span>
          </WhyNowRow>
          <WhyNowRow label={c("task.age")}>
            <span className="font-mono text-[var(--color-fg-muted)]">
              {timeAgo(task.created_at)} · {c("task.lastTouched", { age: timeAgo(task.updated_at) })}
            </span>
          </WhyNowRow>
          <WhyNowRow label={c("task.context")}>
            {contextRow ? (
              <Link
                href={`/context?hash=${encodeURIComponent(contextRow.hash)}`}
                className="text-[var(--color-cool)] hover:text-[var(--color-fg)] hover:underline"
              >
                {contextName(contextRow)}
              </Link>
            ) : (
              <span className="text-[var(--color-fg-dim)]">—</span>
            )}
          </WhyNowRow>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-4 text-[12px]">
          <MetaRow label={c("task.repo")} mono><span className="text-[var(--color-cool)]">{task.repo}</span></MetaRow>
          <MetaRow label={c("task.assignee")} mono>
            <AssigneePicker
              current={task.assignee}
              onChange={async (next) => {
                if (next === task.assignee) return;
                try {
                  await api.reassign(task.id, next);
                  onChange?.();
                } catch {
                  pushError(c("toast.actionFailed", { action: "reassign" }));
                }
              }}
            />
          </MetaRow>
          <MetaRow label={c("task.priority")} mono>{formatNumber(task.priority)}</MetaRow>
          <MetaRow label={c("task.updated")} mono>{timeAgo(task.updated_at)}</MetaRow>
          {task.due_at && <MetaRow label={c("task.due")} mono>{formatDue(task.due_at)}</MetaRow>}
          {task.session_id && (
            <MetaRow label={c("task.session")} mono>
              <SessionLink sessionId={task.session_id} sourceType={task.source_type} />
            </MetaRow>
          )}
          {task.context_hash && (
            <MetaRow label={c("task.context")} mono>
              <span className="text-[var(--color-fg-muted)]">{task.context_hash.slice(0, 10)}</span>
            </MetaRow>
          )}
          {task.files.length > 0 && (
            <MetaRow label={c("task.files")} mono>
              <div className="space-y-0.5">
                {task.files.map((f) => (
                  <div key={f} className="text-[var(--color-fg-muted)] truncate">{f}</div>
                ))}
              </div>
            </MetaRow>
          )}
        </div>

        {/* Body */}
        {task.source_type === "manual" && (
          <ManualTaskSpec task={task} />
        )}

        {task.source_type !== "manual" && task.body && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/50 p-3.5">
            <pre className="text-[12px] leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap font-mono">
              {task.body}
            </pre>
          </div>
        )}

        {/* Context (if linked) */}
        {contextRow && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.04] p-3.5 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-accent)] font-medium flex items-center gap-2">
              <span>{c("task.previousContext")}</span>
              <span className="text-[var(--color-fg-dim)] normal-case font-normal">
                · {contextRow.branch} · {contextRow.headSha.slice(0, 7)} · {timeAgo(contextRow.createdAt)} ago
              </span>
            </div>
            <pre className="text-[12px] leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap font-mono">
              {contextRow.summary}
            </pre>
            {contextRow.dirtyFiles.length > 0 && (
              <div className="text-[11px] text-[var(--color-warm)] font-mono">
                {c("task.dirtyFiles", { count: formatNumber(contextRow.dirtyFiles.length) })}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" onClick={copyCli}>
            <Copy className="w-3 h-3" />
            relay run {task.id}
          </Button>
          {task.status !== "snoozed" && (
            <Button onClick={() => handle("snooze")} disabled={busy !== null}>
              <Pause className="w-3 h-3" />
              {c("common.snooze")}
              <Kbd className="ml-1">s</Kbd>
            </Button>
          )}
          {task.status !== "done" && (
            <Button onClick={() => handle("close")} disabled={busy !== null}>
              <Check className="w-3 h-3" />
              {c("common.close")}
              <Kbd className="ml-1">c</Kbd>
            </Button>
          )}
          {(task.status === "done" || task.status === "snoozed") && (
            <Button onClick={() => handle("reopen")} disabled={busy !== null}>
              <RotateCcw className="w-3 h-3" />
              {c("common.reopen")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualTaskSpec({ task }: { task: Task }) {
  const hasDetails = Boolean(task.body.trim() || task.prompt?.trim() || task.files.length > 0);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/50 overflow-hidden">
      <div className="px-3.5 py-2 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
          manual task details
        </span>
        <code className="text-[11px] text-[var(--color-cool)]">relay run {task.id}</code>
      </div>
      {hasDetails ? (
        <div className="p-3.5 space-y-3">
          {task.body.trim() && (
            <DetailBlock label="body" value={task.body.trim()} />
          )}
          {task.prompt?.trim() && (
            <DetailBlock label="prompt passed to agent" value={task.prompt.trim()} strong />
          )}
          {task.files.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
                files
              </div>
              <ul className="font-mono text-[12px] text-[var(--color-fg-muted)] space-y-0.5">
                {task.files.map((file) => (
                  <li key={file} className="truncate">+ {file}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="p-3.5 text-[12px] text-[var(--color-fg-dim)] font-mono">
          No body, prompt, or files were provided.
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
        {label}
      </div>
      <pre
        className={cn(
          "text-[12px] leading-relaxed whitespace-pre-wrap font-mono",
          strong ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)]",
        )}
      >
        {value}
      </pre>
    </div>
  );
}

function SourceDetailValue({ detail }: { detail: { text: string; href?: string } }) {
  if (detail.href) {
    return (
      <a
        href={detail.href}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-[var(--color-cool)] hover:text-[var(--color-fg)] hover:underline truncate"
      >
        <span className="truncate">{detail.text}</span>
        <ExternalLink className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
      </a>
    );
  }
  return <span className="text-[var(--color-fg-muted)] truncate">{detail.text}</span>;
}

function WhyNowRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="font-medium text-[var(--color-fg-dim)]">{label}:</div>
      <div className="min-w-0 text-[var(--color-fg-muted)]">{children}</div>
    </>
  );
}

function sourceDetail(task: Task): { text: string; href?: string } {
  const sourceId = task.source_id.trim();
  if (!sourceId) return { text: "—" };
  const href = sourceId.startsWith("http") ? sourceId : undefined;

  switch (task.source_type) {
    case "github_pr": {
      // source_id is the canonical PR URL; pull out the number so we render
      // "PR #200" instead of "PR #https://github.com/.../pull/200".
      const num = sourceId.match(/\/pull\/(\d+)/)?.[1] ?? sourceId.replace(/^#/, "");
      return { text: `PR #${num}`, href };
    }
    case "github_issue": {
      const num = sourceId.match(/\/issues\/(\d+)/)?.[1] ?? sourceId.replace(/^#/, "");
      return { text: `Issue #${num}`, href };
    }
    case "gh_notification": {
      // source_id is `gh:notification:<thread_id>`; surface the thread id and
      // link to the body (which carries the subject.url) when present.
      const threadId = sourceId.replace(/^gh:notification:/, "");
      return { text: `notification ${threadId}` };
    }
    case "gh_run_failure": {
      // source_id is `<repo>:gh-run:<workflow>:<branch>`; surface the
      // workflow + branch portion so the detail panel reads naturally
      // even when multiple failures share a repo row.
      const tail = sourceId.replace(/^[^:]+:gh-run:/, "");
      return { text: `run ${tail}` };
    }
    case "gh_project_card": {
      // source_id is `gh:project:<project_node_id>:item:<item_node_id>`;
      // the node IDs are opaque base64-ish strings, so just surface the
      // item portion (most informative half — the project repeats
      // across many cards).
      const itemTail = sourceId.replace(/^gh:project:[^:]+:item:/, "");
      return { text: `card ${itemTail}` };
    }
    case "git_interrupted": {
      // source_id is `<repo>:git-state:<kind>`; surface just the kind
      // (rebase-merge / merge / cherry-pick / …) since the repo column
      // already shows the repo.
      const kind = sourceId.replace(/^[^:]+:git-state:/, "");
      return { text: `git ${kind}` };
    }
    case "git_stash": {
      // source_id is `<repo>:stash:<short_oid>`; surface just the
      // short oid since the repo column already shows the repo and
      // `stash@{N}` is volatile (the reflog position shifts whenever
      // anything is pushed/popped).
      const shortOid = sourceId.replace(/^[^:]+:stash:/, "");
      return { text: `stash ${shortOid}` };
    }
    case "git_dirty_worktree":
      return { text: "dirty worktree" };
    case "orphan_branch": {
      // source_id is `<repo>:orphan-branch:<branch>:<tip_short_sha>`;
      // surface the branch portion since the repo column already shows
      // the repo. The trailing tip SHA disambiguates rebased/amended
      // tips that produce a new task entry — we drop it from the
      // display value to keep the line scannable.
      const tail = sourceId.replace(/^[^:]+:orphan-branch:/, "");
      const branch = tail.replace(/:[0-9a-f]+$/, "");
      return { text: `branch ${branch}` };
    }
    case "gh_review_request": {
      const num = sourceId.match(/\/pull\/(\d+)/)?.[1] ?? sourceId.replace(/^#/, "");
      return { text: `review PR #${num}`, href };
    }
    case "gh_unresolved_thread": {
      const num = sourceId.match(/\/pull\/(\d+)/)?.[1] ?? sourceId.replace(/^#/, "");
      return { text: `thread PR #${num}`, href: sourceId.split("#")[0] };
    }
    case "docs_checklist":
      return { text: `docs ${sourceId}` };
    case "code_todo":
      return { text: ["code", "TO" + "DO", sourceId].join(" ") };
    case "claude_session_todo":
      return { text: `session ${sourceId}` };
    case "codex_session_todo":
      return { text: `codex session ${sourceId}` };
    case "antigravity_session_todo":
      return { text: `antigravity session ${sourceId}` };
    case "cursor_session_todo":
      return { text: `cursor session ${sourceId}` };
    case "agents_note":
      return { text: `.agents ${sourceId}` };
    case "manual":
      return { text: sourceId, href };
  }
}

function contextName(contextRow: { repo: string; branch: string; hash: string }): string {
  return `${contextRow.repo} / ${contextRow.branch} @ ${contextRow.hash.slice(0, 10)}`;
}

const ASSIGNEE_OPTIONS = [
  "claude-code",
  "codex",
  "antigravity",
  "self",
  "human-review",
] as const;

function AssigneePicker({
  current,
  onChange,
}: {
  current: string;
  onChange: (next: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handlePick = async (choice: string) => {
    if (choice === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await onChange(choice);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 -mx-1.5 -my-0.5",
          "hover:bg-[var(--color-bg-elev)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]",
          busy && "opacity-60 cursor-not-allowed",
        )}
        title="change assignee"
      >
        <span>{current}</span>
        <ChevronDown className="w-3 h-3 text-[var(--color-fg-dim)] shrink-0" aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute z-20 left-0 mt-1 min-w-[140px]",
            "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]",
            "shadow-lg py-1 text-[12px]",
          )}
        >
          {ASSIGNEE_OPTIONS.map((opt) => (
            <button
              key={opt}
              role="option"
              aria-selected={opt === current}
              onClick={() => handlePick(opt)}
              className={cn(
                "block w-full text-left px-3 py-1 font-mono",
                opt === current
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-fg)]",
              )}
            >
              {opt === current ? "● " : "  "}
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Due dates sit in the future, so the relative `timeAgo` formatter would
// render them all as "now" — count forward instead.
function formatDue(dueAt: string): string {
  const ms = new Date(dueAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return dueAt;
  if (ms <= 0) return timeAgo(dueAt);
  const days = Math.ceil(ms / 86_400_000);
  return `in ${formatNumber(days)}d`;
}

function SessionLink({ sessionId, sourceType }: { sessionId: string; sourceType: SourceType }) {
  const sessionType = sourceTypeToSessionType(sourceType);
  const cleanId = stripSessionIdPrefix(sessionId);
  const idDisplay = (
    <span className="text-[var(--color-fg-dim)] truncate inline-block max-w-[280px] align-middle">
      {cleanId}
    </span>
  );

  if (!sessionType) {
    return idDisplay;
  }

  const href = `/sessions/detail?type=${sessionType}&id=${encodeURIComponent(cleanId)}`;
  return (
    <div className="flex items-center gap-2 min-w-0">
      {idDisplay}
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-[var(--color-cool)] hover:text-[var(--color-fg)] hover:underline text-[11px] font-sans shrink-0"
        title={c("task.openSession")}
      >
        <ExternalLink className="w-3 h-3" aria-hidden />
        {c("task.openSession")}
      </Link>
    </div>
  );
}

function MetaRow({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <>
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium pt-0.5">
        {label}
      </div>
      <div className={cn("text-[12px]", mono && "font-mono")}>{children}</div>
    </>
  );
}
