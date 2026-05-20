import * as React from "react";
import { cn } from "@/lib/utils";
import type { SourceType, Status } from "@/lib/types";

const SOURCE_TONE: Record<SourceType, string> = {
  code_todo: "text-[var(--color-fg-muted)] border-[var(--color-border)]",
  github_issue: "text-[var(--color-cool)] border-[var(--color-cool)]/40",
  github_pr: "text-[var(--color-warm)] border-[var(--color-warm)]/40",
  gh_notification: "text-[var(--color-cool)] border-[var(--color-cool)]/40",
  gh_run_failure: "text-[var(--color-critical)] border-[var(--color-critical)]/40",
  gh_project_card: "text-[var(--color-cool)] border-[var(--color-cool)]/40",
  git_interrupted: "text-[var(--color-warm)] border-[var(--color-warm)]/40",
  git_stash: "text-[var(--color-warm)] border-[var(--color-warm)]/40",
  orphan_branch: "text-[var(--color-warm)] border-[var(--color-warm)]/40",
  claude_session_todo: "text-[var(--color-accent)] border-[var(--color-accent)]/40",
  codex_session_todo: "text-[var(--color-cool)] border-[var(--color-cool)]/40",
  antigravity_session_todo: "text-[var(--color-warm)] border-[var(--color-warm)]/40",
  cursor_session_todo: "text-[var(--color-fg-muted)] border-[var(--color-fg-muted)]/40",
  agents_note: "text-[var(--color-fg-dim)] border-[var(--color-border)]",
  manual: "text-[var(--color-fg)] border-[var(--color-fg-dim)]",
};

const STATUS_DOT: Record<Status, string> = {
  open: "bg-[var(--color-fg-dim)]",
  in_progress: "bg-[var(--color-accent)]",
  blocked: "bg-[var(--color-critical)]",
  snoozed: "bg-[var(--color-warm)]",
  done: "bg-[var(--color-fg-dim)]",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  source?: SourceType;
  status?: Status;
}

export function Badge({ source, status, className, children, ...props }: BadgeProps) {
  const tone = source ? SOURCE_TONE[source] : "text-[var(--color-fg-muted)] border-[var(--color-border)]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider rounded border bg-transparent leading-none",
        tone,
        className,
      )}
      {...props}
    >
      {status && <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[status])} />}
      {children ?? source ?? status}
    </span>
  );
}

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`status: ${status}`}
      className={cn("inline-block w-2 h-2 rounded-full", STATUS_DOT[status], className)}
    />
  );
}
