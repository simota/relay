"use client";

import { useEffect, useRef, useState } from "react";
import { api, type SessionDetail, type SessionSummary } from "@/lib/api";
import { sessionKey } from "../_lib/fleet-timeline";

// Fetch detail JSON for a set of sessions in parallel and re-fetch any
// session whose `last_active` has advanced since we last fetched it.
// Designed to be called from views that render messages or tool_calls
// across multiple sessions at once (Feed, Pulse). The cache key is
// `${type}:${id}` so a session never collides across CLI types, and the
// version key is `last_active` so re-renders without changed metadata
// don't trigger refetches.
export function useSessionDetails(
  sessions: readonly SessionSummary[],
): Map<string, SessionDetail> {
  const [details, setDetails] = useState<Map<string, SessionDetail>>(
    () => new Map(),
  );
  const versionRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (sessions.length === 0) return;
    let cancelled = false;
    const stale = sessions.filter(
      (s) => versionRef.current.get(sessionKey(s)) !== s.last_active,
    );
    if (stale.length === 0) return;
    void Promise.all(
      stale.map(async (s) => {
        try {
          const d = await api.session(s.type, s.id);
          return { key: sessionKey(s), detail: d, version: s.last_active };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setDetails((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r) {
            next.set(r.key, r.detail);
            versionRef.current.set(r.key, r.version);
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [sessions]);

  return details;
}
