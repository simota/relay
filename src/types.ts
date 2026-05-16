import { z } from "zod";

/**
 * Single source of truth for all task source types.
 * `SourceType` zod enum and TS type both derive from this tuple —
 * add a new entry here and nowhere else.
 */
export const SOURCE_TYPES = [
  "code_todo",
  "github_issue",
  "github_pr",
  "gh_notification",
  "gh_run_failure",
  "gh_project_card",
  "git_interrupted",
  "git_stash",
  "orphan_branch",
  "claude_session_todo",
  "codex_session_todo",
  "gemini_session_todo",
  "cursor_session_todo",
  "agents_note",
  "manual",
] as const;

export const SourceType = z.enum(SOURCE_TYPES);
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Single source of truth for the CLI session families persisted in the
 * `sessions` table (F-1 Phase A). Mirrors the on-disk adapters under
 * `src/adapters/{claude,codex,gemini,cursor}-session.ts`. Kept here (not in
 * `src/sessions/types.ts`) so the DB layer can depend on `types.ts` without
 * pulling in the live-filesystem session reader module.
 */
export const SESSION_TYPES = ["claude", "codex", "gemini", "cursor"] as const;
export const SessionType = z.enum(SESSION_TYPES);
export type SessionType = (typeof SESSION_TYPES)[number];

/**
 * Row shape for the `sessions` table. UNIQUE(type, id) keyed; adapters
 * UPSERT one row per CLI session and the DB becomes the single source of
 * truth (replacing per-call JSONL re-parsing). `sha` is opaque to the DB —
 * adapters fill it with whatever content hash makes incremental sync
 * cheapest (file mtime + size hash, message-tail hash, etc).
 */
export const SessionRow = z.object({
  id: z.string().min(1),
  type: SessionType,
  repo: z.string().nullable().default(null),
  cwd: z.string().nullable().default(null),
  started_at: z.string().min(1),
  last_active: z.string().min(1),
  message_count: z.number().int().min(0).default(0),
  parent_session_id: z.string().nullable().default(null),
  source_path: z.string().min(1),
  sha: z.string().nullable().default(null),
});
export type SessionRow = z.infer<typeof SessionRow>;

export const Status = z.enum([
  "open",
  "in_progress",
  "blocked",
  "snoozed",
  "done",
]);
export type Status = z.infer<typeof Status>;

export const Assignee = z.enum([
  "claude-code",
  "codex",
  "gemini",
  "self",
  "human-review",
]);
export type Assignee = z.infer<typeof Assignee>;

// wait_on describes who currently owns the next action.
// - "self"      → I am the one who has to act next (default)
// - "reviewer"  → blocked on a code reviewer (open PRs I authored)
// - "external"  → blocked on an outside party (third-party assignee,
//                 vendor support, awaiting reply, etc.)
// - "scheduled" → blocked on a date or scheduled event (snoozed tasks
//                 with a due_at typically fall here)
export const WaitOn = z.enum(["self", "reviewer", "external", "scheduled"]);
export type WaitOn = z.infer<typeof WaitOn>;

export const Task = z.object({
  id: z.number().int().positive(),
  source_type: SourceType,
  source_id: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1).max(500),
  body: z.string().default(""),
  status: Status.default("open"),
  assignee: Assignee.default("self"),
  priority: z.number().int().min(0).max(100).default(50),
  prompt: z.string().nullable().default(null),
  files: z.array(z.string()).default([]),
  context_hash: z.string().nullable().default(null),
  session_id: z.string().nullable().default(null),
  due_at: z.string().nullable().default(null),
  wait_on: WaitOn.default("self"),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable().default(null),
});
export type Task = z.infer<typeof Task>;

export const TaskInput = Task.omit({
  id: true,
  created_at: true,
  updated_at: true,
  closed_at: true,
});
export type TaskInput = z.infer<typeof TaskInput>;

export interface ResolvedSource {
  source_type: SourceType;
  source_id: string;
}

