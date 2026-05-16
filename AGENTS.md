# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the Bun/TypeScript CLI and local API. Command entry points live in `src/commands/`, API handlers in `src/api/`, SQLite files in `src/db/`, source ingesters in `src/adapters/`, execution helpers in `src/executor/`, and session readers in `src/sessions/`. `src/cli.ts` is the CLI entry; `src/web/server.ts` serves the Hono backend.

`web/nextjs/` is the production Next.js UI. App routes live in `web/nextjs/app/`, components in `web/nextjs/components/`, hooks in `web/nextjs/hooks/`, and utilities/types in `web/nextjs/lib/`. `web/app/` is a vanilla fallback served when `web/nextjs/out/` has not been built yet. The landing page assets in `docs/` are served at `https://simota.github.io/relay/` via GitHub Pages — do not move them. Project docs: `README.md`, `INSTALL.md`, `CHEATSHEET.md`, `SPEC.md`, `ARCHITECTURE.md`, `WEB_DESIGN.md`, and `HOTKEYS.md`.

## Build, Test, and Development Commands

Run commands from the repository root unless noted.

- `bun install && bun link`: install root deps and put `relay` on `$PATH` (`bin.relay` points at `src/cli.ts`, so source changes take effect immediately — no `bun run build` needed for development).
- `relay setup`: one-shot — installs root + `web/nextjs` deps and builds the Next.js static export. Idempotent; use `--force` to redo, `--skip-install` / `--skip-build` for partial runs.
- `bun run dev <command>`: run the CLI from source via the package script, e.g. `bun run dev doctor`.
- `bun run build`: bundle `src/cli.ts` into `dist/cli.js` (for distribution only — dev does not need this).
- `bun run typecheck`: TypeScript checks for the root package.
- `bun test`: run Bun tests when present.
- `cd web/nextjs && bun run dev`: start Next.js on port `3340` (proxies `/api` to `:7340`).
- `cd web/nextjs && bun run typecheck` / `bun run lint`: web project checks.

## Coding Style & Naming Conventions

Use TypeScript ES modules, two-space indentation, explicit exported types where useful, and small modules organized by responsibility. File names are generally kebab-case (`client-errors.ts`, `new-task-dialog.tsx`); React components use PascalCase inside the file. Prefer existing helpers and schemas over ad hoc parsing. Validate external inputs with `zod` or established local patterns.

## Testing Guidelines

Use Bun’s test runner for root package tests. Place focused tests near covered code with names such as `fuzzy.test.ts` or `filter-dsl.test.ts`. For Web UI changes, at minimum run `bun run typecheck` and `bun run build` in `web/nextjs`; add tests for parsing, filtering, queue behavior, or API contracts.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit style, often with scopes: `feat(web): ...`, `feat: ...`. Keep commits focused and product-oriented. PRs should include a summary, verification commands, linked issue or task when available, screenshots for visible Web changes, and notes about migrations or config changes.

## Security & Configuration Tips

This is a local-first task hub. Do not commit local databases, generated credentials, API tokens, or session transcripts. Avoid logging secrets or private task payloads. Keep schema changes synchronized across `src/db/schema.sql` and `src/db/schema.ts`.
