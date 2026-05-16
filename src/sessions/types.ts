// Cross-CLI session shape used by the session browser. The list endpoint
// is DB-backed (Phase C); single-session detail + live tail (SSE) remain
// filesystem-backed via the per-source readers in this directory.

// Re-export the canonical `SessionType` from `src/types.ts` so the DB
// layer and the live-fs readers agree on the enum domain. The fs-side
// readers in this directory currently handle three of the four members
// (claude / codex / gemini); cursor sessions exist only as DB rows and
// are filtered out by the API layer before reaching the fs readers.
import type { SessionType } from "../types.js";
export type { SessionType };

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
}
