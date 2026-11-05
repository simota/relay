"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import type { EditableField, Task, TaskEditInput, WaitOn } from "@/lib/types";

const WAIT_ON: ReadonlyArray<{ value: WaitOn; label: string }> = [
  { value: "self", label: "self — I act next" },
  { value: "reviewer", label: "reviewer" },
  { value: "external", label: "external party" },
  { value: "scheduled", label: "scheduled date / event" },
];

const FIELD_LABEL: Record<EditableField, string> = {
  title: "title",
  body: "body",
  priority: "priority",
  prompt: "prompt",
  files: "files",
  due_at: "due",
  wait_on: "wait on",
  repo: "repo",
};

interface Draft {
  title: string;
  priority: string;
  due: string;
  wait_on: WaitOn;
  prompt: string;
  files: string;
  body: string;
  repo: string;
}

/** `<input type="date">` value (local calendar day) for a stored due_at. */
function toDateInput(dueAt: string | null): string {
  if (!dueAt) return "";
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function draftOf(task: Task): Draft {
  return {
    title: task.title,
    priority: String(task.priority),
    due: toDateInput(task.due_at),
    wait_on: task.wait_on,
    prompt: task.prompt ?? "",
    files: task.files.join("\n"),
    body: task.body,
    repo: task.repo,
  };
}

function splitFiles(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((f) => f.trim()).filter(Boolean))];
}

/** Only send what the user actually changed — the server locks those fields. */
function diff(task: Task, draft: Draft): TaskEditInput {
  const before = draftOf(task);
  const out: TaskEditInput = {};
  if (draft.title.trim() !== task.title) out.title = draft.title.trim();
  if (draft.priority !== before.priority) out.priority = Number(draft.priority);
  if (draft.due !== before.due) out.due_at = draft.due || null;
  if (draft.wait_on !== task.wait_on) out.wait_on = draft.wait_on;
  if (draft.prompt.trim() !== (task.prompt ?? "")) out.prompt = draft.prompt.trim() || null;
  const files = splitFiles(draft.files);
  if (JSON.stringify(files) !== JSON.stringify(task.files)) out.files = files;
  if (draft.body.trim() !== task.body.trim()) out.body = draft.body;
  if (task.source_type === "manual" && draft.repo.trim() !== task.repo) out.repo = draft.repo.trim();
  return out;
}

/**
 * Inline editor for a task's user-editable fields. Saving PATCHes only the
 * changed fields; for adapter-sourced tasks those fields stay as edited
 * across sync until reset. ⌘/Ctrl+Enter saves, Escape cancels.
 */
