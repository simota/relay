import type { SourceType, Task } from "@/lib/types";
import type { SessionType } from "@/lib/api";

/**
 * Map a session-style source_type to its corresponding live-session viewer
 * type. Returns null for non-session sources (github_pr, code_todo, etc.) so
 * the caller can choose to render plain text instead of a navigable link.
 */
export function sourceTypeToSessionType(source: SourceType): SessionType | null {
  switch (source) {
    case "claude_session_todo":
      return "claude";
    case "codex_session_todo":
      return "codex";
    case "antigravity_session_todo":
      return "antigravity";
    case "cursor_session_todo":
      // Cursor sessions don't have a live SSE viewer (no JSONL on disk in the
      // same way), so the detail page would 400. Skip the link to avoid a
      // dead end.
      return null;
    default:
      return null;
  }
}

/**
 * Strip the namespacing prefix (`tc-` / `tw-`) the claude-session adapter
 * occasionally adds to id values to avoid UNIQUE collisions. Mirror of the
 * server-side `stripSessionIdPrefix` helper — duplicated here because the
 * frontend has no shared import path with `src/lib/session-helpers.ts`.
 */
export function stripSessionIdPrefix(id: string): string {
  if (id.startsWith("tc-") || id.startsWith("tw-")) return id.slice(3);
  return id;
}

/** Session-viewer href for a task, or null when it has no viewable session. */
export function sessionHrefForTask(task: Task | null): string | null {
  if (!task?.session_id) return null;
  const sessionType = sourceTypeToSessionType(task.source_type);
  if (!sessionType) return null;
  const cleanId = stripSessionIdPrefix(task.session_id);
  return `/sessions/detail?type=${sessionType}&id=${encodeURIComponent(cleanId)}`;
}
