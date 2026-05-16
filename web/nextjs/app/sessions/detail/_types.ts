import type { SessionDetail, SessionMessage, SessionType } from "@/lib/api";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "error" | "idle";

export interface StreamState {
  data: SessionDetail | null;
  status: StreamStatus;
  error: string | null;
  /**
   * Message keys (see _lib/format.messageKey) that arrived in the most recent
   * snapshot diff. The hook clears each key after a short cooldown so the UI
   * can decorate "just added" rows without the marker becoming stale.
   */
  freshMessageKeys: ReadonlySet<string>;
}

export interface TileSpec {
  type: SessionType;
  id: string;
}

export type RoleFilter = "all" | SessionMessage["role"];
