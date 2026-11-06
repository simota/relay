"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Check, RotateCcw, ExternalLink, ChevronDown, Pencil, History, Link2, X, Hash } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { api, type RunListItem } from "@/lib/api";
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
import type { DependencyInfo, EditableField, Task, SourceType } from "@/lib/types";

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
  const { data: runs = [] } = useSWR<RunListItem[]>(
    task ? `/api/runs?task_id=${task.id}` : null,
    () => (task ? api.runs({ taskId: task.id, limit: 5 }) : []),
  );

  // Leaving the task (j/k, list click) abandons an open edit.
  const taskId = task?.id ?? null;
  useEffect(() => {
    setEditing(false);
    setSavedNote(null);
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
            {openLog === run.id && <RunLogView runId={run.id} />}
          </li>
        ))}
      </ul>
    </section>
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