export interface Adapter {
  readonly name: SourceType;
  /**
   * Config flag keys that control whether this adapter is enabled.
   * Defaults to `[name]` when omitted.
   *
   * Override when the adapter's registry `name` differs from the flag key
   * (e.g. `claude_session_todo` adapter uses flag `claude_session`) or when
   * a single adapter is enabled by any one of several flags (e.g. `github`
   * adapter is enabled when `github_issue` OR `github_pr` is true).
   */
  readonly flagKeys?: readonly string[];
  /**
   * All `source_type` values this adapter may write to the DB.
   * Defaults to `[name]` when omitted.
   *
   * Override for adapters that emit multiple source types under one registry
   * entry (e.g. `github` emits both `github_issue` and `github_pr`).
   */
  readonly emits?: readonly SourceType[];
  precheck?(ctx: AdapterContext): { skip: true; reason: string } | null;
  fetch(config: AdapterContext): Promise<TaskInput[]>;
  /**
   * Optional sweep returning items the remote side has marked resolved
   * (merged PRs, closed issues). Sync auto-closes any matching DB task.
   */
  fetchResolved?(config: AdapterContext): Promise<ResolvedSource[]>;
}

/**
 * Minimal write-side surface RelayDB exposes to adapters. Currently used by
 * session adapters (F-1 Phase B) to upsert into the `sessions` table as a
 * side effect of the normal task fetch, without re-parsing JSONLs on every
 * `listSessions` call. Keeping this as an interface (rather than importing
 * `RelayDB` directly) avoids a `types.ts` → `db/client.ts` import cycle,
 * since `db/client.ts` already imports `SessionRow` from `types.ts`.
 */
export interface AdapterDB {
  upsertSession(row: SessionRow): void;
}

