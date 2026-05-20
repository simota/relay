"use client";

import { useEffect, useState } from "react";
import { SSE_BASE, type SessionSummary } from "@/lib/api";

export type FleetStreamStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "error"
  | "idle";

export interface FleetStreamState {
  sessions: SessionSummary[] | null;
  status: FleetStreamStatus;
  error: string | null;
}

interface Options {
  lookbackDays?: number;
  limit?: number;
  includeSubagents?: boolean;
}

// Subscribe to the fleet-wide SSE stream and keep a running snapshot of
// session summaries. Falls back to polling when EventSource is unavailable
// (jsdom, certain mobile shells) so tests and exotic clients still update.
export function useFleetStream(opts: Options = {}): FleetStreamState {
  const { lookbackDays = 7, limit = 200, includeSubagents = true } = opts;
  const [state, setState] = useState<FleetStreamState>({
    sessions: null,
    status: "idle",
    error: null,
  });

  useEffect(() => {
    setState({ sessions: null, status: "connecting", error: null });

    const q = new URLSearchParams();
    if (includeSubagents) q.set("include", "subagents");
    q.set("lookback_days", String(lookbackDays));
    q.set("limit", String(limit));
    const url = `${SSE_BASE}/api/sessions/stream?${q.toString()}`;

    if (typeof EventSource === "undefined") {
      let cancelled = false;
      let failures = 0;
      const tick = async () => {
        try {
          const res = await fetch(
            `${SSE_BASE}/api/sessions?${q.toString()}`,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const list = (await res.json()) as SessionSummary[];
          if (!cancelled) {
            setState({ sessions: list, status: "live", error: null });
            failures = 0;
          }
        } catch (e) {
          if (cancelled) return;
          failures += 1;
          setState((s) => ({
            ...s,
            status: failures > 3 ? "error" : "reconnecting",
            error: failures > 3 ? String(e) : null,
          }));
        }
      };
      void tick();
      const iv = setInterval(tick, 5000);
      return () => {
        cancelled = true;
        clearInterval(iv);
      };
    }

    const es = new EventSource(url);
    let failures = 0;

    const onPayload = (evt: MessageEvent<string>) => {
      try {
        const list = JSON.parse(evt.data) as SessionSummary[];
        setState({ sessions: list, status: "live", error: null });
        failures = 0;
      } catch {
        // Skip malformed frames — heartbeat path stays valid.
      }
    };

    es.addEventListener("snapshot", onPayload);
    es.addEventListener("update", onPayload);
    es.addEventListener("error", () => {
      failures += 1;
      setState((s) => ({
        ...s,
        status: failures > 3 ? "error" : "reconnecting",
        error: failures > 3 ? "fleet stream lost" : null,
      }));
    });

    return () => {
      es.close();
    };
  }, [lookbackDays, limit, includeSubagents]);

  return state;
}