export function TaskEditForm({
  task,
  onDone,
  onCancel,
}: {
  task: Task;
  onDone: (updated: Task) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [reset, setReset] = useState<EditableField[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const isManual = task.source_type === "manual";
  // Manual tasks never sync, so their edits need no lock UI.
  const locked = isManual ? [] : task.user_overrides ?? [];

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const changes = useMemo(() => diff(task, draft), [task, draft]);
  const dirty = Object.keys(changes).length > 0 || reset.length > 0;
  const priorityNum = Number(draft.priority);
  const invalid =
    !draft.title.trim() ||
    draft.priority.trim() === "" ||
    !Number.isFinite(priorityNum) ||
    priorityNum < 0 ||
    priorityNum > 100 ||
    (isManual && !draft.repo.trim());

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!dirty || invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const resetable = reset.filter((f) => !(f in changes));
      const res = await api.updateTask(task.id, { ...changes, ...(resetable.length ? { reset: resetable } : {}) });
      onDone(res.task);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // request() formats errors as "PATCH /api/... → 400: {json}"; surface the reason.
      const match = message.match(/"error":"([^"]+)"/);
      setError(match?.[1] ?? message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      ref={formRef}
      aria-label={`Edit task #${task.id}`}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <Field label="title" htmlFor="edit-title" locked={locked.includes("title")}>
        <Input
          id="edit-title"
          ref={titleRef}
          value={draft.title}
          maxLength={500}
          onChange={(e) => set("title", e.target.value)}
          className="w-full"
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="priority (0-100)" htmlFor="edit-priority" locked={locked.includes("priority")}>
          <Input
            id="edit-priority"
            type="number"
            min={0}
            max={100}
            value={draft.priority}
            onChange={(e) => set("priority", e.target.value)}
            className="w-full font-mono"
          />
        </Field>
        <Field label="due" htmlFor="edit-due" locked={locked.includes("due_at")}>
          <div className="flex items-center gap-1">
            <Input
              id="edit-due"
              type="date"
              value={draft.due}
              onChange={(e) => set("due", e.target.value)}
              className="w-full font-mono"
            />
            {draft.due && (
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => set("due", "")} aria-label="Clear due date">
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="wait on" htmlFor="edit-wait" locked={locked.includes("wait_on")}>
          <select
            id="edit-wait"
            value={draft.wait_on}
            onChange={(e) => set("wait_on", e.target.value as WaitOn)}
            className="h-8 w-full px-2 rounded-[var(--radius)] bg-transparent border border-[var(--color-border)] text-[13px] text-[var(--color-fg)] ring-focus"
          >
            {WAIT_ON.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
        </Field>
        {isManual && (
          <Field label="repo" htmlFor="edit-repo">
            <Input id="edit-repo" value={draft.repo} onChange={(e) => set("repo", e.target.value)} className="w-full font-mono" />
          </Field>
        )}
      </div>

      <Field label="prompt passed to agent (relay run)" htmlFor="edit-prompt" locked={locked.includes("prompt")}>
        <TextArea id="edit-prompt" rows={4} value={draft.prompt} onChange={(v) => set("prompt", v)} placeholder="What should the agent do? Leave empty to use the title." />
      </Field>

      <Field label="files (one per line)" htmlFor="edit-files" locked={locked.includes("files")}>
        <TextArea id="edit-files" rows={3} value={draft.files} onChange={(v) => set("files", v)} mono placeholder="src/foo.ts" />
      </Field>

      <Field label="body" htmlFor="edit-body" locked={locked.includes("body")}>
        <TextArea id="edit-body" rows={4} value={draft.body} onChange={(v) => set("body", v)} />
      </Field>

      {!isManual && locked.length > 0 && (
        <fieldset className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 space-y-1.5">
          <legend className="px-1 text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
            hand back to {task.source_type} on next sync
          </legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {locked.map((f) => (
              <label key={f} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)]">
                <input
                  type="checkbox"
                  checked={reset.includes(f)}
                  onChange={(e) =>
                    setReset((r) => (e.target.checked ? [...r, f] : r.filter((x) => x !== f)))
                  }
                />
                <RotateCcw className="w-3 h-3" aria-hidden />
                {FIELD_LABEL[f]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!isManual && (
        <p className="text-[11px] text-[var(--color-fg-dim)]">
          Edited fields are kept when <code>relay sync</code> refreshes this {task.source_type} task. ⌘Z undoes a save.
        </p>
      )}

      {error && (
        <p role="alert" className="text-[12px] text-[var(--color-critical)]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" variant="primary" disabled={!dirty || invalid || saving}>
          <Check className="w-3 h-3" />
          {saving ? "Saving…" : "Save"}
          <Kbd className="ml-1">⌘↵</Kbd>
        </Button>
        <Button type="button" onClick={onCancel} disabled={saving}>
          Cancel
          <Kbd className="ml-1">esc</Kbd>
        </Button>
        {dirty && !invalid && (
          <span className="text-[11px] text-[var(--color-fg-dim)] font-mono">
            {[...Object.keys(changes).map((k) => FIELD_LABEL[k as EditableField]), ...reset.map((f) => `reset ${FIELD_LABEL[f]}`)].join(", ")}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  locked,
  children,
}: {
  label: string;
  htmlFor: string;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
        {label}
        {locked && <EditedChip />}
      </label>
      {children}
    </div>
  );
}

export function EditedChip() {
  return (
    <span
      className="normal-case tracking-normal rounded-[var(--radius-sm)] border border-[var(--color-accent)]/40 px-1 text-[10px] text-[var(--color-accent)]"
      title="Edited by you — kept across sync"
    >
      edited
    </span>
  );
}

function TextArea({
  id,
  value,
  onChange,
  rows,
  mono,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <textarea
      id={id}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full px-2.5 py-1.5 rounded-[var(--radius)] bg-transparent border border-[var(--color-border)]",
        "text-[12.5px] leading-relaxed text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] outline-none ring-focus resize-y",
        mono && "font-mono",
      )}
    />
  );
}
