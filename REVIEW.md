# Code Review Guidelines (`REVIEW.md`)

Repository-specific review contract for automated and human reviewers of `relay`. For project structure, build commands, and coding conventions, see [AGENTS.md](./AGENTS.md).

## What Failure Looks Like Here

`relay` is a local-first CLI and Web task/session hub backed by SQLite (`~/.local/share/relay/relay.db`). When a bad change ships here:
- **It silently loses or corrupts local task state**: a sync sweep auto-closes a user-snoozed task, drops a closed GitHub PR transition, or fails to open an existing user's SQLite database because a schema change in `src/db/schema.ts` lacked an idempotent column migration in `src/db/migrations.ts`.
- **It misroutes or executes the wrong local command**: `src/executor/index.ts` spawns `claude`, `codex`, `agy`, `$EDITOR`, or `open` directly inside local repositories.
- **It serves stale or broken Web UI assets**: `src/web/server.ts` serves `web/nextjs/out/` first and falls back to `web/app/`; changes under `web/nextjs/` that break static export (`next build`) or exhaust browser WebGL contexts degrade the live `:7340` dashboard.
- **It leaks local paths or session transcripts**: personal paths, `.antigravitycli/` symlinks, or raw transcripts from `~/.claude`, `~/.codex`, or `~/.gemini/antigravity-cli` reach Git.

## Important (Must Fix Before Merge)

Only flag issues in these failure classes as **Important**; everything else is a **Nit** or omitted:

1. **SQLite Schema & Migration Drift** (`src/db/schema.sql`, `src/db/schema.ts`, `src/db/migrations.ts`):
   - Any table/column change not updated in both `src/db/schema.sql` and `src/db/schema.ts`.
   - Any new column or column-dependent index added to `SCHEMA_SQL` without a guarded `PRAGMA table_info(...)` + `ALTER TABLE` step in `runColumnMigrations()` (`src/db/migrations.ts`).
2. **Task Lifecycle & Adapter Sync Accuracy** (`src/commands/sync.ts`, `src/db/queries/tasks.ts`, `src/db/queries/ingest.ts`, `src/adapters/`):
   - Auto-closing or mutating tasks in user-owned states (`snoozed`, `done`), or asymmetric `WHERE` clauses that write no-op inverse rows to `undo_log`.
3. **Subprocess Execution & Local API Boundary** (`src/executor/index.ts`, `src/web/server.ts`, `src/api/`):
   - Unsanitized shell interpolation, unvalidated query/body parameters (`src/api/`), or loosening the `127.0.0.1` / `localhost` CORS check in `src/web/server.ts`.
4. **Session Reader Parity & Privacy** (`src/sessions/`, `src/lib/`, `.gitignore`):
   - Divergence between list-sync adapters (`src/adapters/`) and detail readers (`src/sessions/`), or tracking local DBs, credentials, or `.antigravitycli/`.
5. **Next.js Static Export & WebGL Resource Safety** (`web/nextjs/`):
   - Breaking static export compatibility (`output: "export"`), or instantiating per-card `THREE.WebGLRenderer` instances instead of using the shared offscreen renderer in `web/nextjs/app/sessions/detail/_components/fleet-hamlet-three-stage.tsx`.

## Always-Human Paths

Changes touching these paths always require human owner review regardless of automated checks:

- `src/db/schema.sql`, `src/db/schema.ts`, `src/db/migrations.ts` — executes automatically against the user's live local SQLite database on startup; a bad migration or unguarded index breaks existing installations.
- `src/executor/index.ts` — spawns local agent CLIs (`claude`, `codex`, `agy`) and `$EDITOR` with `stdio: "inherit"`; flag or argument regressions alter command execution on the user's machine.
- `src/web/server.ts` — configures Hono routes, SSE streams, static asset resolution (`web/nextjs/out/` vs `web/app/`), and localhost CORS boundaries on `:7340`.
- `docs/` — powers the public GitHub Pages site (`https://simota.github.io/relay/`); moving or renaming assets breaks production links ([AGENTS.md](./AGENTS.md)).

## Skip Paths

Do not review generated artifacts or lockfiles:

- `dist/`
- `web/nextjs/out/`
- `web/nextjs/.next/`
- `bun.lock`

## Nit Cap & Automated Checks

- **Nit cap**: at most **3** Nits per review.
- Do not post Nits for formatting, lint, or type rules covered by:
  - `bun run typecheck` (`tsc --noEmit`) and `bun test` (`package.json`)
  - `cd web/nextjs && bun run typecheck`, `cd web/nextjs && bun run lint` (`eslint .`), and `cd web/nextjs && bun run build` (`web/nextjs/package.json`)

## Evidence & Summary Format

- **Evidence**: every finding must cite `file:line` and state the concrete failure mode. Mark issues on untouched lines as **Pre-existing**. Post at most **one comment per class of bug**.
- **Summary shape**: lead with the count on the first line (`<N> Important, <M> Nit` or `Nothing to fix`), followed by a one-line verdict.

## Learned Rules

- **Preserve snoozed tasks on upstream close** (`b00ab92`): in `src/db/queries/tasks.ts` (`closeTasksBySourceIds`), exclude `status = 'snoozed'` from both the `SELECT` lookup and `UPDATE` statement so resolved GitHub PRs/issues never silently clear a user's snooze or pollute `undo_log`.
- **Never share open-sweep cursors with closed GitHub sweeps** (`e1dd92d`): in `src/adapters/github.ts`, closed sweeps must run without the open-sweep `updatedSince` filter and explicitly pass `--sort updated --order desc` to `gh search` so recent closes are not dropped past the 200-item slice.
- **Keep Antigravity `cwd` resolution symmetric across list and detail** (`88516a9`): `src/adapters/antigravity-session.ts` and `src/sessions/antigravity.ts` must share the 3-step chain (`history.jsonl` → transcript `workspace=` marker → `deriveCwdFromMentions` in `src/lib/antigravity-workspace.ts` anchored to `scan.roots`) so subagent sessions do not collapse to `repo = null`.
- **Pair every `SCHEMA_SQL` column addition with `runColumnMigrations` and `COALESCE` upserts** (`9547239`): when adding nullable metadata columns like `sessions.title`, guard `ALTER TABLE` with `PRAGMA table_info(...)` in `src/db/migrations.ts` and use `COALESCE(excluded.title, sessions.title)` in `src/db/queries/tasks.ts`.
- **Bound `undo_log` payload size on bulk deletes** (`9547239`): `prune_delete_done` must record only deleted IDs plus `unrecoverable: true` rather than full `Task` snapshots, which previously ballooned `undo_log` past 400 MB (`src/db/migrations.ts`).
- **Route Web shortcuts through the shared hotkey registry** (`7a895bd`, `27502d2`): register keyboard shortcuts in `web/nextjs/hooks/use-hotkeys.ts` and document them in `HOTKEYS.md` so component-level listeners do not collide.
- **Validate API query parameters and ingest inputs consistently** (`16ada30`, `d76fcd0`): normalize query bounds in `src/web/server.ts` / `src/api/undo.ts` and handle multi-line quoted CSV fields in `src/commands/import.ts`.
