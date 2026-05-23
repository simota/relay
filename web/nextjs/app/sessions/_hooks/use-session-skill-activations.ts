"use client";

// Board (sessions list) — skill activation detector.
//
// Polls the session list, diffs each row's `skills_used` between snapshots,
// and exposes a `Map<sessionKey, ActivationEvent[]>` the row renderer
// overlays as a transient "toast band" highlight. Each event auto-expires
// after `TTL_MS` so the row settles back to its normal styling shortly
// after the activation lands.
//
// Initial render is treated as the baseline so existing skills don't all
// flash at once on page load.

import { useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@/lib/api";

const TTL_MS = 4_000;
const PRUNE_INTERVAL_MS = 600;

export interface SkillActivationEvent {
  id: string;
  name: string;
  emittedAt: number;
}

function sessionKey(s: { type: string; id: string }): string {
  return `${s.type}:${s.id}`;
}

export function useSessionSkillActivations(
  sessions: readonly SessionSummary[],
): Map<string, SkillActivationEvent[]> {
  const [active, setActive] = useState<Map<string, SkillActivationEvent[]>>(
    () => new Map(),
  );
  // sessionKey -> Set<skill name> seen in the previous snapshot. Absent
  // entry on first observation skips the baseline flood.
  const prevRef = useRef<Map<string, Set<string>>>(new Map());
  const seqRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const additions: Array<{ key: string; ev: SkillActivationEvent }> = [];

    for (const s of sessions) {
      const key = sessionKey(s);
      const cur = new Set(s.skills_used ?? []);
      const prev = prevRef.current.get(key);
      prevRef.current.set(key, cur);
      if (!prev) continue;
      for (const name of cur) {
        if (prev.has(name)) continue;
        seqRef.current += 1;
        additions.push({
          key,
          ev: {
            id: `${key}|${name}|${now}|${seqRef.current}`,
            name,
            emittedAt: now,
          },
        });
      }
    }

    if (additions.length === 0) {
      setActive((prev) => pruneExpired(prev, now));
      return;
    }

    setActive((prev) => {
      const next = pruneExpired(prev, now);
      for (const add of additions) {
        const existing = next.get(add.key) ?? [];
        next.set(add.key, [add.ev, ...existing]);
      }
      return next;
    });
  }, [sessions]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      setActive((prev) => pruneExpired(prev, Date.now()));
    }, PRUNE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, []);

  return active;
}

function pruneExpired(
  current: Map<string, SkillActivationEvent[]>,
  now: number,
): Map<string, SkillActivationEvent[]> {
  let changed = false;
  const next = new Map<string, SkillActivationEvent[]>();
  for (const [key, list] of current) {
    const filtered = list.filter((ev) => now - ev.emittedAt < TTL_MS);
    if (filtered.length !== list.length) changed = true;
    if (filtered.length > 0) next.set(key, filtered);
    else if (list.length > 0) changed = true;
  }
  return changed ? next : current;
}
