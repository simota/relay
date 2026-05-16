"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SessionDetail, type SessionType } from "@/lib/api";
import { messageKey } from "../_lib/format";
import type { StreamState } from "../_types";

// How long a freshly-arrived message keeps the highlight before it fades back
// into the regular list. Long enough to catch a glance but short enough that
// re-scrolling a session doesn't keep flashing old rows.
const FRESH_COOLDOWN_MS = 6000;

const EMPTY_FRESH: ReadonlySet<string> = new Set();

// ---------------------------------------------------------------------------
// useSessionStream — subscribes to a single session SSE endpoint and tracks
// which message keys arrived in the most recent diff so the UI can highlight
// them.
// ---------------------------------------------------------------------------
export function useSessionStream(type: SessionType | null, id: string | null): StreamState {
  const [state, setState] = useState<StreamState>({
    data: null,
    status: "idle",
    error: null,
    freshMessageKeys: EMPTY_FRESH,
  });
  const failuresRef = useRef(0);
  const seenKeysRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((key: string) => {
    const t = timersRef.current.get(key);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(key);
    }
  }, []);

  const expireFresh = useCallback((key: string) => {
    setState((prev) => {
      if (!prev.freshMessageKeys.has(key)) return prev;
      const next = new Set(prev.freshMessageKeys);
      next.delete(key);
      return { ...prev, freshMessageKeys: next };
    });
    timersRef.current.delete(key);
  }, []);

  const applySnapshot = useCallback(
    (data: SessionDetail) => {
      const currentKeys = new Set(data.messages.map(messageKey));
      const seen = seenKeysRef.current;
      const added: string[] = [];
      if (seen) {
        for (const k of currentKeys) {
          if (!seen.has(k)) added.push(k);
        }
      }
      // The first snapshot establishes the baseline; we never highlight it.
      seenKeysRef.current = currentKeys;

      if (added.length === 0) {
        setState((prev) => ({
          data,
          status: "live",
          error: null,
          freshMessageKeys: prev.freshMessageKeys,
        }));
        return;
      }

      for (const k of added) {
        clearTimer(k);
        const t = setTimeout(() => expireFresh(k), FRESH_COOLDOWN_MS);
        timersRef.current.set(k, t);
      }

      setState((prev) => {
        const fresh = new Set(prev.freshMessageKeys);
        for (const k of added) fresh.add(k);
        return { data, status: "live", error: null, freshMessageKeys: fresh };
      });
    },
    [clearTimer, expireFresh],
  );

  useEffect(() => {
    if (!type || !id) return;
    setState({ data: null, status: "connecting", error: null, freshMessageKeys: EMPTY_FRESH });
    failuresRef.current = 0;
    seenKeysRef.current = null;
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();

    const cleanupTimers = () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    };

    if (typeof EventSource === "undefined") {
      let cancelled = false;
      const tick = async () => {
        try {
          const data = await api.session(type, id);
          if (!cancelled) applySnapshot(data);
        } catch (e) {
          if (!cancelled) {
            setState((s) => ({ ...s, status: "error", error: String(e) }));
          }
        }
      };
      void tick();
      const iv = setInterval(tick, 15_000);
      return () => {
        cancelled = true;
        clearInterval(iv);
        cleanupTimers();
      };
    }

    const es = new EventSource(`/api/sessions/${type}/${encodeURIComponent(id)}/stream`);

    const handleSnapshot = (evt: MessageEvent<string>) => {
      try {
        const data = JSON.parse(evt.data) as SessionDetail;
        applySnapshot(data);
        failuresRef.current = 0;
      } catch {
        // Ignore malformed frames.
      }
    };

    es.addEventListener("snapshot", handleSnapshot);
    es.addEventListener("update", handleSnapshot);
    es.addEventListener("error", () => {
      failuresRef.current += 1;
      setState((s) => ({
        ...s,
        status: failuresRef.current > 3 ? "error" : "reconnecting",
        error: failuresRef.current > 3 ? "stream lost" : null,
      }));
    });

    return () => {
      es.close();
      cleanupTimers();
    };
  }, [type, id, applySnapshot]);

  return state;
}
