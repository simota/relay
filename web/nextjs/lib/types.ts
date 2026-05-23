export type SourceType =
  | "code_todo"
  | "github_issue"
  | "github_pr"
  | "gh_notification"
  | "gh_run_failure"
  | "gh_project_card"
  | "git_interrupted"
  | "git_stash"
  | "orphan_branch"
  | "claude_session_todo"
  | "codex_session_todo"
  | "antigravity_session_todo"
  | "cursor_session_todo"
  | "agents_note"
  | "manual";

export type Status =
  | "open"
  | "in_progress"
  | "blocked"
  | "snoozed"
  | "done";

export type Assignee =
  | "claude-code"
  | "codex"
  | "antigravity"
  | "self"
  | "human-review";

// Mirrors src/types.ts WaitOn. Old DB rows backfill to 'self' on read.
export type WaitOn = "self" | "reviewer" | "external" | "scheduled";

export interface Task {
  id: number;
  source_type: SourceType;
  source_id: string;
  repo: string;
  title: string;
  body: string;
  status: Status;
  assignee: Assignee;
  priority: number;
  prompt: string | null;
  files: string[];
  context_hash: string | null;
  session_id: string | null;
  due_at: string | null;
  wait_on: WaitOn;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Counts {
  today: number;
  open: number;
  snoozed: number;
  done: number;
  repos: number;
  contexts: number;
  sources: Partial<Record<SourceType, number>>;
  source_delta_7d?: number;
}

export interface RepoStat {
  name: string;
  open: number;
  in_progress: number;
  snoozed: number;
  lastTouched: string;
  dailyEventCounts?: number[];
  /** Whether the repo directory still exists under scan.roots. */
  exists?: boolean;
  /** Normalized https://github.com/owner/repo URL when derivable. */
  github_url?: string | null;
  default_branch?: string | null;
  last_commit_sha?: string | null;
  last_commit_at?: string | null;
  /** Number of open github_pr tasks (user-assigned or authored). */
  my_open_prs?: number;
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
}

export interface SyncReport {
  inserted: number;
  updated: number;
  unchanged: number;
  errors: Array<{ adapter: string; message: string }>;
}

export interface AppConfig {
  scan_roots: string[];
  github_user: string | null;
  github_orgs: string[];
  agents_default: string;
}

export interface PruneRepoSummary {
  repo: string;
  open: number;
  done: number;
}

export interface AgentFileEntry {
  name: string;
  relativePath: string;
  mtime: string;
  sizeBytes: number;
  content: string;
  truncated: boolean;
}

export interface RepoAgentsResponse {
  repo: string;
  exists: boolean;
  files: AgentFileEntry[];
}

export interface TrackedRepoStatus {
  path: string;     // absolute filesystem path the user supplied
  exists: boolean;  // does the path exist right now?
  isDir: boolean;   // and is it a directory?
}

export interface StandupRunCue {
  agent: string;
  output_summary: string | null;
  ended_at: string | null;
}

export interface StandupTaskCue {
  context_summary: string | null;
  run: StandupRunCue | null;
}

export interface StandupReport {
  since: string;
  sinceIso: string;
  generatedAt: string;
  yesterday: Task[];
  today: Task[];
  blockers: Task[];
  cues: Record<number, StandupTaskCue>;
}

export interface AgendaDay {
  /** YYYY-MM-DD in local time (server-formatted). */
  date: string;
  weekday: string;
  tasks: Task[];
}

export interface AgendaReport {
  days: number;
  fromIso: string;
  toIso: string;
  generatedAt: string;
  overdue: Task[];
  daysList: AgendaDay[];
  scheduledNoDate: Task[];
}

export type WfrPeriod = "8w" | "12w";

export interface WfrWeekRow {
  wk: string;
  wfr: number;
  active_repos: number;
  repos_with_open: number;
  closed_n: number;
  opened_n: number;
}

export interface WfrResponse {
  period: WfrPeriod;
  weeks: WfrWeekRow[];
}

export interface ThroughputResponse {
  window: string;
  closed: number;
  opened: number;
  ratio: number;
}

export interface StaleResponse {
  threshold_days: number;
  stale: number;
  open_total: number;
  ratio: number;
}

export interface TouchedResponse {
  window: string;
  active: number;
  total: number;
}

export interface WaitAgeResponse {
  median_days: number;
  sample_n: number;
}

export interface StaleReposResponse {
  repos: Array<{ repo: string; open_n: number; days_stale: number }>;
}

export interface NewlyActiveResponse {
  window: string;
  repos: Array<{ repo: string; new_tasks: number }>;
}

export interface FlowTimeseriesResponse {
  days: Array<{ day: string; opened: number; closed: number }>;
}

export type WaitOnSegment = "self" | "reviewer" | "external" | "scheduled";

export interface WaitMixResponse {
  mix: Array<{ wait_on: WaitOnSegment; n: number }>;
  total: number;
}

export type AgeBucket = "0-1d" | "1-3d" | "3-7d" | "7-14d" | "14-30d" | "30d+";

export interface AgeHistogramResponse {
  buckets: Array<{ bucket: AgeBucket; n: number }>;
}

export interface SourceInflowResponse {
  window: string;
  rows: Array<{ source_type: string; curr: number; prev: number }>;
}

export interface RunsByAgentResponse {
  days: number;
  rows: Array<{ agent: string; total: number; failed: number; failed_rate: number }>;
}

export type SyncReliabilityStatus = "ok" | "partial" | "error" | "none";

export interface SyncReliabilityResponse {
  days: number;
  adapters: Array<{
    adapter: string;
    cells: Array<{ day: string; status: SyncReliabilityStatus; count: number }>;
  }>;
}

export interface ContextFreshnessResponse {
  repos: Array<{ repo: string; days_since_ctx: number | null; open_n: number }>;
}

export interface OrphansResponse {
  age_days: number;
  rows: Array<{
    id: number;
    repo: string;
    title: string;
    priority: number;
    updated_at: string;
    days_since_updated: number;
  }>;
}

export interface BurndownResponse {
  days: number;
  rows: Array<{ date: string; open: number; in_progress: number; done: number }>;
}

export interface VelocityResponse {
  weeks: number;
  rows: Array<{ repo: string; closed: number; avg_lifetime_days: number }>;
}

export interface DuplicateTask {
  id: number;
  title: string;
  repo: string;
  source_type: string;
}

export interface DuplicateCluster {
  id: number;
  tasks: DuplicateTask[];
}

export interface DuplicatesResponse {
  clusters: DuplicateCluster[];
}

export interface StaleCloseResponse {
  ok: true;
  closed: number;
  ids: number[];
}

export interface SkillRankEntry {
  name: string;
  sessions_count: number;
  prev_sessions_count: number;
  latest_session: {
    type: "claude" | "codex" | "antigravity" | "cursor";
    id: string;
    last_active: string;
  } | null;
}

export interface SkillRankResponse {
  window_days: number;
  total_sessions: number;
  entries: SkillRankEntry[];
}

export type SyncEvent =
  | { type: "adapter_start"; adapter: SourceType }
  | { type: "adapter_done"; adapter: SourceType; inserted: number; updated: number; unchanged: number; fetched: number; elapsedMs: number; sampleSourceIds?: string[] }
  | { type: "adapter_error"; adapter: SourceType; message: string }
  | { type: "prune_complete"; missingRepoCount: number; closedCount: number; deletedCount: number; perRepoTop: PruneRepoSummary[] }
  | { type: "prune_error"; message: string }
  | { type: "done"; report: SyncReport };
