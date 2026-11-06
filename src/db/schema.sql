-- relay storage schema v14

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT    NOT NULL,
  source_id     TEXT    NOT NULL,
  repo          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'open',
  assignee      TEXT    NOT NULL DEFAULT 'self',
  priority      INTEGER NOT NULL DEFAULT 50,
  prompt        TEXT,
  files         TEXT,             -- JSON array
  context_hash  TEXT,
  session_id    TEXT,
  due_at        TEXT,
  -- wait_on: who the task is currently blocked on. Splits Today into
  -- "self-driven" vs "waiting on someone else" without losing the task.
  -- 'self' (default) | 'reviewer' | 'external' | 'scheduled'
  wait_on       TEXT    NOT NULL DEFAULT 'self',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  closed_at     TEXT,
  -- user_overrides: schema v11 JSON array of field names the user edited
  -- (title, body, priority, prompt, files, due_at, wait_on, repo). Adapter
  -- re-syncs keep the user's value for these fields instead of overwriting.
  -- ALTERed onto pre-v11 DBs in runColumnMigrations().
  user_overrides TEXT,
  -- tags: schema v12 JSON array of normalized user tags (lowercase, e.g.
  -- ["billing","release-v2"]). NULL = untagged. User-owned: adapter
  -- ingest never writes it, so tags survive every re-sync. ALTERed onto
  -- pre-v12 DBs in runColumnMigrations().
  tags          TEXT,
  -- recurrence: schema v13 canonical repeat rule (daily | weekdays |
  -- weekly | biweekly | monthly | every:<N>d | every:<N>w | days:mon,thu).
  -- NULL = one-off. User-owned like tags: closing a recurring task spawns
  -- the next occurrence (src/lib/recurrence.ts). ALTERed onto pre-v13 DBs
  -- in runColumnMigrations().
  recurrence    TEXT,
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_repo     ON tasks (repo);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks (due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority DESC);
-- schema_version 10: partial indexes for the context/session joins. Most
-- rows leave these columns NULL, so indexing only the non-NULL rows keeps
-- the index (and its write cost on ingest) small while context_hash = ?
-- (listContexts' linked-task count, contextGraph, the contexts backfill)
-- and session_id = ? (session task panels, /api/tasks?session_id=) stop
-- full-scanning tasks.
CREATE INDEX IF NOT EXISTS idx_tasks_context_hash ON tasks (context_hash)
  WHERE context_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks (session_id)
  WHERE session_id IS NOT NULL;

-- task_deps: schema v12. "task_id is blocked by depends_on_id". A task
-- with at least one blocker whose status != 'done' is dependency-blocked:
-- Today hides it and "relay queue run" defers it until the blocker is
-- done (or succeeded earlier in the same queue pass). Cycles are rejected
-- at insert time (queries/links.ts).
CREATE TABLE IF NOT EXISTS task_deps (
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at     TEXT    NOT NULL,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id != depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_task_deps_depends_on ON task_deps (depends_on_id);

-- task_notes: schema v14. User-written progress log per task ("tried X,
-- the fixture lives in Y, try Z next"). Notes are fed into the next agent
-- run's prompt (executor formatNotes), which turns a failed run + a note
-- into a retry-with-feedback loop. User-owned: adapter ingest never writes.
CREATE TABLE IF NOT EXISTS task_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes (task_id, created_at);

CREATE TABLE IF NOT EXISTS queue_items (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  added_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_items_task  ON queue_items (task_id);
CREATE INDEX IF NOT EXISTS idx_queue_items_added ON queue_items (added_at);

CREATE TABLE IF NOT EXISTS contexts (
  hash          TEXT    PRIMARY KEY,
  repo          TEXT    NOT NULL,
  branch        TEXT    NOT NULL,
  head_sha      TEXT    NOT NULL,
  dirty_files   TEXT    NOT NULL DEFAULT '[]',   -- JSON array
  summary       TEXT    NOT NULL DEFAULT '',
  session_id    TEXT,
  session_type  TEXT,
  created_at    TEXT    NOT NULL,
  generated_at  TEXT,                            -- when summary was LLM-generated
  model_name    TEXT                             -- model that produced the summary
);

-- idx_contexts_session is created in runColumnMigrations() (migrations.ts)
-- so existing DBs that predate the column don't blow up here.

CREATE INDEX IF NOT EXISTS idx_contexts_repo ON contexts (repo);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent           TEXT    NOT NULL,
  started_at      TEXT    NOT NULL,
  ended_at        TEXT,
  status          TEXT    NOT NULL DEFAULT 'running',
  output_summary  TEXT,
  -- schema v13: what the run changed in the repo. head_before/head_after
  -- are the commits around the run; changes is a JSON
  -- {files:[{path,added,removed}],commits:N,untracked:N} summary of files
  -- the agent touched (pre-existing dirty files are excluded). NULL when
  -- the repo is not a git work tree or the run predates v13.
  head_before     TEXT,
  head_after      TEXT,
  changes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_task ON runs (task_id);

CREATE TABLE IF NOT EXISTS sync_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT    NOT NULL,
  ended_at    TEXT    NOT NULL,
  adapter     TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_history_adapter_started
  ON sync_history (adapter, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_history_started
  ON sync_history (started_at DESC);

CREATE TABLE IF NOT EXISTS views (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  filter_json  TEXT    NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_views_pinned_created
  ON views (pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS undo_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  inverse TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_undo_log_created_at ON undo_log(created_at DESC);
-- idx_undo_log_status_created_at depends on undo_log.status, which pre-status
-- DBs gain via ALTER, so ensureUndoSchema() (migrations.ts) creates it.

-- sessions: first-class store for CLI sessions (Claude / Codex /
-- Antigravity / Cursor). Phase A introduces the table + helpers only;
-- adapter ingest and read-path migration land in later phases. UNIQUE on
-- (type, id) keeps cross-CLI id collisions impossible while letting each
-- adapter UPSERT by its own native session id.
--
-- schema_version 7 renames legacy `gemini` rows to `antigravity` (Gemini
-- CLI's 2026 successor); the rename is data-only and lives in
-- runColumnMigrations() so existing DBs round-trip cleanly.
CREATE TABLE IF NOT EXISTS sessions (
  id                 TEXT NOT NULL,
  type               TEXT NOT NULL,           -- claude|codex|antigravity|cursor
  repo               TEXT,
  cwd                TEXT,
  started_at         TEXT NOT NULL,
  last_active        TEXT NOT NULL,
  message_count      INTEGER NOT NULL DEFAULT 0,
  parent_session_id  TEXT,
  source_path        TEXT NOT NULL,
  sha                TEXT,                    -- content hash, used by incremental sync to skip unchanged files
  -- status: lifecycle state observed by the ingest pipeline.
  -- 'idle' (default, no signal) | 'active' | 'waiting_for_user' | 'interrupted'.
  -- See `SessionStatus` in src/types.ts for the canonical enum.
  status             TEXT NOT NULL DEFAULT 'idle',
  -- last_message_text: preview of the most recent user/assistant message in
  -- the session (truncated to ~240 chars). NULL when the adapter cannot
  -- cheaply extract one (e.g. cursor chat protobuf blobs). Powers the
  -- "最終メッセージ" column on the session list.
  last_message_text  TEXT,
  -- title: schema v8. Per-session display title (truncated to ~240 chars)
  -- so the list view shows the first user prompt even when cwd-based
  -- fallback would yield `(no prompt)` (typical for subagent / cwd-less
  -- conversations). NULL when the adapter cannot extract one; the API
  -- layer falls back to cwd basename → `(no prompt)` in that order.
  title              TEXT,
  -- skills_used: schema v9. JSON-encoded array of distinct skill names
  -- invoked in this session (e.g. ["nexus","guardian"]). Capped at 20
  -- names server-side. NULL when no skill activity was detected.
  -- Drives the skill chips on the session list view.
  skills_used        TEXT,
  PRIMARY KEY (type, id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions (last_active DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_repo        ON sessions (repo);
CREATE INDEX IF NOT EXISTS idx_sessions_type_active ON sessions (type, last_active DESC);

INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (1, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (2, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (3, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (4, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (5, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (6, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (7, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (8, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (9, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (10, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (11, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (12, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (13, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (14, datetime('now'));
