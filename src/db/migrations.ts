// Column-level migration helpers extracted from `client.ts`. Runs after
// `SCHEMA_SQL` to ALTER any columns that were added in later schema bumps
// and to lazily ensure auxiliary tables (queue/views/undo/sync_history)
// exist for DBs that predate them. Each helper is idempotent.

import type { Database } from "bun:sqlite";

/**
 * Idempotent column-level migrations for DBs created before schema bumps.
 * Runs AFTER SCHEMA_SQL so the table is guaranteed to exist; ALTERs missing
 * columns and creates any column-dependent indexes (kept here instead of in
 * SCHEMA_SQL so old DBs don't fail before ALTER runs).
 */
export function runColumnMigrations(db: Database): void {
  const ctxCols = db.prepare(`PRAGMA table_info(contexts)`).all() as Array<{ name: string }>;
  if (!ctxCols.some((c) => c.name === "session_id")) {
    db.exec(`ALTER TABLE contexts ADD COLUMN session_id TEXT`);
  }
  if (!ctxCols.some((c) => c.name === "generated_at")) {
    db.exec(`ALTER TABLE contexts ADD COLUMN generated_at TEXT`);
  }
  if (!ctxCols.some((c) => c.name === "model_name")) {
    db.exec(`ALTER TABLE contexts ADD COLUMN model_name TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contexts_session ON contexts (session_id)`);

  // schema_version 2: tasks.wait_on. ALTER TABLE on existing DBs; the
  // NOT NULL DEFAULT 'self' fills every existing row with 'self' in a
  // single statement.
  const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
  if (!taskCols.some((c) => c.name === "wait_on")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN wait_on TEXT NOT NULL DEFAULT 'self'`);
  }

  // schema_version 4: sessions.status. Pre-v4 DBs already have the sessions
  // table from v3 but no status column; backfill defaults all existing rows
  // to 'idle' so we never falsely advertise an unobserved state.
  // schema_version 5: sessions.last_message_text. Nullable preview field —
  // existing rows materialise as NULL until the next sync refreshes them.
  const sessionCols = db
    .prepare(`PRAGMA table_info(sessions)`)
    .all() as Array<{ name: string }>;
  if (sessionCols.length > 0 && !sessionCols.some((c) => c.name === "status")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'`);
  }
  if (sessionCols.length > 0 && !sessionCols.some((c) => c.name === "last_message_text")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN last_message_text TEXT`);
  }

  // schema_version 8: sessions.title. Nullable; pre-v8 rows surface as NULL
  // until the next sync repopulates them. API layer falls back to
  // cwd basename → `(no prompt)` when title is NULL.
  if (sessionCols.length > 0 && !sessionCols.some((c) => c.name === "title")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT`);
  }

  // schema_version 9: sessions.skills_used. JSON-encoded distinct skill
  // names invoked in the session. Pre-v9 rows materialise as NULL until
  // the next sync re-extracts them.
  if (sessionCols.length > 0 && !sessionCols.some((c) => c.name === "skills_used")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN skills_used TEXT`);
  }

  // schema_version 6: shrink undo_log's `prune_delete_done` rows. Pre-v6
  // producers serialised full Task snapshots into `inverse.tasks`, which at
  // production scale ballooned undo_log past 400 MB (one row reached 56 MB).
  // We rewrite the inverse to only carry the deleted ids plus an
  // `unrecoverable: true` flag — undo for these rows now returns a
  // soft-failure response instead of attempting restore. WHERE clause makes
  // the migration idempotent: rows already carrying `unrecoverable` are
  // skipped, so re-running the migration is a no-op. undo_log is guaranteed
  // to exist (ensureUndoSchema is called by every undo write path), but we
  // still gate on table presence to keep this safe on bare-bones DBs.
  const hasUndoTable =
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'undo_log' LIMIT 1`,
      )
      .get() !== undefined;
  if (hasUndoTable) {
    db.exec(
      `UPDATE undo_log
          SET inverse = json_object(
                'ids', json_extract(payload, '$.ids'),
                'unrecoverable', json('true')
              )
        WHERE op_kind = 'prune_delete_done'
          AND json_extract(inverse, '$.unrecoverable') IS NULL`,
    );
  }

  // schema_version 7: rename gemini → antigravity. Google's 2026 release
  // replaces the Gemini CLI with Antigravity CLI (`agy`), so we re-key
  // existing rows in place. Three INSERT-style UPDATEs cover everything the
  // user-facing surface reads:
  //   - tasks.source_type  : "gemini_session_todo" → "antigravity_session_todo"
  //   - tasks.assignee     : "gemini" → "antigravity"
  //   - sessions.type      : "gemini" → "antigravity"
  // The UPDATEs are idempotent (WHERE clauses match only legacy values).
  // No ALTER is required since both columns are TEXT and have always
  // accepted free-form values; the enum lives in src/types.ts.
  //
  // tasks.source_type carries a UNIQUE(source_type, source_id) constraint,
  // so the UPDATE is safe as long as no antigravity rows already exist for
  // the same source_id. On a real user DB this is always true at v7-upgrade
  // time (the adapter that writes antigravity_session_todo doesn't exist
  // until this migration ships). For defense in depth we DELETE any rare
  // collision (preferring the existing antigravity row) before the rename.
  const hasTasksTable =
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks' LIMIT 1`,
      )
      .get() !== undefined;
  if (hasTasksTable) {
    db.exec(
      `DELETE FROM tasks
        WHERE source_type = 'gemini_session_todo'
          AND source_id IN (
            SELECT source_id FROM tasks WHERE source_type = 'antigravity_session_todo'
          )`,
    );
    db.exec(
      `UPDATE tasks
          SET source_type = 'antigravity_session_todo'
        WHERE source_type = 'gemini_session_todo'`,
    );
    db.exec(
      `UPDATE tasks
          SET assignee = 'antigravity'
        WHERE assignee = 'gemini'`,
    );
  }

  const hasSessionsTable =
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions' LIMIT 1`,
      )
      .get() !== undefined;
  if (hasSessionsTable) {
    db.exec(
      `DELETE FROM sessions
        WHERE type = 'gemini'
          AND id IN (SELECT id FROM sessions WHERE type = 'antigravity')`,
    );
    db.exec(
      `UPDATE sessions
          SET type = 'antigravity'
        WHERE type = 'gemini'`,
    );
  }
}

export function ensureQueueSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS queue_items (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      added_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_items_task  ON queue_items (task_id);
    CREATE INDEX IF NOT EXISTS idx_queue_items_added ON queue_items (added_at);
  `);
}

export function ensureViewsSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS views (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL UNIQUE,
      filter_json  TEXT    NOT NULL,
      pinned       INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_views_pinned_created
      ON views (pinned DESC, created_at DESC);
  `);
}

export function ensureUndoSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS undo_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op_kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      inverse TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_undo_log_created_at ON undo_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_undo_log_status_created_at ON undo_log(status, created_at DESC);
  `);

  const cols = db.prepare(`PRAGMA table_info(undo_log)`).all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === "status")) {
    db.exec(`ALTER TABLE undo_log ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
}

export function ensureSyncHistorySchema(db: Database): void {
  db.exec(`
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
  `);
}
