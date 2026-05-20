import type { SessionStatus, SessionSummary } from "@/lib/api";

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
  kind: "message" | "waiting" | "ended" | "spawn" | "interrupted";
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
