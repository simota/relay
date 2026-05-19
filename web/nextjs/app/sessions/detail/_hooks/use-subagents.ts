"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SessionSummary, type SessionType } from "@/lib/api";

// Minimum gap between refetches; SSE updates `lastActive` on every JSONL
// change so without this guard we'd hammer /api/sessions every snapshot.
const MIN_REFETCH_MS = 15_000;

export interface SubagentsState {
  children: SessionSummary[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetch the list of subagent sessions for a parent session.
 *
 * Disabled paths (`hasChildren === false`, missing parent id) intentionally
 * never hit the network — the parent component renders the tab only when
 * `subagent_count > 0`, so any fetch here would be wasted bandwidth.
 *
 * `lastActive` is part of the effect deps so a streaming parent picks up
 * newly-spawned subagents, but the MIN_REFETCH_MS gate keeps the call rate
 * sane (a session can stream tens of updates per minute).
 */
export function useSubagents(
  type: SessionType,
  parentId: string,
  hasChildren: boolean,
  lastActive?: string,
): SubagentsState {
  const [children, setChildren] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(false);

  const doFetch = useCallback(
    async (force: boolean) => {
      if (!hasChildren || !parentId) return;
      if (inFlightRef.current) return;
      const now = Date.now();
      if (!force && now - lastFetchRef.current < MIN_REFETCH_MS) return;
      inFlightRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const rows = await api.sessions({
          type,
          parent: parentId,
          includeSubagents: true,
        });
        setChildren(rows);
        lastFetchRef.current = Date.now();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [type, parentId, hasChildren],
  );

  useEffect(() => {
    if (!hasChildren) {
      setChildren([]);
      lastFetchRef.current = 0;
      return;
    }
    void doFetch(false);
    // lastActive intentionally drives refetches; the rate is gated above.
  }, [doFetch, hasChildren, lastActive]);

  const reload = useCallback(() => {
    void doFetch(true);
  }, [doFetch]);

  return { children, loading, error, reload };
}
