// Cross-CLI session shape used by the session browser. The list endpoint
// is DB-backed (Phase C); single-session detail + live tail (SSE) remain
// filesystem-backed via the per-source readers in this directory.

// Re-export the canonical `SessionType` from `src/types.ts` so the DB
// layer and the live-fs readers agree on the enum domain. The fs-side
// readers in this directory currently handle three of the four members
// (claude / codex / antigravity); cursor sessions exist only as DB rows
// and are filtered out by the API layer before reaching the fs readers.
import type { SessionStatus, SessionType } from "../types.js";
export type { SessionStatus, SessionType };

export interface SessionSummary {
  type: SessionType;
  id: string;
  repo: string | null;
  cwd: string | null;
  title: string;
  started_at: string;
  last_active: string;
  message_count: number;
  todos_count: number;
  /** Set when this session is a subagent; contains the parent session UUID. */
  parent_session_id?: string;
  /** Set when this session is a subagent; e.g. "agent-a920f50". */
  agent_id?: string;
  /** Number of subagent sessions under this parent. Omitted when 0. */
  subagent_count?: number;
  /**
   * Lifecycle state observed by the detector. The list endpoint sources this
   * from the `sessions` table (refreshed on sync). The detail endpoint /
   * SSE stream re-computes it on every file change, so live sessions update
   * the indicator without waiting for the next sync. Omitted for sources
   * whose adapter has not implemented detection yet (codex/antigravity/cursor).
   */
  status?: SessionStatus;
  /**
   * Distinct skill names invoked in this session — ordered by descending
   * call count, capped at 20. Used by the list view for skill chips.
   * Omitted when no skill activity was detected.
   */
  skills_used?: string[];
}

export type SessionSkillSource =
  | "skill_tool"      // assistant invoked Skill(skill=...) (Claude only)
  | "slash_command"   // user typed /<name> (Claude command-name tag, Antigravity SKILL meta)
  | "subagent"        // spawned via Agent/spawn_agent with a skills/<name>/SKILL.md prompt
  | "session_meta";   // session_meta.source.subagent — whole session is this skill (Codex)

export interface SessionSkillUse {
  /** Skill name (e.g. "nexus", "guardian", "review"). Lowercased. */
  name: string;
  /** How this skill was invoked. */
  source: SessionSkillSource;
  /** ISO timestamp of the first invocation via this source. */
  first_ts: string;
  /** ISO timestamp of the most recent invocation via this source. */
  last_ts: string;
  /** Number of invocations of this skill via this source. */
  count: number;
  /** Latest args/prompt-snippet, truncated to ≤200 chars. Null when unavailable. */
  last_args: string | null;
  /**
   * Latest "recipe" hint — the first token of the args passed to the
   * Skill tool (e.g. `Skill(skill="nexus", args="apex …")` → "apex").
   * Used by the UI to render `nexus(apex)` style chips. Null when args
   * are empty or not a clean leading token.
   */
  recipe: string | null;
  /**
   * Latest observed status. "failed" when the most recent invocation
   * carried back a tool_result with `is_error: true` (Skill tool only).
   * "success" when the most recent paired result was non-error. Null
   * for sources without a tool_use_id (slash_command / session_meta /
   * subagent) or when no result has been observed yet.
   */
  last_status: "success" | "failed" | null;
  /**
   * True iff this aggregate entry corresponds to the very first
   * appearance of this skill *name* (across all sources) in the
   * session. Used by the UI to play a louder fanfare on the first use
   * of a skill the session has never touched before.
   */
  is_first_use_in_session: boolean;
}

export interface SessionMessage {
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
}

export interface SessionTodo {
  id: string;
  title: string;
  status: string;
}

export interface SessionToolCall {
  timestamp: string;
  name: string;
  args_summary: string;
  /**
   * Raw arguments JSON string when the CLI exposes one (codex function_call,
   * Claude tool_use input). The frontend parses this to surface workdir /
   * command / file path per tool family. Capped at 4 KB to keep responses
   * reasonable. Null when the CLI doesn't expose structured args.
   */
  args_json: string | null;
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
  todos: SessionTodo[];
  tool_calls: SessionToolCall[];
  /** Aggregated skill invocations observed in this session. Empty when none. */
  skills: SessionSkillUse[];
  /**
   * Parent → child skill relationships observed in this session. A `parent`
   * is a Skill (or top-level slash invocation) that, while in its
   * conversational scope, spawned an Agent / Task / spawn_agent whose
   * prompt identifies the spawned `child` skill. Order is chronological.
   * Empty when no such chain was observed.
   */
  skill_chains: SessionSkillChainEdge[];
}

export interface SessionSkillChainEdge {
  /** Parent skill name (the one in scope when the spawn happened). */
  parent: string;
  /** Child skill name spawned via Agent / Task / spawn_agent. */
  child: string;
  /** ISO timestamp of the child spawn event. */
  ts: string;
}
