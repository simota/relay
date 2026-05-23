import type {
  AgendaReport,
  Task,
  Counts,
  RepoStat,
  RelayContext,
  StandupReport,
  SyncReport,
  AppConfig,
  RepoAgentsResponse,
  TrackedRepoStatus,
  WfrResponse,
  WfrPeriod,
  ThroughputResponse,
  StaleResponse,
  TouchedResponse,
  WaitAgeResponse,
  StaleReposResponse,
  NewlyActiveResponse,
  FlowTimeseriesResponse,
  WaitMixResponse,
  AgeHistogramResponse,
  SourceInflowResponse,
  RunsByAgentResponse,
  SyncReliabilityResponse,
  ContextFreshnessResponse,
  OrphansResponse,
  BurndownResponse,
  VelocityResponse,
  DuplicatesResponse,
  StaleCloseResponse,
  SkillRankResponse,
} from "./types";

// Origin prefix for EventSource / fetch streaming. In `next dev` the /api/*
// rewrite buffers text/event-stream responses so SSE never reaches the
// browser; setting NEXT_PUBLIC_RELAY_API=http://127.0.0.1:7340 makes those
// streams hit Hono directly (CORS is enabled server-side for localhost).
// Production export served by Hono itself leaves this empty (same-origin).
export const SSE_BASE: string = process.env.NEXT_PUBLIC_RELAY_API ?? "";

export interface ReviewData {
  closed: Task[];
  stale: Task[];
  new: Task[];
  unsnoozed: Task[];
}

export interface QueueItem {
  id: number;
  task_id: number;
  repo: string;
  prompt: string | null;
  added_at: string;
}

export interface SyncHistoryRow {
  id: number;
  started_at: string;
  ended_at: string;
  adapter: string;
  status: "ok" | "error";
  count: number;
  error: string | null;
}

