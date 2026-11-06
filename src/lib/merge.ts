// Merge duplicate tasks into one survivor.
//
// The same work regularly shows up from several sources — a GitHub issue,
// the TODO comment that references it, the session TodoWrite line that
// mentions it. /insights detects these near-duplicate clusters; merging
// resolves one:
//
//   - the duplicates are closed (no recurrence spawn: a merge is not a
//     completion) and leave the AI job queue;
//   - their tags are unioned onto the survivor;
//   - their dependencies move to the survivor: whatever a duplicate waited
//     on, the survivor now waits on; whatever waited on a duplicate now
//     waits on the survivor (otherwise closing the duplicate would silently
//     unblock it);
//   - their notes are copied to the survivor, plus one note recording the
//     merge, so the next agent run still sees the whole story.
//
// Everything except the queue removal is one `merge` undo_log entry.

import type { RelayDB, TaskNote, TaskStatusSnapshot } from "../db/client.js";
import type { Task } from "../types.js";
import { MAX_TAGS_PER_TASK } from "./tags.js";

export interface MergeResult {
  ok: true;
  keep: number;
  merged: number[];
  tags_added: string[];
  deps_moved: number;
  notes_copied: number;
  dequeued: number;
}

export type MergeOutcome = MergeResult | { ok: false; error: string; status: 400 | 404 };

type Edge = { task_id: number; depends_on_id: number };

function statusSnapshot(task: Task): TaskStatusSnapshot {
  return { id: task.id, status: task.status, due_at: task.due_at, closed_at: task.closed_at };
}

export function mergeTasks(db: RelayDB, keepId: number, dupIds: readonly number[]): MergeOutcome {
  const keep = db.getTask(keepId);
  if (!keep) return { ok: false, error: `task #${keepId} not found`, status: 404 };
  const ids = [...new Set(dupIds)].filter((id) => id !== keepId);
  if (ids.length === 0) return { ok: false, error: "give at least one other task to merge into the survivor", status: 400 };
  const dups = db.getTasksByIds(ids);
  const missing = ids.filter((id) => !dups.some((d) => d.id === id));
  if (missing.length > 0) return { ok: false, error: `task(s) not found: ${missing.map((id) => `#${id}`).join(", ")}`, status: 404 };
  dups.sort((a, b) => a.id - b.id);

  // --- tags ---------------------------------------------------------------
  const keepTags = keep.tags ?? [];
  const union = [...keepTags];
  for (const dup of dups) for (const tag of dup.tags ?? []) if (!union.includes(tag)) union.push(tag);
  const tagsAdded = union.slice(0, MAX_TAGS_PER_TASK).filter((t) => !keepTags.includes(t));
  const tagChange = tagsAdded.length > 0 ? db.setTags(keep.id, [...keepTags, ...tagsAdded]) : null;

  // --- dependencies ---------------------------------------------------------
  const dupSet = new Set(ids);
  const addedEdges: Edge[] = [];
  const tryAdd = (taskId: number, dependsOn: number) => {
    if (taskId === dependsOn || dupSet.has(taskId) || dupSet.has(dependsOn)) return;
    const res = db.addDependency(taskId, dependsOn);
    // Cycles (e.g. the survivor already blocks what a duplicate waited on)
    // are skipped rather than failing the merge.
    if (res.ok && res.added) addedEdges.push({ task_id: taskId, depends_on_id: dependsOn });
  };
  for (const dup of dups) {
    const info = db.dependencyInfo(dup.id);
    for (const blocker of info.blocked_by) if (blocker.status !== "done") tryAdd(keep.id, blocker.id);
    for (const waiter of info.blocks) if (waiter.status !== "done") tryAdd(waiter.id, keep.id);
  }

  // --- notes ----------------------------------------------------------------
  const addedNotes: TaskNote[] = [];
  for (const dup of dups) {
    for (const note of db.listNotes(dup.id)) {
      const copy = db.addNote(keep.id, `[from #${dup.id}] ${note.body}`);
      if (copy) addedNotes.push(copy);
    }
  }
  const summary = dups
    .map((d) => `- #${d.id} ${d.title} (${d.source_type}${d.source_type === "manual" ? "" : ` ${d.source_id}`})`)
    .join("\n");
  const mergeNote = db.addNote(keep.id, `Merged ${dups.length} duplicate task(s) into this one:\n${summary}`);
  if (mergeNote) addedNotes.push(mergeNote);

  // --- close + dequeue the duplicates --------------------------------------------
  const before = dups.map(statusSnapshot);
  let dequeued = 0;
  for (const dup of dups) {
    if (dup.status !== "done") db.setStatus(dup.id, "done");
    dequeued += db.deleteQueueItemsForTask(dup.id);
  }
  const after = db.getTasksByIds(ids).map(statusSnapshot);

  db.recordUndo({
    op_kind: "merge",
    payload: {
      tasks: after,
      tags: tagChange ? [{ id: keep.id, tags: tagChange.after }] : [],
      deps: { add: addedEdges, remove: [] },
      notes: { add: addedNotes, remove: [] },
    },
    inverse: {
      tasks: before,
      tags: tagChange ? [{ id: keep.id, tags: tagChange.before }] : [],
      deps: { add: [], remove: addedEdges },
      notes: { add: [], remove: addedNotes },
    },
  });

  return {
    ok: true,
    keep: keep.id,
    merged: ids,
    tags_added: tagsAdded,
    deps_moved: addedEdges.length,
    notes_copied: addedNotes.length - (mergeNote ? 1 : 0),
    dequeued,
  };
}
