import type { RelayDB, RelayContext } from "../db/client.js";
import type { Task } from "../types.js";

export interface ResumeBriefReason {
  label: string;
  detail: string;
  weight: number;
}

export interface ResumeBriefCandidate {
  task: Task;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: ResumeBriefReason[];
  context: {
    hash: string;
    summary: string;
    age: string;
    dirtyFiles: string[];
    sessionType: string | null;
    sessionId: string | null;
  } | null;
  next_action: string;
  run_command: string;
  reliability: {
    context_fresh: boolean;
    resume_ready: boolean;
    dirty_state_known: boolean;
  };
}

export interface ResumeBrief {
  generated_at: string;
  candidate: ResumeBriefCandidate | null;
}

export function buildResumeBrief(
  db: RelayDB,
  opts: {
    candidates: Task[];
    now?: Date;
  },
): ResumeBrief {
  const now = opts.now ?? new Date();
  let best: ResumeBriefCandidate | null = null;

  for (const task of opts.candidates) {
    const ctx = task.context_hash ? db.getContext(task.context_hash) : null;
    const candidate = scoreTask(task, ctx, now);
    if (!best || candidate.score > best.score) best = candidate;
  }

  return {
    generated_at: now.toISOString(),
    candidate: best,
  };
}

function scoreTask(
  task: Task,
  ctx: RelayContext | null,
  now: Date,
): ResumeBriefCandidate {
  const reasons: ResumeBriefReason[] = [];
  const add = (label: string, detail: string, weight: number) => {
    if (weight <= 0) return;
    reasons.push({ label, detail, weight });
  };

  add("priority", `priority ${task.priority}`, task.priority);

  if (task.status === "in_progress") {
    add("in progress", "already started, cheapest to resume", 30);
  }
  if (task.wait_on === "self") {
    add("waiting on me", "next action is owned locally", 18);
  }
  if (isAgentSource(task.source_type)) {
    add("agent residue", `${task.source_type.replace(/_/g, " ")} can evaporate without a resume pass`, 18);
  }
  if (task.session_id) {
    add("resume pointer", "linked to an agent session", 12);
  }
  if (ctx) {
    const ageHours = ageHoursBetween(ctx.createdAt, now);
    const fresh = ageHours <= 72;
    add("context", `${fresh ? "fresh" : "available"} context snapshot from ${humanAge(ctx.createdAt, now)}`, fresh ? 18 : 10);
    if (ctx.dirtyFiles.length > 0) {
      add("dirty files", `${ctx.dirtyFiles.length} dirty file${ctx.dirtyFiles.length === 1 ? "" : "s"} captured`, 16);
    }
  }
  if (task.source_type === "git_dirty_worktree" || task.source_type === "git_interrupted") {
    add("local state", "git state is local-only and easy to forget", 16);
  }
  if (task.due_at) {
    const dueMs = Date.parse(task.due_at);
    if (!Number.isNaN(dueMs)) {
      const hoursUntilDue = (dueMs - now.getTime()) / 3_600_000;
      if (hoursUntilDue <= 0) add("overdue", "due date has passed", 18);
      else if (hoursUntilDue <= 36) add("due soon", `due ${humanAge(task.due_at, now)} from now`, 12);
    }
  }

  const idleDays = Math.max(0, Math.floor((now.getTime() - Date.parse(task.updated_at)) / 86_400_000));
  if (Number.isFinite(idleDays) && idleDays >= 2) {
    add("stale risk", `${idleDays}d since last task update`, Math.min(14, idleDays * 2));
  }

  reasons.sort((a, b) => b.weight - a.weight);
  const score = reasons.reduce((sum, reason) => sum + reason.weight, 0);
  const context = ctx
    ? {
        hash: ctx.hash,
        summary: firstLine(ctx.summary),
        age: humanAge(ctx.createdAt, now),
        dirtyFiles: ctx.dirtyFiles,
        sessionType: ctx.sessionType,
        sessionId: ctx.sessionId,
      }
    : null;

  return {
    task,
    score,
    confidence: confidenceFor(score, reasons, ctx),
    reasons: reasons.slice(0, 5),
    context,
    next_action: nextActionFor(task, context),
    run_command: `relay run ${task.id}`,
    reliability: {
      context_fresh: ctx ? ageHoursBetween(ctx.createdAt, now) <= 72 : false,
      resume_ready: Boolean(task.session_id || task.prompt || task.context_hash),
      dirty_state_known: Boolean(ctx && ctx.dirtyFiles.length > 0),
    },
  };
}

function confidenceFor(
  score: number,
  reasons: ResumeBriefReason[],
  ctx: RelayContext | null,
): ResumeBriefCandidate["confidence"] {
  const hasResumeSignal = reasons.some((r) =>
    r.label === "context" || r.label === "resume pointer" || r.label === "agent residue",
  );
  if (score >= 100 && hasResumeSignal && ctx) return "high";
  if (score >= 70 && hasResumeSignal) return "medium";
  return "low";
}

function nextActionFor(
  task: Task,
  context: ResumeBriefCandidate["context"],
): string {
  if (context?.summary) return context.summary;
  if (task.prompt) return firstLine(task.prompt);
  if (task.body) return firstLine(task.body);
  return task.title;
}

function isAgentSource(source: string): boolean {
  return source === "claude_session_todo" ||
    source === "codex_session_todo" ||
    source === "antigravity_session_todo" ||
    source === "cursor_session_todo";
}

function firstLine(s: string): string {
  return (
    s
      .split("\n")
      .map((line) => line.replace(/^[-*•]\s+/, "").trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function ageHoursBetween(iso: string, now: Date): number {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - ts) / 3_600_000);
}

function humanAge(iso: string, now: Date): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "unknown";
  const ms = now.getTime() - ts;
  const absMs = Math.abs(ms);
  const minutes = Math.floor(absMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
