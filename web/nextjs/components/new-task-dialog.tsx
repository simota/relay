"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { RepoStat } from "@/lib/types";

interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
}

const ASSIGNEES = ["claude-code", "codex", "antigravity", "self", "human-review"] as const;

export function NewTaskDialog({ open, onClose }: NewTaskDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { mutate } = useSWRConfig();
  const { data: repos = [], isLoading: reposLoading } = useSWR<RepoStat[]>(
    open ? "/api/repos" : null,
    () => api.repos(),
  );
  const repoOptions = repos
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b));
  const [repo, setRepo] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assignee, setAssignee] = useState<(typeof ASSIGNEES)[number]>("claude-code");
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState("");
  const [priority, setPriority] = useState("50");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setRepo("");
      setTitle("");
      setBody("");
      setAssignee("claude-code");
      setPrompt("");
      setFiles("");
      setPriority("50");
      setError(null);
    }
  }, [open]);

  // autoFocus lands on a disabled control while repos are still loading —
  // refocus the repo select once options arrive so keyboard flow works.
  const repoSelectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (open && !reposLoading && repoOptions.length > 0) {
      repoSelectRef.current?.focus();
    }
  }, [open, reposLoading, repoOptions.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo.trim() || !title.trim()) {
      setError("repo and title are required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createTask({
        repo: repo.trim(),
        title: title.trim(),
        body: body.trim(),
        assignee,
        prompt: prompt.trim() || undefined,
        files: files.split(",").map((f) => f.trim()).filter(Boolean),
        priority: parsePriority(priority),
      });
      await mutate((key) => typeof key === "string" && key.startsWith("/api/"));
      onClose();
      router.push(`/tasks?status=open&repo=${encodeURIComponent(created.repo)}&selected=${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className={cn(
        "p-0 bg-transparent backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        "rounded-[var(--radius-lg)] w-[min(560px,92vw)]",
        // Center the modal: native <dialog> needs explicit auto margins to
        // resolve to viewport center (the default 0 margin from `dialog`
        // reset styles can pin it to the top-left).
        "fixed inset-0 m-auto max-h-[90vh]",
      )}
    >
      <form
        ref={formRef}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || (!e.metaKey && !e.ctrlKey)) return;
          e.preventDefault();
          if (!submitting) formRef.current?.requestSubmit();
        }}
        className="bg-[var(--color-bg-elev)] border border-[var(--color-border-strong)] rounded-[var(--radius-lg)] shadow-[var(--shadow-pop)] overflow-hidden text-[var(--color-fg)]"
      >
        <header className="flex items-center justify-between px-5 h-12 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Plus className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            <span className="text-[14px] font-medium">New task</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={c("common.dismiss")}
            title={c("common.dismiss")}
            className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <Field label="repo" required>
            <select
              ref={repoSelectRef}
              autoFocus
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              disabled={reposLoading || repoOptions.length === 0}
              className="h-8 px-2 rounded-[var(--radius)] bg-transparent border border-[var(--color-border)] outline-none text-[13px] ring-focus font-mono w-full disabled:opacity-50"
            >
              <option value="" className="bg-[var(--color-bg-elev)]">
                {reposLoading ? "loading repos…" : "select repo"}
              </option>
              {repoOptions.map((name) => (
                <option key={name} value={name} className="bg-[var(--color-bg-elev)]">
                  {name}
                </option>
              ))}
            </select>
            {!reposLoading && repoOptions.length === 0 && (
              <div className="text-[11px] text-[var(--color-fg-dim)] font-mono">
                no repos available — track a repo or run sync first
              </div>
            )}
          </Field>

          <Field label="title" required>
            <Input
              placeholder="what to do"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field label="body">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="additional context (optional)"
              rows={3}
              className="w-full px-2.5 py-2 rounded-[var(--radius)] bg-transparent border border-[var(--color-border)] outline-none placeholder:text-[var(--color-fg-dim)] ring-focus text-[13px] resize-y font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="assignee">
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value as (typeof ASSIGNEES)[number])}
                className="h-8 px-2 rounded-[var(--radius)] bg-transparent border border-[var(--color-border)] outline-none text-[13px] ring-focus font-mono w-full"
              >
                {ASSIGNEES.map((a) => (
                  <option key={a} value={a} className="bg-[var(--color-bg-elev)]">{a}</option>
                ))}
              </select>
            </Field>
            <Field label="priority">
              <Input
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="font-mono"
              />
            </Field>
          </div>

          {(assignee === "claude-code" || assignee === "codex" || assignee === "antigravity") && (
            <Field label="prompt">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="prompt passed to the agent when you run this task"
                rows={2}
                className="w-full px-2.5 py-2 rounded-[var(--radius)] bg-transparent border border-[var(--color-border)] outline-none placeholder:text-[var(--color-fg-dim)] ring-focus text-[13px] resize-y font-mono"
              />
            </Field>
          )}

          <Field label="files">
            <Input
              placeholder="src/a.ts, src/b.ts (comma-separated, optional)"
              value={files}
              onChange={(e) => setFiles(e.target.value)}
              className="font-mono"
            />
          </Field>

          {error && (
            <div className="text-[12px] text-[var(--color-critical)] font-mono">{error}</div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 h-12 border-t border-[var(--color-border)] bg-[var(--color-bg)]/30">
          <span className="text-[11px] text-[var(--color-fg-dim)] flex items-center gap-1.5">
            <Kbd>esc</Kbd> close · <Kbd>⌘</Kbd><Kbd>↵</Kbd> submit
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>cancel</Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "creating…" : "create task"}
            </Button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

// `Number(x) || 50` would turn an explicit 0 into 50 — clamp instead.
function parsePriority(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium flex items-center gap-1">
        {label}
        {required && <span className="text-[var(--color-accent)]">*</span>}
      </span>
      {children}
    </label>
  );
}
