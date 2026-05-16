import { getClaudePath, getClaudeSession } from "./claude.js";
import { getCodexPath, getCodexSession } from "./codex.js";
import { getGeminiPath, getGeminiSession } from "./gemini.js";
import type { SessionDetail, SessionType } from "./types.js";

/**
 * Resolve a single session's detail by (type, id). Live filesystem read —
 * keeps the JSONL parsing path so the SSE live-tail and the detail page
 * stay byte-for-byte identical with the pre-F-1 implementation.
 *
 * Returns null for `cursor` sessions because no plan-file reader exists
 * yet (cursor entries surface only in the DB-backed list).
 */
export async function getSession(
  type: SessionType,
  id: string,
  roots: string[],
): Promise<SessionDetail | null> {
  switch (type) {
    case "claude":
      return getClaudeSession(id, roots);
    case "codex":
      return getCodexSession(id, roots);
    case "gemini":
      return getGeminiSession(id, roots);
    case "cursor":
      return null;
  }
}

/**
 * Resolve the on-disk source path for a session so the SSE live-tail can
 * `fs.watch()` it. Returns null when the type lacks an fs reader (cursor)
 * or the session is unknown.
 */
export async function getSessionPath(
  type: SessionType,
  id: string,
): Promise<string | null> {
  switch (type) {
    case "claude":
      return getClaudePath(id);
    case "codex":
      return getCodexPath(id);
    case "gemini":
      return getGeminiPath(id);
    case "cursor":
      return null;
  }
}

export type { SessionDetail, SessionSummary, SessionType } from "./types.js";
