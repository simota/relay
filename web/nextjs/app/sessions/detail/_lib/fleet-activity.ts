import type { SessionDetail, SessionStatus, SessionSummary } from "@/lib/api";

export type FleetEventKind =
  | "user"
  | "assistant"
  | "tool"
  | "system"
  | "message"
  | "waiting"
  | "ended"
  | "spawn"
  | "interrupted";

export interface FleetEvent {
  ts: number;
  sessionType: SessionSummary["type"];
  sessionId: string;
  repo: string | null;
  status: SessionStatus | undefined;
  parentSessionId?: string;
  agentId?: string;
  /** Short, human-readable summary line. */
  summary: string;
  /** kind drives the row icon and color accent. */
  kind: FleetEventKind;
}

// Derive a synthetic event stream from the lightweight /api/sessions
// snapshot. We don't have per-message timestamps here, so each session
// contributes one event at `last_active` describing its latest known
// state. Spawn relationships add an extra event under the parent's
// started_at so subagent appearance is visible in the feed.
export function buildActivityEvents(
  sessions: readonly SessionSummary[],
): FleetEvent[] {
  const events: FleetEvent[] = [];

  for (const s of sessions) {
    const ts = Date.parse(s.last_active);
    if (!Number.isFinite(ts)) continue;

    const kind = kindFor(s.status);
    events.push({
      ts,
      sessionType: s.type,
      sessionId: s.id,
      repo: s.repo,
      status: s.status,
      parentSessionId: s.parent_session_id,
      agentId: s.agent_id,
      kind,
      summary: summaryFor(s, kind),
    });

    if (s.parent_session_id && s.agent_id) {
      const spawnTs = Date.parse(s.started_at);
      if (Number.isFinite(spawnTs)) {
        events.push({
          ts: spawnTs,
          sessionType: s.type,
          sessionId: s.id,
          repo: s.repo,
          status: s.status,
          parentSessionId: s.parent_session_id,
          agentId: s.agent_id,
          kind: "spawn",
          summary: `subagent spawned: ${s.agent_id}`,
        });
      }
    }
  }

  events.sort((a, b) => b.ts - a.ts);
  return events;
}

function kindFor(status: SessionStatus | undefined): FleetEvent["kind"] {
  switch (status) {
    case "waiting_for_user":
      return "waiting";
    case "ended":
      return "ended";
    case "interrupted":
      return "interrupted";
    default:
      return "message";
  }
}

function summaryFor(s: SessionSummary, kind: FleetEvent["kind"]): string {
  if (s.last_message && s.last_message.trim().length > 0) return s.last_message;
  switch (kind) {
    case "waiting":
      return "waiting for user input";
    case "ended":
      return "session ended";
    case "interrupted":
      return "session interrupted";
    case "spawn":
      return "subagent spawn";
    default:
      return s.title || "(no prompt)";
  }
}

const PREVIEW_MAX = 240;

// Build the per-message activity feed. When detail is available for a
// session we emit one event per message (user / assistant / tool / system)
// plus one per tool_call so the history reads chronologically. When detail
// has not arrived yet we fall back to the lightweight one-event-per-session
// shape so the feed never blanks during a refetch.
export function buildDetailEvents(
  sessions: readonly SessionSummary[],
  detailByKey: ReadonlyMap<string, SessionDetail>,
): FleetEvent[] {
  const events: FleetEvent[] = [];

  for (const s of sessions) {
    const key = `${s.type}:${s.id}`;
    const detail = detailByKey.get(key);

    if (!detail) {
      const ts = Date.parse(s.last_active);
      if (!Number.isFinite(ts)) continue;
      const kind = kindFor(s.status);
      events.push({
        ts,
        sessionType: s.type,
        sessionId: s.id,
        repo: s.repo,
        status: s.status,
        parentSessionId: s.parent_session_id,
        agentId: s.agent_id,
        kind,
        summary: summaryFor(s, kind),
      });
      continue;
    }

    for (const m of detail.messages) {
      const ts = Date.parse(m.timestamp);
      if (!Number.isFinite(ts)) continue;
      events.push({
        ts,
        sessionType: s.type,
        sessionId: s.id,
        repo: s.repo,
        status: s.status,
        parentSessionId: s.parent_session_id,
        agentId: s.agent_id,
        kind: messageRoleToKind(m.role),
        summary: truncate(firstNonEmptyLine(m.text), PREVIEW_MAX),
      });
    }

    for (const tc of detail.tool_calls) {
      const ts = Date.parse(tc.timestamp);
      if (!Number.isFinite(ts)) continue;
      const argsSummary = tc.args_summary.trim();
      events.push({
        ts,
        sessionType: s.type,
        sessionId: s.id,
        repo: s.repo,
        status: s.status,
        parentSessionId: s.parent_session_id,
        agentId: s.agent_id,
        kind: "tool",
        summary: argsSummary.length > 0 ? `${tc.name} · ${argsSummary}` : tc.name,
      });
    }

    if (s.parent_session_id && s.agent_id) {
      const spawnTs = Date.parse(s.started_at);
      if (Number.isFinite(spawnTs)) {
        events.push({
          ts: spawnTs,
          sessionType: s.type,
          sessionId: s.id,
          repo: s.repo,
          status: s.status,
          parentSessionId: s.parent_session_id,
          agentId: s.agent_id,
          kind: "spawn",
          summary: `subagent spawned: ${s.agent_id}`,
        });
      }
    }
  }

  events.sort((a, b) => b.ts - a.ts);
  return events;
}

function messageRoleToKind(role: string): FleetEventKind {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "tool":
      return "tool";
    case "system":
      return "system";
    default:
      return "message";
  }
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