export interface HeatmapData {
  repos: string[];
  weeks: string[];
  cells: number[][];
  open?: number[][];
  closed?: number[][];
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

export interface UndoLogItem {
  id: number;
  op_kind: string;
  created_at: string;
  status: "active" | "undone";
}

export type SessionType = "claude" | "codex" | "antigravity";

// Mirror of the canonical enum in src/types.ts. Kept inline rather than
// generated so the web bundle does not pull in the server-side zod schema.
export type SessionStatus = "active" | "waiting_for_user" | "interrupted" | "ended" | "idle";

export interface SessionSummary {
  type: SessionType;
  id: string;
  repo: string | null;
  cwd: string | null;
  title: string;
  started_at: string;
  last_active: string;
  message_count: number;
  todos_count: number;
  /** Set when this session is a subagent; contains the parent session UUID. */
  parent_session_id?: string;
  /** Set when this session is a subagent; e.g. "agent-a920f50". */
  agent_id?: string;
  /** Number of subagent sessions under this parent. Omitted when 0. */
  subagent_count?: number;
  /**
   * Lifecycle state from the detector. The list endpoint reads this from the
   * DB (refreshed on sync); the detail endpoint / SSE stream recomputes it
   * on every JSONL change so the UI updates in real time. Omitted for
   * sources whose adapter has no detection yet (currently codex/antigravity).
   */
  status?: SessionStatus;
  /**
   * Preview of the most recent user/assistant message in this session.
   * Truncated server-side to ~240 chars. Omitted when the adapter could not
   * extract one (e.g. cursor sessions whose chat blobs are protobuf-encoded).
   */
  last_message?: string;
  /**
   * Distinct skill names invoked in this session, ordered by descending
   * call count and capped at 20. Omitted when no skill activity was
   * detected. Drives skill chips in the list/board view.
   */
  skills_used?: string[];
}

export type SessionSkillSource =
  | "skill_tool"
  | "slash_command"
  | "subagent"
  | "session_meta";

export interface SessionSkillUse {
  name: string;
  source: SessionSkillSource;
  first_ts: string;
  last_ts: string;
  count: number;
  last_args: string | null;
  /** First token of the latest args — surfaced as `nexus(apex)` etc. Null when unavailable. */
  recipe: string | null;
  /** "failed" when the most recent paired tool_result had is_error: true. */
  last_status: "success" | "failed" | null;
  /** True for the aggregate entry tied to the chronologically-first use of this skill name. */
  is_first_use_in_session: boolean;
}

export interface SessionMessage {
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
}

export interface SessionTodo {
  id: string;
  title: string;
  status: string;
}

export interface SessionToolCall {
  timestamp: string;
  name: string;
  args_summary: string;
  args_json: string | null;
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
  todos: SessionTodo[];
  tool_calls: SessionToolCall[];
  /** Aggregated skill invocations observed in this session. Empty when none. */
  skills: SessionSkillUse[];
  /** Parent → child skill relationships observed in this session. */
  skill_chains: SessionSkillChainEdge[];
}

export interface SessionSkillChainEdge {
  parent: string;
  child: string;
  ts: string;
}

export interface SessionTaskSummary {
  id: number;
  title: string;
  status: string;
  priority: number;
  repo: string;
  source_type: string;
  updated_at: string;
}

export interface SessionTasksResponse {
  count: number;
  sample: SessionTaskSummary[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} → ${r.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return r.json();
}

export const api = {
  health: () => request<{ status: string; version: string }>("/api/health"),
  config: () => request<AppConfig>("/api/config"),
  counts: () => request<Counts>("/api/counts"),
  today: (limit = 50) => request<Task[]>(`/api/today?limit=${limit}`),
  tasks: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    return request<Task[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
  },
  task: (id: number) => request<Task>(`/api/tasks/${id}`),
  review: (week: string) => request<ReviewData>(`/api/review?week=${encodeURIComponent(week)}`),
  heatmap: (params: { from?: string; to?: string; period?: string; source?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.period) q.set("period", params.period);
    if (params.source) q.set("source", params.source);
    const qs = q.toString();
    return request<HeatmapData>(`/api/insights/heatmap${qs ? `?${qs}` : ""}`);
  },
  insights: {
    wfr: (period: WfrPeriod = "8w") => request<WfrResponse>(`/api/insights/wfr?period=${period}`),
    throughput: (window: "7d" | "30d" = "7d") =>
      request<ThroughputResponse>(`/api/insights/throughput?window=${window}`),
    stale: (threshold: 7 | 14 | 30 = 14) =>
      request<StaleResponse>(`/api/insights/stale?threshold=${threshold}`),
    touched: (window: "7d" | "30d" = "7d") =>
      request<TouchedResponse>(`/api/insights/touched?window=${window}`),
    waitAge: () => request<WaitAgeResponse>("/api/insights/wait_age"),
    staleRepos: (limit = 5) => request<StaleReposResponse>(`/api/insights/stale_repos?limit=${limit}`),
    newlyActive: (window: "7d" | "14d" | "30d" = "14d") =>
      request<NewlyActiveResponse>(`/api/insights/newly_active?window=${window}`),
    flowTimeseries: (days = 30) =>
      request<FlowTimeseriesResponse>(`/api/insights/flow_timeseries?days=${days}`),
    waitMix: () => request<WaitMixResponse>("/api/insights/wait_mix"),
    ageHistogram: () => request<AgeHistogramResponse>("/api/insights/age_histogram"),
    sourceInflow: (window: "7d" | "30d" = "7d") =>
      request<SourceInflowResponse>(`/api/insights/source_inflow?window=${window}`),
    runsByAgent: (days = 30) =>
      request<RunsByAgentResponse>(`/api/insights/runs_by_agent?days=${days}`),
    syncReliability: (days = 7) =>
      request<SyncReliabilityResponse>(`/api/insights/sync_reliability?days=${days}`),
    contextFreshness: (limit = 30) =>
      request<ContextFreshnessResponse>(`/api/insights/context_freshness?limit=${limit}`),
    orphans: (age = 30, limit = 20) =>
      request<OrphansResponse>(`/api/insights/orphans?age=${age}&limit=${limit}`),
    burndown: (days = 30) =>
      request<BurndownResponse>(`/api/insights/burndown?days=${days}`),
    velocity: (weeks = 4) =>
      request<VelocityResponse>(`/api/insights/velocity?weeks=${weeks}`),
    duplicates: () =>
      request<DuplicatesResponse>("/api/insights/duplicates"),
    skills: (windowDays = 30) =>
      request<SkillRankResponse>(`/api/insights/skills?window_days=${windowDays}`),
    staleClose: (threshold = 30) =>
      request<StaleCloseResponse>(`/api/insights/stale/close?threshold=${threshold}`, {
        method: "POST",
      }),
  },
  standup: (since: string = "24h") =>
    request<StandupReport>(`/api/standup?since=${encodeURIComponent(since)}`),
  agenda: (days: number = 7) =>
    request<AgendaReport>(`/api/agenda?days=${encodeURIComponent(String(days))}`),
  repos: () => request<RepoStat[]>("/api/repos"),
  getTrackedRepos: () =>
    request<{ trackedRepos: TrackedRepoStatus[] }>("/api/scan/tracked"),
  setTrackedRepos: (repos: string[]) =>
    request<{ trackedRepos: TrackedRepoStatus[] }>("/api/scan/tracked", {
      method: "POST",
      body: JSON.stringify({ repos }),
      headers: { "content-type": "application/json" },
    }),
  repoPath: (name: string) => request<{ path: string }>(`/api/repos/${encodeURIComponent(name)}/path`),
  repoAgents: (name: string) => request<RepoAgentsResponse>(`/api/repos/${encodeURIComponent(name)}/agents`),
  contexts: (repo?: string, limit = 50) => {
    const q = new URLSearchParams();
    if (repo) q.set("repo", repo);
    q.set("limit", String(limit));
    return request<RelayContext[]>(`/api/contexts?${q}`);
  },
  context: (hash: string) => request<RelayContext>(`/api/contexts/${hash}`),
  contextGraph: (params: { repo?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.repo) q.set("repo", params.repo);
    q.set("limit", String(params.limit ?? 200));
    return request<ContextGraphData>(`/api/contexts/graph?${q}`);
  },
  snooze: (id: number) => request<Task>(`/api/tasks/${id}/snooze`, { method: "POST" }),
  close: (id: number) => request<Task>(`/api/tasks/${id}/close`, { method: "POST" }),
  reopen: (id: number) => request<Task>(`/api/tasks/${id}/reopen`, { method: "POST" }),
  reassign: (id: number, assignee: string) =>
    request<Task>(`/api/tasks/${id}/assignee`, {
      method: "POST",
      body: JSON.stringify({ assignee }),
    }),
  bulkSnooze: (ids: number[], until: string) =>
    request<{ ok: true; count: number }>("/api/tasks/bulk/snooze", {
      method: "POST",
      body: JSON.stringify({ ids, until }),
    }),
  bulkClose: (ids: number[]) =>
    request<{ ok: true; count: number }>("/api/tasks/bulk/close", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  bulk: (input: { action: "snooze"; ids: number[]; until: string } | { action: "close"; ids: number[] }) =>
    input.action === "snooze"
      ? api.bulkSnooze(input.ids, input.until)
      : api.bulkClose(input.ids),
  undo: (redo = false) =>
    request<{ ok: true; id?: number; op_kind?: string; count?: number; undone: boolean; redone: boolean }>(
      `/api/undo${redo ? "?redo=1" : ""}`,
      { method: "POST" },
    ),
  undoLog: (limit = 20) => request<UndoLogItem[]>(`/api/undo?limit=${limit}`),
  queue: {
    list: () => request<QueueItem[]>("/api/queue"),
    add: (id: number) =>
      request<{ id: number }>("/api/queue/items", {
        method: "POST",
        body: JSON.stringify({ task_id: id }),
      }),
    remove: (id: number) =>
      request<{ ok: true }>(`/api/queue/items/${id}`, { method: "DELETE" }),
    clear: () => request<{ ok: true }>("/api/queue", { method: "DELETE" }),
  },
  views: {
    list: () => request<SavedView[]>("/api/views"),
    create: (input: { name: string; filter: ViewFilter; pinned?: boolean }) =>
      request<SavedView>("/api/views", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    remove: (id: number) =>
      request<{ ok: true }>(`/api/views?id=${encodeURIComponent(String(id))}`, { method: "DELETE" }),
  },
  sync: (source?: string) =>
    request<SyncReport>(`/api/sync${source ? `?source=${source}` : ""}`, { method: "POST" }),
  syncAdapter: (adapter: string) =>
    request<SyncReport>(`/api/sync?adapter=${encodeURIComponent(adapter)}`, { method: "POST" }),
  sessions: (
    params: {
      type?: SessionType;
      repo?: string;
      limit?: number;
      lookbackDays?: number;
      includeSubagents?: boolean;
      parent?: string;
    } = {},
  ) => {
    const q = new URLSearchParams();
    if (params.type) q.set("type", params.type);
    if (params.repo) q.set("repo", params.repo);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.lookbackDays) q.set("lookback_days", String(params.lookbackDays));
    if (params.includeSubagents) q.set("include", "subagents");
    if (params.parent) q.set("parent", params.parent);
    const qs = q.toString();
    return request<SessionSummary[]>(`/api/sessions${qs ? `?${qs}` : ""}`);
  },
  // Live status scan for Claude sessions. Hits the lightweight /scan-live
  // endpoint that re-detects status from JSONLs modified in the given
  // window, sidestepping the DB-cached list. Used by the notification
  // hook so freshly waiting sessions surface within one poll cycle rather
  // than waiting for the next full sync.
  sessionsScanLive: (params: { sinceMin?: number; includeSubagents?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (params.sinceMin) q.set("since_min", String(params.sinceMin));
    if (params.includeSubagents === false) q.set("subagents", "0");
    const qs = q.toString();
    return request<SessionSummary[]>(`/api/sessions/scan-live${qs ? `?${qs}` : ""}`);
  },
  session: (type: SessionType, id: string) =>
    request<SessionDetail>(`/api/sessions/${type}/${encodeURIComponent(id)}`),
  sessionTasks: (type: SessionType, id: string) =>
    request<SessionTasksResponse>(
      `/api/sessions/${type}/${encodeURIComponent(id)}/tasks`,
    ),
  syncHistory: (params: { adapter?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.adapter) q.set("adapter", params.adapter);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<SyncHistoryRow[]>(`/api/sync/history${qs ? `?${qs}` : ""}`);
  },
  focus: {
    get: () => request<{ focus_task_id: number | null }>("/api/focus"),
    set: (id: number | null) =>
      request<{ focus_task_id: number | null }>("/api/focus", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    clear: () =>
      request<{ focus_task_id: number | null }>("/api/focus", {
        method: "POST",
        body: JSON.stringify({ id: null }),
      }),
  },
};

export const fetcher = (path: string) => request<unknown>(path);
