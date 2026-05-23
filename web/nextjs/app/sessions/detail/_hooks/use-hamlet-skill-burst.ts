"use client";

// Fleet Hamlet — skill activation bursts.
//
// Diff `detail.skills` snapshots per session and surface transient
// `SkillBurstEvent` records the SimCard renderer overlays as a sparkly
// badge. Burst events auto-expire after `BURST_TTL_MS` so the animation
// only plays once per activation. Initial mount is treated as the
// baseline so existing skills don't all flash at once on page load.
//
// Trigger contract: a (sessionKey, name, source) tuple is considered an
// activation when its `last_ts` is newer than the previously-observed
// `last_ts` for the same tuple. New tuples (never seen before for the
// session) also count.

import { useEffect, useRef, useState } from "react";
import type { SessionDetail, SessionSkillSource, SessionSkillUse } from "@/lib/api";

const BURST_TTL_MS = 3_800;
const TUPLE_SEP = "|";

export interface SkillBurstEvent {
  /** Stable id used as React key; suffix incrementer survives same-ts dupes. */
  id: string;
  /** Skill name (e.g. "nexus"). */
  name: string;
  /** How the skill was invoked. */
  source: SessionSkillSource;
  /** Wall-clock ms when this burst was emitted (used to auto-expire). */
  emittedAt: number;
}

/**
 * For each `sessionKey -> SessionDetail` pair, return the currently-live
 * burst events keyed by sessionKey. Map values are sorted by emission
 * time descending (newest first) so the renderer stacks the freshest
 * activation at the top.
 */
export function useHamletSkillBursts(
  details: ReadonlyMap<string, SessionDetail>,
): Map<string, SkillBurstEvent[]> {
  const [bursts, setBursts] = useState<Map<string, SkillBurstEvent[]>>(
    () => new Map(),
  );
  // Per-session prev signature: name|source -> last_ts. Absent entry on
  // first observation skips the initial-mount flood.
  const prevRef = useRef<Map<string, Map<string, string>>>(new Map());
  // Monotonic counter so two activations at the exact same ts get distinct
  // React keys (animation re-mounts cleanly).
  const seqRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const additions: Array<{ key: string; ev: SkillBurstEvent }> = [];

    for (const [key, detail] of details) {
      const sig = signature(detail.skills);
      const prev = prevRef.current.get(key);
      prevRef.current.set(key, sig);
      if (!prev) continue; // first-render baseline
      for (const [tupleKey, ts] of sig) {
        const prevTs = prev.get(tupleKey);
        if (prevTs && prevTs >= ts) continue; // unchanged or older
        const sep = tupleKey.indexOf(TUPLE_SEP);
        if (sep <= 0) continue;
        const name = tupleKey.slice(0, sep);
        const source = tupleKey.slice(sep + 1) as SessionSkillSource;
        seqRef.current += 1;
        additions.push({
          key,
          ev: {
            id: `${key}|${tupleKey}|${ts}|${seqRef.current}`,
            name,
            source,
            emittedAt: now,
          },
        });
      }
    }

    if (additions.length === 0) {
      // Garbage-collect expired bursts even when no new ones arrived so
      // the overlay clears in real time without a fresh detail tick.
      setBursts((prev) => pruneExpired(prev, now));
      return;
    }

    setBursts((prev) => {
      const next = pruneExpired(prev, now);
      for (const add of additions) {
        const existing = next.get(add.key) ?? [];
        next.set(add.key, [add.ev, ...existing]);
      }
      return next;
    });
  }, [details]);

  // Periodic prune so bursts disappear without waiting for the next
  // detail update. 600ms is fine-grained enough that the fade-out feels
  // tight on screen.
  useEffect(() => {
    const handle = window.setInterval(() => {
      setBursts((prev) => pruneExpired(prev, Date.now()));
    }, 600);
    return () => window.clearInterval(handle);
  }, []);

  return bursts;
}

function signature(skills: readonly SessionSkillUse[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of skills) {
    m.set(`${s.name}${TUPLE_SEP}${s.source}`, s.last_ts);
  }
  return m;
}

function pruneExpired(
  current: Map<string, SkillBurstEvent[]>,
  now: number,
): Map<string, SkillBurstEvent[]> {
  let changed = false;
  const next = new Map<string, SkillBurstEvent[]>();
  for (const [key, list] of current) {
    const filtered = list.filter((ev) => now - ev.emittedAt < BURST_TTL_MS);
    if (filtered.length !== list.length) changed = true;
    if (filtered.length > 0) next.set(key, filtered);
    else if (list.length > 0) changed = true;
  }
  return changed ? next : current;
}
