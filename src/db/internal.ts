// Pure helpers extracted from `client.ts`. None of these touch instance
// state; query modules and the RelayDB facade import them as needed.

import type { Task, TaskInput } from "../types.js";
import type { ContextGraphData, RelayContext, SavedView, ViewFilter } from "./types.js";

export function hydrateContext(row: Record<string, unknown>): RelayContext {
  return {
    hash: row.hash as string,
    repo: row.repo as string,
    branch: row.branch as string,
    headSha: row.head_sha as string,
    dirtyFiles: row.dirty_files ? JSON.parse(row.dirty_files as string) : [],
    summary: (row.summary as string) ?? "",
    sessionId: (row.session_id as string | null) ?? null,
    createdAt: row.created_at as string,
    generatedAt: (row.generated_at as string | null) ?? null,
    modelName: (row.model_name as string | null) ?? null,
    // `linked_tasks_count` is computed only by listContexts/getContext via
    // LEFT JOIN; callers that hydrate single rows from a plain SELECT *
    // get 0, which the UI renders as "no linked tasks".
    linkedTasksCount:
      typeof row.linked_tasks_count === "number"
        ? row.linked_tasks_count
        : Number(row.linked_tasks_count ?? 0) || 0,
  };
}

export function addGraphEdge(
  edges: Map<string, ContextGraphData["edges"][number]>,
  from: string,
  to: string,
  weight: number,
): void {
  const key = from < to ? `${from}\0${to}` : `${to}\0${from}`;
  const existing = edges.get(key);
  if (existing) {
    existing.weight = Math.max(existing.weight, weight);
    return;
  }
  edges.set(key, { from, to, weight });
}

export function serialize(t: TaskInput, now: string) {
  return {
    source_type: t.source_type,
    source_id: t.source_id,
    repo: t.repo,
    title: t.title,
    body: t.body ?? "",
    status: t.status ?? "open",
    assignee: t.assignee ?? "self",
    priority: t.priority ?? 50,
    prompt: t.prompt ?? null,
    files: t.files && t.files.length ? JSON.stringify(t.files) : null,
    context_hash: t.context_hash ?? null,
    session_id: t.session_id ?? null,
    due_at: t.due_at ?? null,
    wait_on: t.wait_on ?? "self",
    created_at: now,
    updated_at: now,
  };
}

export function lastNDays(count: number): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let offset = count - 1; offset >= 0; offset--) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - offset);
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

export function hydrate(row: Record<string, unknown>): Task {
  return {
    id: row.id as number,
    source_type: row.source_type as Task["source_type"],
    source_id: row.source_id as string,
    repo: row.repo as string,
    title: row.title as string,
    body: (row.body as string) ?? "",
    status: row.status as Task["status"],
    assignee: row.assignee as Task["assignee"],
    priority: (row.priority as number) ?? 50,
    prompt: (row.prompt as string | null) ?? null,
    files: row.files ? JSON.parse(row.files as string) : [],
    context_hash: (row.context_hash as string | null) ?? null,
    session_id: (row.session_id as string | null) ?? null,
    due_at: (row.due_at as string | null) ?? null,
    wait_on: (row.wait_on as Task["wait_on"]) ?? "self",
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    closed_at: (row.closed_at as string | null) ?? null,
  };
}

export function normalizeViewFilter(filter: ViewFilter): ViewFilter {
  const normalized: ViewFilter = {};
  if (filter.status?.trim()) normalized.status = filter.status.trim();
  if (filter.repo?.trim()) normalized.repo = filter.repo.trim();
  if (filter.source?.trim()) normalized.source = filter.source.trim();
  if (filter.age?.trim()) normalized.age = filter.age.trim();
  return normalized;
}

export function parseViewFilter(value: string): ViewFilter {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    return normalizeViewFilter({
      status: typeof record.status === "string" ? record.status : undefined,
      repo: typeof record.repo === "string" ? record.repo : undefined,
      source: typeof record.source === "string" ? record.source : undefined,
      age: typeof record.age === "string" ? record.age : undefined,
    });
  } catch {
    return {};
  }
}

export function parseAgeFilter(age?: string): number | null {
  if (!age) return null;
  const match = /^older-(\d+)$/.exec(age);
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return null;
  return days;
}

/**
 * Minimal surface `smartViews` needs from a RelayDB instance. Declared here
 * (instead of importing `RelayDB`) to keep `internal.ts` free of any
 * client.ts → internal.ts → client.ts type cycle.
 */
interface SmartViewsHost {
  smartInboxCounts(): Record<string, number>;
}

export function smartViews(db: SmartViewsHost): SavedView[] {
  const counts = db.smartInboxCounts();
  const createdAt = new Date(0).toISOString();
  return [
    {
      id: -1,
      name: "GitHub PR awaiting review",
      filter: { source: "github_pr" },
      pinned: true,
      created_at: createdAt,
      count: counts.github_pr_review ?? 0,
      smart: true,
    },
    {
      id: -2,
      name: "Code TODOs older than 30d",
      filter: { source: "code_todo", age: "older-30" },
      pinned: true,
      created_at: createdAt,
      count: counts.old_code_todos ?? 0,
      smart: true,
    },
    {
      id: -3,
      name: "Snoozed unsnoozing today",
      filter: { status: "snoozed" },
      pinned: true,
      created_at: createdAt,
      count: counts.unsnoozing_today ?? 0,
      smart: true,
    },
  ];
}
