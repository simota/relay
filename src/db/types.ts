// DB layer public types. Extracted from `client.ts` so query modules and
// consumers can import shape definitions without pulling the full RelayDB
// facade. `client.ts` re-exports every name from this file for backward
// compatibility — external code keeps importing from `../db/client.js`.

import type { Task } from "../types.js";

export interface SnapshotRow {
  source_type: string;
  source_id: string;
  repo: string;
  title: string;
  body: string;
  status: string;
  assignee: string;
  priority: number;
  prompt: string | null;
  files: string[];
  context_hash: string | null;
  session_id: string | null;
  due_at: string | null;
  wait_on: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface QueueItem {
  id: number;
  task_id: number;
  repo: string;
  prompt: string | null;
  added_at: string;
}

export interface ReviewTasks {
  closed: Task[];
  stale: Task[];
  new: Task[];
  unsnoozed: Task[];
}

export interface SyncHistoryRow {
  id: number;
  started_at: string;
  ended_at: string;
  adapter: string;
  status: string;
  count: number;
  error: string | null;
}

export interface LatestSyncRow {
  adapter: string;
  started_at: string;
  ended_at: string;
  status: string;
  count: number;
  error: string | null;
}

export interface HeatmapData {
  repos: string[];
  weeks: string[];
  cells: number[][];
  open: number[][];
  closed: number[][];
}

export type ContextGraphNodeType = "context" | "task" | "repo";

export interface ContextGraphData {
  nodes: Array<{ id: string; type: ContextGraphNodeType; label: string }>;
  edges: Array<{ from: string; to: string; weight: number }>;
}

export interface ViewFilter {
  status?: string;
  repo?: string;
  source?: string;
  age?: string;
}

export interface SavedView {
  id: number;
  name: string;
  filter: ViewFilter;
  pinned: boolean;
  created_at: string;
  count: number;
  smart: boolean;
}

export interface TaskStatusSnapshot {
  id: number;
  status: Task["status"];
  due_at: string | null;
  closed_at: string | null;
}

export interface RelayContext {
  hash: string;
  repo: string;
  branch: string;
  headSha: string;
  dirtyFiles: string[];
  summary: string;
  sessionId: string | null;
  createdAt: string;
  generatedAt: string | null;
  modelName: string | null;
  /**
   * Number of tasks pointing to this context via `tasks.context_hash`.
   * Populated by `listContexts` (and `getContext`); other call sites that
   * fetch a single row without the JOIN leave it at 0. Surfaced inline on
   * the /contexts list so users see linkage without opening detail.
   */
  linkedTasksCount: number;
}
