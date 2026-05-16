/**
 * Shared helpers for session-style adapters (claude-session, codex-session,
 * gemini-session, cursor-session) which all need: (a) exclude-pattern
 * matching against a fully-qualified path, (b) extracting the first
 * non-empty line of a user message, (c) truncating long titles with an
 * ellipsis suffix, (d) normalizing per-adapter session metadata into the
 * `sessions` table row shape (F-1 Phase B).
 *
 * Behavior-preserving consolidation of the per-adapter copies. The only
 * functional change in `compileExcludePatterns` is that each regex is
 * compiled once (returning a predicate) rather than re-compiling on every
 * call — previously each adapter ran `new RegExp(pat)` per file per
 * pattern.
 */

import type { SessionRow, SessionType } from "../types.js";

/**
 * Compile a list of exclude-pattern strings into a single predicate that
 * returns `true` when the input path matches any pattern. Invalid regex
 * sources are silently skipped (matching the previous per-adapter behavior
 * where `new RegExp(pat)` was wrapped in try/catch and the offending
 * pattern was ignored).
 */
export function compileExcludePatterns(patterns: string[]): (path: string) => boolean {
  const regexes: RegExp[] = [];
  for (const pat of patterns) {
    try {
      regexes.push(new RegExp(pat));
    } catch {
      // Invalid regex source — skip, same as the legacy per-call behavior.
    }
  }
  if (regexes.length === 0) return () => false;
  return (path: string) => {
    for (const re of regexes) {
      if (re.test(path)) return true;
    }
    return false;
  };
}

/** Return the first line of `s` after trimming, or "" if all lines are blank. */
export function firstNonEmptyLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

/**
 * Strip a namespacing prefix (`tc-` / `tw-`) from a session-style identifier.
 *
 * The claude-session adapter occasionally generates synthetic ids of the form
 * `tc-<n>` (TaskCreate) and `tw-<n>` (TodoWrite) to avoid UNIQUE collisions
 * across sub-todos sharing a session — see
 * `src/adapters/claude-session.ts` around the `tc-${count}` / `tw-${id}`
 * construction sites. Those prefixes are an internal namespace and must NOT
 * leak into URLs pointing at the live session viewer, which expects the raw
 * session UUID. Any input without one of those prefixes is returned unchanged
 * so callers can pass arbitrary ids without conditional logic.
 */
export function stripSessionIdPrefix(id: string): string {
  if (id.startsWith("tc-") || id.startsWith("tw-")) {
    return id.slice(3);
  }
  return id;
}

/**
 * Truncate `s` to at most `max` characters; if truncated, replace the final
 * character with U+2026 HORIZONTAL ELLIPSIS so the result stays exactly
 * `max` characters wide.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Normalize per-adapter session metadata into the `sessions` table row
 * shape. Adapters compute their own `id` / `started_at` / `last_active`
 * (4 session adapters use different on-disk layouts and timestamp sources)
 * and pass the canonical values here. This helper only handles the
 * boilerplate undefined → null coercion required by the `SessionRow`
 * schema and exists so each adapter's call site stays a single line.
 *
 * Field semantics:
 *   - `id`:               session id unique within the `type` (UPSERT key).
 *   - `type`:             one of "claude" / "codex" / "gemini" / "cursor".
 *   - `repo`:             on-disk repo name (resolved via `resolveRepoForCwd`).
 *                         null when the session is from a removed / unknown repo.
 *   - `cwd`:              absolute working directory at session start.
 *   - `startedAt`:        ISO 8601 timestamp the session first appeared.
 *                         Preserved across re-ingest (UPSERT does NOT overwrite
 *                         this column — see `RelayDB.upsertSession`).
 *   - `lastActive`:       ISO 8601 of the latest activity in the session.
 *                         Mutable: each re-ingest refreshes it.
 *   - `messageCount`:     informational, used by `/insights` and Phase C
 *                         `listSessions`. Adapters that can't cheaply count
 *                         pass 0.
 *   - `parentSessionId`:  parent uuid for Claude subagent sessions; null for
 *                         every other adapter (codex/gemini/cursor have no
 *                         parent-child relationship).
 *   - `sourcePath`:       absolute path to the JSONL / plan file / store.db
 *                         the row was derived from. Needed by Phase D's
 *                         incremental-fetch cursor logic.
 *   - `sha`:              opaque content hash. Adapters can pass undefined
 *                         when computing is more expensive than worth.
 */
export function toSessionRow(args: {
  id: string;
  type: SessionType;
  repo?: string | null;
  cwd?: string | null;
  startedAt: string;
  lastActive: string;
  messageCount: number;
  parentSessionId?: string | null;
  sourcePath: string;
  sha?: string | null;
  status?: SessionRow["status"];
}): SessionRow {
  return {
    id: args.id,
    type: args.type,
    repo: args.repo ?? null,
    cwd: args.cwd ?? null,
    started_at: args.startedAt,
    last_active: args.lastActive,
    message_count: args.messageCount,
    parent_session_id: args.parentSessionId ?? null,
    source_path: args.sourcePath,
    sha: args.sha ?? null,
    status: args.status ?? "idle",
  };
}
