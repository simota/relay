# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`relay` is a local-first CLI/Web hub that aggregates tasks from multiple
sources (code TODOs via `rg`, GitHub issues/PRs via `gh`, Claude Code session
`TodoWrite` blocks, `.agents/*.md` checkboxes, manual entries) into a single
SQLite index, and treats each task as an executable `(repo, agent, prompt,
files, context)` unit that can launch Claude Code / Codex / Antigravity (`agy`) in the
right repo.

## Documentation map

- `README.md` — project overview and feature matrix.
- `INSTALL.md` — Bun-first setup, `bun link` / `relay setup`, troubleshooting.
- `CHEATSHEET.md` — full CLI subcommand reference + Web hotkey summary.
- `SPEC.md` — data model, adapters, `source_id` formats (§6 is canonical).
- `ARCHITECTURE.md` — layer diagram, sequences, on-disk layout.
- `WEB_DESIGN.md` — Web UI design spec.
- `HOTKEYS.md` — Web UI keybindings.
- `AGENTS.md` — Codex CLI / Antigravity CLI contributor guide (mirror of this file's scope-relevant parts in English).
- `SESSIONS.md` — on-disk layout, JSONL/transcript schemas, and relay's extraction logic for Claude / Codex / Antigravity sessions.

## Runtime: Bun-first

The root project requires **Bun ≥ 1.1.0** — not Node. Code imports
`bun:sqlite` and uses `Bun.serve` directly (`src/commands/web.ts`), so
running with plain Node will fail. The linked `relay` binary points at
`src/cli.ts` with a `#!/usr/bin/env bun` shebang, so source edits take
effect without `bun run build` — the dist bundle is for distribution only.

## Commands

Run from the repo root unless noted.

```bash
# install
bun install

# CLI (run from source, no build step needed)
bun run src/cli.ts <subcommand>          # = `bun run dev <subcommand>`
bun run src/cli.ts today
bun run src/cli.ts sync
bun run src/cli.ts web                   # http://127.0.0.1:7340

# typecheck (root + web are separate projects — typecheck both)
bun run typecheck                        # root: tsc --noEmit on src/
(cd web/nextjs && bun run typecheck)     # web: tsc --noEmit

# test
bun test                                 # currently no test files exist

# bundle (only for distribution; dev uses `bun run src/cli.ts`)
bun run build                            # → dist/cli.js
```

### Web frontend (Next.js, separate sub-project)

`web/nextjs/` is a self-contained Next.js 15 + React 19 app that **statically
exports** to `web/nextjs/out/`. The Hono backend (`src/web/server.ts`) serves
that directory at `/` and falls back to the vanilla `web/app/` if `out/` is
absent. So `relay web` works without the frontend build, but only shows a
"frontend not built" placeholder until you build it once:

```bash
cd web/nextjs
bun install
bun run build           # → web/nextjs/out/  (consumed by `relay web`)
bun run dev             # next dev on :3340, proxies /api → :7340 via rewrites
bun run typecheck
bun run lint
```

When developing the UI live: run `relay web` on 7340 in one shell and
`bun run dev` (in `web/nextjs/`) on 3340 in another — `next.config.ts`
rewrites `/api/*` to 7340.

## Architecture (the parts you need to read multiple files to understand)

### Single-process backend

- One Hono app (`src/web/server.ts`) hosts both `/api/*` and the static SPA.
  All Web UI mutations go through HTTP; CLI commands talk to the same
  `RelayDB` class directly via `bun:sqlite` (no server roundtrip).
- The `src/api/*` files (`tasks.ts`, `queue.ts`, `views.ts`, `undo.ts`,
  `contexts.ts`, `insights.ts`, `review.ts`, `sync.ts`, `client-errors.ts`)
  are Hono sub-apps mounted by `buildApp()`. Add new endpoints by creating
  a `createXxxApi()` factory and mounting it with `app.route()`.
- `/api/sync/stream` uses SSE; the front-end shows per-adapter progress
  chips. Each adapter emits `adapter_start` / `adapter_done` /
  `adapter_error` events through `SyncOptions.onEvent`.

### Storage

- DB lives at `~/.relay/db.sqlite` (override via `RELAY_HOME`). Schema in
  `src/db/schema.sql`, mirrored at runtime by `src/db/schema.ts`.
- Idempotent ingest is keyed by `UNIQUE(source_type, source_id)` on `tasks`.
  Every adapter's `source_id` format is documented in `SPEC.md §6`; keep it
  stable across runs or you'll get duplicates.
- `schema_version` table tracks migrations. Bump it when changing the schema.
- `bun:sqlite` is synchronous, so transactions in `RelayDB` don't actually
  overlap even when adapters run via `Promise.all` in `runSync`.

### Adapters

`src/adapters/index.ts` registers adapters; each implements
`Adapter { name: SourceType; fetch(ctx): Promise<TaskInput[]> }`. The
`enabledAdapters()` filter reads `[adapters]` flags from
`~/.relay/config.toml` (schema in `src/config.ts`). New source types must
also be added to the `SourceType` zod enum in `src/types.ts`.

### Repo resolution

`resolveRepoPath()` (`src/repo-resolver.ts`) joins each `scan.roots` entry
with the bare `repo` name. The default root is `~/repos/github.com`, so a
task with `repo: "luna-sns"` resolves to `~/repos/github.com/luna-sns`. If
you need multi-root behavior changes, this is the only place to touch.

### Hotkeys

`HOTKEYS.md` is the Web UI spec. The g-leader sequences (`g t`, `g o`, etc.)
and selection actions (`r s c o`) are implemented in
`web/nextjs/components/app-shell.tsx`; update both the spec and the
implementation when adding a binding.

## Project conventions

- **No `Co-Authored-By` / Claude signatures in commits.** Repo uses
  conventional-commit style (`feat:`, `fix:`, `feat(web):`); follow it.
- Paths in human-facing references are repo-relative (e.g.
  `src/web/server.ts:50`).
- TypeScript is strict with `noUncheckedIndexedAccess`; respect the existing
  null-safety patterns rather than blanket-casting.
- The Web frontend is Next.js 15 + React 19. The root CLI/server has no
  React dependency.

## Working with `/goal`

This section is consumed by Claude Code's `/goal` autonomous loop. Keep it
short, machine-readable, and aligned with the rest of CLAUDE.md.

### Observable completion criteria

A `/goal` is considered complete only when **all** of the following pass on
a clean working tree:

- [ ] `bun run typecheck` exits 0 (root `tsc --noEmit` on `src/`)
- [ ] `(cd web/nextjs && bun run typecheck)` exits 0
- [ ] `bun test` exits 0 (no test files yet; treat empty run as pass)
- [ ] If the goal touches `src/db/schema.sql` or `src/db/schema.ts`, also
      bump `schema_version` and re-run `bun run src/cli.ts sync` against a
      throwaway `RELAY_HOME` to confirm idempotent ingest
- [ ] If the goal ships a CLI entrypoint change, also `bun run build`
      succeeds and `dist/cli.js` starts under `bun dist/cli.js --help`

For UI-touching goals only: rebuild `web/nextjs` with `bun run build` and
confirm `web/nextjs/out/` is regenerated; `relay web` on 7340 should serve
the new bundle without the "frontend not built" placeholder.

### Danger zones (auto-edit prohibited)

`/goal` MUST NOT auto-edit or auto-delete these paths:

- `~/.relay/db.sqlite` — live user task index; data loss is unrecoverable
- `~/.relay/db.sqlite-shm`, `~/.relay/db.sqlite-wal` — WAL/SHM siblings;
  deleting mid-write corrupts the DB
- `~/.relay/config.toml` — user-edited adapter flags and `scan.roots`
- `web/nextjs/out/` — build artifact; regenerate via `bun run build`, never
  hand-edit
- `dist/` — bundler output; regenerate via `bun run build`
- `node_modules/`, `web/nextjs/node_modules/`, `web/nextjs/.next/` — tool
  caches; `bun install` rebuilds, manual edits are silently lost
- `.git/` internals — never write outside `git` commands

If a goal genuinely requires touching these, ask the operator first.

### Compaction anchors

When the conversation needs `/compact`, preserve these summary anchors:

- Active sprint and feature ID (e.g. `Sprint 1 / F-1 sessions table`)
- Files currently modified vs. files already committed on the branch
- Schema state: current `schema_version` and any in-flight migration delta
- Adapter(s) being touched and their `source_id` format from `SPEC.md §6`
- Last green check matrix (`bun run typecheck` root + web, `bun test`)
- Remaining sub-tasks from the goal phrasing and their observable criteria

### Named session convention

For multi-day work, name sessions: `relay-<sprint>-<focus>`. Examples:

- `relay-s1-sessions-table` (Sprint 1, F-1 sessions schema work)
- `relay-s1-bidir-nav` (Sprint 1, F-4 task↔session navigation)
- `relay-s2-codex-resume` (Sprint 2, F-2 Codex/Antigravity `--resume` parity)

Resume via `claude --resume <name>`. The name doubles as the cache key for
status line and notification.

### Goal phrasing template

Good `/goal` prompts for relay use this shape:

> /goal <verb> <scope> until <observable criteria>

Examples:

- /goal implement F-1 sessions table migration until `bun run typecheck`
  passes in root and `web/nextjs` and a `sessions` row appears after
  `bun run src/cli.ts sync`
- /goal wire task↔session bidirectional nav until both panels render and
  `/api/tasks?session_id=<x>` returns filtered rows
- /goal add Codex `--resume` parity until `bun run typecheck` passes and
  relaunching a Codex task reuses the prior session id
