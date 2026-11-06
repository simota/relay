"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Check, RotateCcw, ExternalLink, ChevronDown, Pencil, History, Link2, X, Hash, Repeat, NotebookPen, Play } from "lucide-react";
import { describeRecurrence } from "@/lib/recurrence";
import useSWR, { useSWRConfig } from "swr";
import { api, type QueueRunnerState, type RunListItem } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { useUndoToast } from "@/components/toast";
import { SnoozeMenu } from "@/components/snooze-menu";
import { EditedChip, TaskEditForm } from "@/components/task-edit-form";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { sourceTypeToSessionType, stripSessionIdPrefix } from "@/lib/session-link";
import type { DependencyInfo, EditableField, RunChanges, Task, TaskNote, SourceType } from "@/lib/types";

export function TaskDetail({
  task,
  onChange,
  onSelectTask,
}: {
  task: Task | null;
  onChange?: () => void;
  /** Jump to another task (dependency links); falls back to /tasks?selected=. */
  onSelectTask?: (id: number) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const { pushUndo, pushError } = useUndoToast();
  const { data: contextRow } = useSWR(
    task?.context_hash ? `/api/contexts/${task.context_hash}` : null,
    () => task?.context_hash ? api.context(task.context_hash) : null,
  );
  // Shares the queue tray's cache key: one poller for the server's runner.
  const { data: runner, mutate: mutateRunner } = useSWR<QueueRunnerState>("/api/queue/runner", () => api.queue.runner(), {
    refreshInterval: (state) => (state && (state.status === "running" || state.status === "stopping") ? 1500 : 20000),
  });
  const runningHere = Boolean(task && runner?.current?.task_id === task.id);
  const { data: runs = [], mutate: mutateRuns } = useSWR<RunListItem[]>(
    task ? `/api/runs?task_id=${task.id}` : null,
    () => (task ? api.runs({ taskId: task.id, limit: 5 }) : []),
    { refreshInterval: runningHere ? 2000 : 0 },
  );
  // The run this panel was watching just finished: show its outcome.
  const wasRunningHere = useRef(false);
  useEffect(() => {
    if (wasRunningHere.current && !runningHere) {
      setRunNowState(null);
      void mutateRuns();
      onChange?.();
    }
    wasRunningHere.current = runningHere;
  }, [runningHere, mutateRuns, onChange]);
  const [runNowState, setRunNowState] = useState<string | null>(null);

  // Leaving the task (j/k, list click) abandons an open edit.
  const taskId = task?.id ?? null;
  useEffect(() => {
    setEditing(false);
    setSavedNote(null);
    setRunNowState(null);
  }, [taskId]);

  const snooze = async (until?: string) => {
    if (!task) return;
    setBusy("snooze");
    try {
      const updated = await api.snooze(task.id, until);
      pushUndo("snooze", updated ?? task);
      onChange?.();
    } catch {
      pushError(c("toast.actionFailed", { action: "snooze" }));
    } finally {
      setBusy(null);
    }
  };

  const resetOverrides = async (fields: EditableField[]) => {
    if (!task || fields.length === 0) return;
    try {
      await api.updateTask(task.id, { reset: fields });
      setSavedNote(`${fields.length} field(s) handed back to ${task.source_type}; next sync restores them`);
      onChange?.();
    } catch {
      pushError(c("toast.actionFailed", { action: "reset" }));
    }
  };

  useHotkeys([
    { key: "e", handler: (e) => { e.preventDefault(); setEditing(true); }, enabled: Boolean(task) && !editing },
    { key: "Shift+s", handler: (e) => { e.preventDefault(); void snooze("tomorrow"); }, enabled: Boolean(task) && !editing && task?.status !== "done" },
  ]);

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-[var(--color-fg-dim)]">
        {c("task.select")}
      </div>
    );
  }

  const handle = async (action: "close" | "reopen") => {
    setBusy(action);
    try {
      if (action === "close") {
        const closed = await api.close(task.id);
        pushUndo("close", { ...task, next_occurrence: closed.next_occurrence });
      }
      if (action === "reopen") await api.reopen(task.id);
      onChange?.();
    } catch {
      pushError(c("toast.actionFailed", { action }));
    } finally {
      setBusy(null);
    }
  };

  const headlessCapable = task.assignee === "claude-code" || task.assignee === "codex";
  const canRunNow = headlessCapable && task.status !== "done" && Boolean(runner?.can_start) && !runner?.external;
  const runNow = async () => {
    setRunNowState("starting…");
    try {
      const state = await api.queue.startRunner({ task_ids: [task.id], verify: true });
      await mutateRunner(state);
      setRunNowState(
        state.current && state.current.task_id !== task.id
          ? "queued next — the runner is busy with another task"
          : "running headless — results appear under agent runs",
      );
    } catch (error) {
      setRunNowState(null);
      pushError(error instanceof Error ? error.message : String(error));
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
          {!editing && (
            <div className="flex items-start gap-2">
              <h1 className="flex-1 text-[20px] leading-snug font-semibold tracking-tight text-[var(--color-fg)]">
                {task.title}
                {isLocked(task, "title") && <span className="ml-2 align-middle"><EditedChip /></span>}
              </h1>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} title="Edit task (e)" aria-label="Edit task">
                <Pencil className="w-3 h-3" />
                Edit
                <Kbd className="ml-1">e</Kbd>
              </Button>
            </div>
          )}
          {savedNote && !editing && (
            <p role="status" className="text-[11px] text-[var(--color-accent)] font-mono">{savedNote}</p>
          )}
        </div>

        {editing && (
          <TaskEditForm
            key={task.id}
            task={task}
            onCancel={() => setEditing(false)}
            onDone={(updated) => {
              setEditing(false);
              setSavedNote(`saved #${updated.id} · ⌘Z to undo`);
              onChange?.();
            }}
          />
        )}

        {!editing && (<>

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
          <MetaRow label={c("task.priority")} mono>
            {formatNumber(task.priority)}
            {isLocked(task, "priority") && <span className="ml-2"><EditedChip /></span>}
          </MetaRow>
          <MetaRow label={c("task.updated")} mono>{timeAgo(task.updated_at)}</MetaRow>
          {task.due_at && (
            <MetaRow label={task.status === "snoozed" ? "wakes" : c("task.due")} mono>
              <span title={new Date(task.due_at).toLocaleString()}>{formatDue(task.due_at)}</span>
              {isLocked(task, "due_at") && <span className="ml-2"><EditedChip /></span>}
            </MetaRow>
          )}
          {task.wait_on !== "self" && (
            <MetaRow label="wait on" mono>
              {task.wait_on}
              {isLocked(task, "wait_on") && <span className="ml-2"><EditedChip /></span>}
            </MetaRow>
          )}
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
          {task.recurrence && (
            <MetaRow label="repeats">
              <span
                className="inline-flex items-center gap-1 text-[var(--color-fg-muted)]"
                title="Closing this task schedules the next occurrence (snoozed until it is due). Change it with e."
              >
                <Repeat className="w-3 h-3" aria-hidden />
                {describeRecurrence(task.recurrence)}
              </span>
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

        <TagEditor task={task} onChange={onChange} />
        <DependencyPanel task={task} onChange={onChange} onSelectTask={onSelectTask} />
        <NotesPanel task={task} lastRunFailed={runs[0] ? runs[0].status !== "success" && runs[0].status !== "running" : false} />

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

        {task.source_type !== "manual" && task.prompt?.trim() && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/50 p-3.5">
            <DetailBlock label="prompt passed to agent" value={task.prompt.trim()} strong />
          </div>
        )}

        {task.source_type !== "manual" && (task.user_overrides?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-fg-dim)]">
            <EditedChip />
            <span>
              {task.user_overrides!.map(fieldLabel).join(", ")} kept across sync
            </span>
            <button
              type="button"
              onClick={() => { void resetOverrides(task.user_overrides ?? []); }}
              className="inline-flex items-center gap-1 text-[var(--color-cool)] hover:text-[var(--color-fg)] hover:underline"
            >
              <RotateCcw className="w-3 h-3" aria-hidden />
              reset to source
            </button>
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
          {canRunNow && (
            <Button
              onClick={() => { void runNow(); }}
              disabled={runningHere || runNowState === "starting…"}
              title="Run this task headless now inside relay web (verify gate on; retries from [verify] retries)"
            >
              <Play className="w-3 h-3" />
              {runningHere ? "running…" : "run headless"}
            </Button>
          )}
          {task.status !== "done" && (
            <SnoozeMenu onSnooze={snooze} disabled={busy !== null} />
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
        {runNowState && !runningHere && runNowState !== "starting…" && (
          <p role="status" className="text-[11px] text-[var(--color-fg-dim)] -mt-3">{runNowState}</p>
        )}
        {runningHere && (
          <p role="status" className="text-[11px] text-[var(--color-cool)] -mt-3">
            ▶ running headless{runner?.status === "stopping" ? " (stopping after this task)" : ""} — the queue tray shows live output
          </p>
        )}

        {runs.length > 0 && <RunHistory runs={runs} />}
        </>)}
      </div>
    </div>
  );
}

/**
 * Tags: chips with remove buttons plus an inline input (Enter / comma adds).
 * Tags are user-owned, so they never get overwritten by sync. ⌘Z undoes.
 */
function TagEditor({ task, onChange }: { task: Task; onChange?: () => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { mutate } = useSWRConfig();
  const { data: known = [] } = useSWR("/api/tags", () => api.tags());
  const tags = task.tags ?? [];
  const listId = `tag-suggestions-${task.id}`;

  useEffect(() => {
    setDraft("");
    setError(null);
  }, [task.id]);

  const save = async (next: string[]) => {
    setSaving(true);
    setError(null);
    try {
      await api.setTags(task.id, next);
      await mutate("/api/tags");
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save tags");
    } finally {
      setSaving(false);
    }
  };

  const addDraft = () => {
    const additions = draft
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#+/, "").trim().toLowerCase())
      .filter(Boolean);
    if (additions.length === 0) return;
    setDraft("");
    void save(Array.from(new Set([...tags, ...additions])));
  };

  return (
    <section aria-label="Tags" className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <Hash className="w-3 h-3 text-[var(--color-fg-dim)]" aria-hidden />
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 pl-1.5 pr-0.5 py-0.5 font-mono text-[11px] text-[var(--color-fg-muted)]"
        >
          <Link href={`/tasks?status=open&tag=${encodeURIComponent(tag)}`} className="hover:text-[var(--color-fg)] hover:underline">
            {tag}
          </Link>
          <button
            type="button"
            aria-label={`remove tag ${tag}`}
            disabled={saving}
            onClick={() => { void save(tags.filter((t) => t !== tag)); }}
            className="rounded p-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-critical)] ring-focus"
          >
            <X className="w-2.5 h-2.5" aria-hidden />
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={listId}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addDraft();
          }
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => { if (draft.trim()) addDraft(); }}
        placeholder={tags.length ? "+ tag" : "add tag…"}
        aria-label="add tag"
        className="w-[96px] rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] hover:border-[var(--color-border)] focus:border-[var(--color-border-strong)] focus:outline-none"
      />
      <datalist id={listId}>
        {known.filter((k) => !tags.includes(k.tag)).slice(0, 30).map((k) => (
          <option key={k.tag} value={k.tag}>{`${k.open} open`}</option>
        ))}
      </datalist>
      {error && <span role="alert" className="w-full text-[11px] text-[var(--color-critical)]">{error}</span>}
    </section>
  );
}

/**
 * Task notes (schema v14): the user's progress log. Every note is sent to
 * the next agent run in a "Notes from the user" prompt section, so "note &
 * retry" turns a failed run into a retry with feedback. ⌘Z undoes.
 */
const AGENT_ASSIGNEES = new Set(["claude-code", "codex", "antigravity"]);

/** "5m ago", but "now" rather than "now ago" for a note just written. */
function noteAge(iso: string): string {
  const ago = timeAgo(iso);
  return ago === c("common.now") ? ago : `${ago} ago`;
}

function NotesPanel({ task, lastRunFailed }: { task: Task; lastRunFailed: boolean }) {
  const key = `/api/tasks/${task.id}/notes`;
  const { data: notes = [], mutate } = useSWR<TaskNote[]>(key, () => api.notes(task.id));
  const { mutate: globalMutate } = useSWRConfig();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canRetry = AGENT_ASSIGNEES.has(task.assignee) && task.status !== "done";

  useEffect(() => {
    setDraft("");
    setError(null);
    setStatus(null);
  }, [task.id]);

  useHotkeys([
    {
      key: "m",
      handler: (e) => {
        e.preventDefault();
        inputRef.current?.focus();
      },
    },
  ]);

  const add = async (queue: boolean) => {
    const body = draft.trim();
    if (!body) {
      setError("write a note first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.addNote(task.id, body, { queue });
      const note: TaskNote = { id: created.id, task_id: created.task_id, body: created.body, created_at: created.created_at };
      await mutate([...notes, note], { revalidate: false });
      if (created.queued) await globalMutate("/api/queue");
      setDraft("");
      setStatus(created.queued ? "note saved · queued for the next run" : "note saved · the next agent run will read it");
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save note");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (noteId: number) => {
    setError(null);
    try {
      await api.deleteNote(task.id, noteId);
      await mutate(notes.filter((n) => n.id !== noteId), { revalidate: false });
      setStatus("note deleted · ⌘Z restores it");
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not delete note");
    }
  };

  return (
    <section aria-label="Notes" className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
        <NotebookPen className="w-3 h-3" aria-hidden />
        notes
        {notes.length > 0 && (
          <span className="normal-case tracking-normal font-normal">
            · {notes.length} · sent to the next agent run
          </span>
        )}
      </div>
      {notes.length > 0 && (
        <ol className="space-y-1">
          {notes.map((note) => (
            <li
              key={note.id}
              className="group flex items-start gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--color-fg)]">{note.body}</p>
                <time
                  dateTime={note.created_at}
                  title={new Date(note.created_at).toLocaleString()}
                  className="text-[10.5px] font-mono text-[var(--color-fg-dim)]"
                >
                  {noteAge(note.created_at)}
                </time>
              </div>
              <button
                type="button"
                aria-label="delete note"
                onClick={() => { void remove(note.id); }}
                className="rounded p-0.5 text-[var(--color-fg-dim)] opacity-60 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-critical)] ring-focus"
              >
                <X className="w-3 h-3" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void add(false);
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          rows={draft.includes("\n") ? 4 : 2}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void add(e.shiftKey && canRetry);
            }
            if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          }}
          placeholder={
            lastRunFailed
              ? "why did the last run fail? what should the agent try next…"
              : "progress note / hint for the agent…  (m to focus, ⌘↵ to save)"
          }
          aria-label="new note"
          className="w-full resize-y rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] leading-relaxed text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:outline-none focus:border-[var(--color-border-strong)]"
        />
        {draft.trim() && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" type="submit" disabled={saving}>
              add note <Kbd className="ml-1">⌘↵</Kbd>
            </Button>
            {canRetry && (
              <Button
                size="sm"
                type="button"
                variant={lastRunFailed ? "primary" : undefined}
                disabled={saving}
                onClick={() => { void add(true); }}
                title="Save the note and put this task on the AI job queue"
              >
                note &amp; retry <Kbd className="ml-1">⇧⌘↵</Kbd>
              </Button>
            )}
          </div>
        )}
      </form>
      {error && <p role="alert" className="text-[11px] text-[var(--color-critical)]">{error}</p>}
      {status && !error && <p role="status" className="text-[11px] text-[var(--color-fg-dim)]">{status}</p>}
    </section>
  );
}

/**
 * "Blocked by" / "Blocks" lists. A task with an unfinished blocker is
 * hidden from Today and deferred by `relay queue run` until the blocker is
 * done; agents get the blockers listed as prerequisites in their prompt.
 */
function DependencyPanel({
  task,
  onChange,
  onSelectTask,
}: {
  task: Task;
  onChange?: () => void;
  onSelectTask?: (id: number) => void;
}) {
  const key = `/api/tasks/${task.id}/deps`;
  const { data, mutate } = useSWR<DependencyInfo>(key, () => api.deps(task.id));
  const { mutate: globalMutate } = useSWRConfig();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAdding(false);
    setDraft("");
    setError(null);
  }, [task.id]);

  const afterChange = async (next: DependencyInfo) => {
    await mutate(next, { revalidate: false });
    await Promise.all([
      globalMutate("/api/deps/blocked"),
      globalMutate((k) => typeof k === "string" && (k.startsWith("/api/counts") || k.startsWith("/api/today"))),
    ]);
    onChange?.();
  };

  const add = async () => {
    const id = Number(draft.trim().replace(/^#/, ""));
    if (!Number.isInteger(id) || id <= 0) {
      setError("enter a task id, e.g. 42");
      return;
    }
    setError(null);
    try {
      await afterChange(await api.addDependency(task.id, id));
      setDraft("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not add dependency");
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await afterChange(await api.removeDependency(task.id, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not remove dependency");
    }
  };

  const blockedBy = data?.blocked_by ?? [];
  const blocks = data?.blocks ?? [];
  const waiting = data?.open_blocker_ids.length ?? 0;

  return (
    <section aria-label="Dependencies" className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
        <Link2 className="w-3 h-3" aria-hidden />
        dependencies
        {waiting > 0 && (
          <span className="normal-case tracking-normal font-normal text-[var(--color-warm)]">
            · waiting on {waiting} — hidden from Today
          </span>
        )}
        {blockedBy.length > 0 && waiting === 0 && (
          <span className="normal-case tracking-normal font-normal text-[var(--color-accent)]">· all blockers done — ready</span>
        )}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ml-auto normal-case tracking-normal font-normal text-[11px] text-[var(--color-cool)] hover:underline ring-focus rounded-[var(--radius)]"
          >
            + blocked by…
          </button>
        )}
      </div>
      {adding && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}
            inputMode="numeric"
            placeholder="task id (#42)"
            aria-label="id of the task this one waits on"
            className="w-[120px] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[12px] focus:outline-none focus:border-[var(--color-border-strong)]"
          />
          <Button size="sm" type="submit">add</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>cancel</Button>
        </form>
      )}
      {error && <p role="alert" className="text-[11px] text-[var(--color-critical)]">{error}</p>}
      {blockedBy.length > 0 && (
        <DependencyList label="blocked by" tasks={blockedBy} onSelectTask={onSelectTask} onRemove={(id) => { void remove(id); }} />
      )}
      {blocks.length > 0 && <DependencyList label="blocks" tasks={blocks} onSelectTask={onSelectTask} />}
      {blockedBy.length === 0 && blocks.length === 0 && !adding && (
        <p className="text-[11px] text-[var(--color-fg-dim)]">none — add a blocker to sequence work in Today and the AI queue</p>
      )}
    </section>
  );
}

function DependencyList({
  label,
  tasks,
  onSelectTask,
  onRemove,
}: {
  label: string;
  tasks: Task[];
  onSelectTask?: (id: number) => void;
  onRemove?: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-x-4 text-[12px]">
      <span className="text-[var(--color-fg-dim)] pt-0.5">{label}</span>
      <ul className="space-y-0.5 min-w-0">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 min-w-0">
            <StatusDot status={t.status} className="shrink-0" />
            {onSelectTask ? (
              <button
                type="button"
                onClick={() => onSelectTask(t.id)}
                className={cn(
                  "truncate text-left hover:underline ring-focus rounded-[var(--radius)]",
                  t.status === "done" ? "text-[var(--color-fg-dim)] line-through" : "text-[var(--color-fg)]",
                )}
              >
                <span className="font-mono text-[var(--color-fg-dim)]">#{t.id}</span> {t.title}
              </button>
            ) : (
              <Link
                href={`/tasks?status=all&selected=${t.id}`}
                className={cn(
                  "truncate hover:underline",
                  t.status === "done" ? "text-[var(--color-fg-dim)] line-through" : "text-[var(--color-fg)]",
                )}
              >
                <span className="font-mono text-[var(--color-fg-dim)]">#{t.id}</span> {t.title}
              </Link>
            )}
            <span className="shrink-0 font-mono text-[11px] text-[var(--color-cool)]">{t.repo}</span>
            {onRemove && (
              <button
                type="button"
                aria-label={`remove dependency on task ${t.id}`}
                title="remove dependency (⌘Z to undo)"
                onClick={() => onRemove(t.id)}
                className="ml-auto shrink-0 rounded p-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-critical)] ring-focus"
              >
                <X className="w-3 h-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function isLocked(task: Task, field: EditableField): boolean {
  return task.source_type !== "manual" && (task.user_overrides ?? []).includes(field);
}

function fieldLabel(field: EditableField): string {
  return field === "due_at" ? "due" : field === "wait_on" ? "wait on" : field;
}

function RunHistory({ runs }: { runs: RunListItem[] }) {
  const [openLog, setOpenLog] = useState<number | null>(null);
  const [openChanges, setOpenChanges] = useState<number | null>(null);
  const [openVerify, setOpenVerify] = useState<number | null>(null);
  return (
    <section aria-label="Agent runs" className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
        <History className="w-3 h-3" aria-hidden />
        agent runs
      </div>
      <ul className="space-y-1 text-[12px] font-mono">
        {runs.map((run) => (
          <li key={run.id} className="min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span
                className={cn(
                  "shrink-0 w-[62px]",
                  run.status === "success"
                    ? "text-[var(--color-accent)]"
                    : run.status === "running"
                      ? "text-[var(--color-cool)]"
                      : "text-[var(--color-critical)]",
                )}
              >
                {run.status}
              </span>
              <span className="shrink-0 text-[var(--color-fg-muted)]">{run.agent}</span>
              <span className="shrink-0 text-[var(--color-fg-dim)]" title={run.started_at}>{timeAgo(run.started_at)} ago</span>
              {run.ended_at && (
                <span className="shrink-0 text-[var(--color-fg-dim)]" title="duration">{formatRunDuration(run.started_at, run.ended_at)}</span>
              )}
              {run.output_summary && (
                <span className="truncate text-[var(--color-fg-dim)]" title={run.output_summary}>
                  {run.output_summary.split("\n").at(-1)}
                </span>
              )}
              {run.changes && (
                <button
                  type="button"
                  className={cn(
                    "shrink-0 text-[11px] hover:underline ring-focus rounded-[var(--radius)]",
                    run.changes.files.length + run.changes.more > 0 || run.changes.commits > 0
                      ? "text-[var(--color-fg-muted)]"
                      : "text-[var(--color-fg-dim)]",
                  )}
                  aria-expanded={openChanges === run.id}
                  aria-controls={`run-changes-${run.id}`}
                  title="Files this run changed in the repo"
                  onClick={() => setOpenChanges((current) => (current === run.id ? null : run.id))}
                >
                  {formatChangeSummary(run.changes)}
                </button>
              )}
              {run.verify_status && (
                <button
                  type="button"
                  className={cn(
                    "shrink-0 text-[11px] hover:underline ring-focus rounded-[var(--radius)]",
                    run.verify_status === "passed" ? "text-[var(--color-accent)]" : "text-[var(--color-critical)]",
                  )}
                  aria-expanded={openVerify === run.id}
                  aria-controls={`run-verify-${run.id}`}
                  title={`Verify gate: ${run.verify_command ?? ""}`}
                  onClick={() => setOpenVerify((current) => (current === run.id ? null : run.id))}
                >
                  {run.verify_status === "passed" ? "✓ verified" : "✗ verify"}
                </button>
              )}
              {run.has_log && (
                <button
                  type="button"
                  className="ml-auto shrink-0 text-[11px] text-[var(--color-cool)] hover:underline ring-focus rounded-[var(--radius)]"
                  aria-expanded={openLog === run.id}
                  aria-controls={`run-log-${run.id}`}
                  onClick={() => setOpenLog((current) => (current === run.id ? null : run.id))}
                >
                  {openLog === run.id ? "hide log" : "log"}
                </button>
              )}
            </div>
            {openChanges === run.id && run.changes && <RunChangesView runId={run.id} changes={run.changes} />}
            {openVerify === run.id && run.verify_status && (
              <div
                id={`run-verify-${run.id}`}
                className="mt-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2 py-1.5 space-y-1"
              >
                <p className="text-[11px] text-[var(--color-fg-muted)]">
                  verify {run.verify_status} · <code>{run.verify_command}</code>
                </p>
                {run.verify_output ? (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[var(--color-fg-dim)]">
                    {run.verify_output}
                  </pre>
                ) : (
                  <p className="text-[11px] text-[var(--color-fg-dim)]">(no output)</p>
                )}
              </div>
            )}
            {openLog === run.id && <RunLogView runId={run.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatChangeSummary(changes: RunChanges): string {
  const total = changes.files.length + changes.more;
  if (total === 0 && changes.commits === 0) return "no changes";
  let added = 0;
  let removed = 0;
  for (const f of changes.files) {
    added += f.added ?? 0;
    removed += f.removed ?? 0;
  }
  const parts = [`${total} file${total === 1 ? "" : "s"}${total > 0 ? ` +${added} −${removed}` : ""}`];
  if (changes.commits > 0) parts.push(`${changes.commits} commit${changes.commits === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function RunChangesView({ runId, changes }: { runId: number; changes: RunChanges }) {
  return (
    <div id={`run-changes-${runId}`} className="mt-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2 py-1.5 space-y-0.5">
      {changes.files.length === 0 ? (
        <p className="text-[11px] text-[var(--color-fg-dim)]">
          {changes.commits > 0 ? "commits only — no file differences remain vs the pre-run HEAD" : "the agent left the repo unchanged"}
        </p>
      ) : (
        <ul className="space-y-0.5 text-[11px]">
          {changes.files.map((file) => (
            <li key={file.path} className="flex items-baseline gap-2 min-w-0">
              {file.added === null && file.removed === null ? (
                <span className="shrink-0 w-[72px] text-[var(--color-fg-dim)]">new/bin</span>
              ) : (
                <span className="shrink-0 w-[72px]">
                  <span className="text-[var(--color-accent)]">+{file.added ?? 0}</span>{" "}
                  <span className="text-[var(--color-critical)]">−{file.removed ?? 0}</span>
                </span>
              )}
              <span className="truncate text-[var(--color-fg-muted)]" title={file.path}>{file.path}</span>
            </li>
          ))}
        </ul>
      )}
      {changes.more > 0 && <p className="text-[11px] text-[var(--color-fg-dim)]">… {formatNumber(changes.more)} more</p>}
      <p className="text-[11px] text-[var(--color-fg-dim)]">
        full patch: <code>relay runs --diff {runId}</code>
        {changes.head_before && <> · base <code>{changes.head_before.slice(0, 8)}</code></>}
      </p>
    </div>
  );
}

function RunLogView({ runId }: { runId: number }) {
  const { data, error, isLoading } = useSWR(`/api/runs/${runId}/log`, () => api.runLog(runId));
  return (
    <div id={`run-log-${runId}`} className="mt-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)]/60">
      {isLoading ? (
        <p className="px-2 py-1.5 text-[11px] text-[var(--color-fg-dim)]">loading log…</p>
      ) : error || !data ? (
        <p className="px-2 py-1.5 text-[11px] text-[var(--color-critical)]">log unavailable</p>
      ) : (
        <>
          {data.truncated && (
            <p className="px-2 pt-1.5 text-[11px] text-[var(--color-fg-dim)]">
              showing the end of {formatNumber(data.bytes)} bytes — full log: <code>relay runs --log {runId}</code>
            </p>
          )}
          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-[11px] leading-snug text-[var(--color-fg-muted)]">
            {data.text}
          </pre>
        </>
      )}
    </div>
  );
}

function formatRunDuration(startedAt: string, endedAt: string): string {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min}m${String(sec % 60).padStart(2, "0")}s` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}m`;
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