export interface AdapterContext {
  roots: string[];
  exclude: string[];
  /**
   * When non-empty, only tasks whose `repo` appears in this set are ingested.
   * Empty set (or undefined) = all repos accepted (backward-compatible default).
   */
  trackedRepos?: ReadonlySet<string>;
  githubUser?: string;
  githubOrgs?: string[];
  /**
   * Per-source toggles mirrored from `[adapters]` in config.toml. The
   * registry already filters disabled adapters out before `fetch` runs, so
   * these flags only matter for adapters that bundle multiple source types
   * under one registry name (currently only `github_issue`, which sweeps
   * both issues and PRs). Every flag defaults to `true` so adapters that
   * don't care can ignore the field.
   */
  adapters?: {
    code_todo: boolean;
    github_issue: boolean;
    github_pr: boolean;
    gh_notification: boolean;
    gh_run_failure: boolean;
    gh_project_card: boolean;
    git_interrupted: boolean;
    git_stash: boolean;
    orphan_branch: boolean;
    claude_session: boolean;
    codex_session: boolean;
    gemini_session: boolean;
    cursor_session: boolean;
    agents_note: boolean;
    manual: boolean;
  };
  claudeSession?: {
    excludePatterns: string[];
    storeBody: boolean;
    lookbackDays: number;
  };
  codexSession?: {
    excludePatterns: string[];
    storeBody: boolean;
    lookbackDays: number;
  };
  geminiSession?: {
    excludePatterns: string[];
    storeBody: boolean;
    lookbackDays: number;
  };
  cursorSession?: {
    /**
     * Opt-in regex patterns matched against the full plan-file path or
     * `store.db` path. Off by default since Cursor data is local-only and
     * users typically want everything ingested or nothing.
     */
    excludePatterns: string[];
    /**
     * Opt-in body fetch:
     *   - default OFF: plan tasks carry no body, chat-metadata fallback
     *     path is disabled entirely (chat-meta tasks only exist when
     *     `store_body` is true).
     *   - opt-in ON: plan body contains plan name + overview, and one
     *     low-signal task per Cursor chat agent (title = chat `name`)
     *     within lookback_days gets emitted alongside plan tasks.
     */
    storeBody: boolean;
    /**
     * How far back (in days) to look at plan mtime and chat `createdAt`.
     * Default 14 — Cursor plans persist on disk indefinitely so an
     * unbounded sweep would otherwise resurrect months-old todos.
     */
    lookbackDays: number;
  };
  ghRunFailure?: {
    /**
     * Opt-in fetch of `gh run view --log-failed` output. Off by default
     * because each failing run costs one extra gh API call and the log
     * occasionally contains sensitive paths or tokens echoed by user code.
     */
    storeBody: boolean;
  };
  gitStash?: {
    /**
     * Opt-in fetch of `git stash show --stat <oid>` output. Off by default
     * because each stash costs one extra `git stash show` subprocess and
     * the diff output occasionally contains private content (uncommitted
     * secrets, local-only WIP) the user did not consciously share.
     */
    storeBody: boolean;
  };
  ghProjectCard?: {
    /**
     * Fallback `repo` value for cards whose content is a standalone
     * DraftIssue (no linked Issue/PR, so no `repository.name` is
     * available). Default `"__inbox__"` — a sentinel string that
     * satisfies the `repo TEXT NOT NULL` constraint without colliding
     * with any real repo directory name. fs-bound features (run
     * launcher, `.agents/` editor) treat `__inbox__` like any other
     * missing repo: the task surfaces in lists but `relay run` warns
     * that the path doesn't exist. Users who keep a dedicated inbox
     * repo can point this at it (e.g. `fallback_repo = "inbox"`).
     */
    fallbackRepo: string;
    /**
     * Status field values that mark a card as resolved. Cards whose
     * Status field matches (case-insensitive) any entry here are
     * emitted from `fetchResolved` so the corresponding task closes
     * via `autoCloseResolvedRemoteTasks`. Default mirrors the common
     * GitHub Project v2 column vocabulary (`Done`, `Completed`,
     * `Closed`, `Shipped`) — `Status` field names vary per project so
     * a flexible list beats hard-coding `"Done"`.
     */
    doneStatuses: string[];
  };
  orphanBranch?: {
    /**
     * Opt-in fetch of `git log --oneline ${base}..${branch}` output for
     * the task body. Off by default because individual commit subjects
     * can leak local-only context (internal repo names, accidental WIP
     * secrets) the user did not consciously share. With the flag off
     * the body still carries branch/tip/upstream/age metadata, which is
     * usually enough to recall what the branch was doing.
     */
    storeBody: boolean;
    /**
     * Branch-name globs to skip. Default is `["release/*", "hotfix/*"]`
     * — long-lived collaborative refs that are protected by convention,
     * not orphan WIP. Pattern syntax: `prefix/*` (startsWith match) and
     * exact-name match only; we deliberately avoid pulling in a glob
     * library since the brief is to stay rate-limit-conscious and
     * dependency-light.
     */
    excludePatterns: string[];
  };
  /**
   * Optional callback that returns the open `source_id`s currently stored
   * in the DB for the given `source_type`. Adapters whose remote world
   * is "stateful but not enumerable" (the canonical example is
   * `git_stash`: a popped stash leaves no on-disk trace, so we can't
   * derive resolved entries from the new sweep alone) use this to diff
   * the new live set against what they ingested last sync and emit the
   * missing entries from `fetchResolved`. Optional so the test harness
   * and in-memory adapters can keep ignoring it.
   */
  knownOpenSourceIds?: (sourceType: SourceType) => string[];
  /**
   * ISO 8601 timestamp of the last successful sync for the current adapter.
   * Populated by `runSync` before calling `adapter.fetch` / `fetchResolved`.
   * When non-null, adapters that support incremental fetch use this as a
   * cursor to limit results to items updated since the previous sync.
   * Null on the first-ever sync → adapters fall back to a full sweep.
   */
  lastSyncCursor?: string;
  /**
   * Write-side DB handle. Session adapters use this to UPSERT into the
   * `sessions` table as a best-effort side effect during `fetch`. Optional
   * so test harnesses and in-memory adapters can ignore it; absent =
   * "ignore the sessions side car, just return TaskInput[]".
   */
  db?: AdapterDB;
  dryRun?: boolean;
  log?: (msg: string) => void;
}

export interface SyncReport {
  inserted: number;
  updated: number;
  unchanged: number;
  errors: Array<{ adapter: SourceType; message: string }>;
}
