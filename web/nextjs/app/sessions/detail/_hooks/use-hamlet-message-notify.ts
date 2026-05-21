"use client";

// Fleet Hamlet — New-message chime hook.
//
// Watches the active house-bubble map produced by `pickHousesWithBubbles`
// and fires a short bell chime whenever a previously-unseen `(houseKey,
// timestamp)` pair appears. The initial render is treated as the baseline
// so pre-existing messages from before the user opened the page never
// trigger sound. Mute state is persisted to localStorage so the choice
// sticks across reloads.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LastMessage } from "../_lib/fleet-hamlet-last-message";
import {
  playMessageChime,
  primeOnGesture,
} from "../_lib/fleet-hamlet-notify";

const STORAGE_KEY = "relay.hamlet.notify.muted";
// Floor between consecutive chimes — protects against burst arrivals (e.g.
// an assistant streaming several quick messages) stacking on top of each
// other into a single noisy blur.
const MIN_INTERVAL_MS = 700;

function loadMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore — private mode / quota */
  }
}

export interface HamletMessageNotify {
  muted: boolean;
  toggleMute: () => void;
}

export function useHamletMessageNotify(
  bubbles: ReadonlyMap<string, LastMessage>,
): HamletMessageNotify {
  const [muted, setMuted] = useState<boolean>(false);
  // `null` sentinel = haven't seen any render yet → skip first chime burst.
  const prevIdsRef = useRef<Set<string> | null>(null);
  const lastPlayRef = useRef<number>(0);
  const mutedRef = useRef<boolean>(false);

  // Hydrate mute state from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    const initial = loadMuted();
    setMuted(initial);
    mutedRef.current = initial;
  }, []);

  // Keep ref in sync so the bubble-diff effect can read the latest value
  // without re-subscribing every time `muted` flips.
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Resume the AudioContext on first user gesture so the chime can play.
  useEffect(() => primeOnGesture(), []);

  // Diff bubble identities and chime on additions.
  useEffect(() => {
    const ids = new Set<string>();
    for (const [key, msg] of bubbles) {
      ids.add(`${key}::${msg.timestamp}`);
    }
    const prev = prevIdsRef.current;
    prevIdsRef.current = ids;
    if (prev === null) return; // baseline render
    if (mutedRef.current) return;
    let hasNew = false;
    for (const id of ids) {
      if (!prev.has(id)) {
        hasNew = true;
        break;
      }
    }
    if (!hasNew) return;
    const now = Date.now();
    if (now - lastPlayRef.current < MIN_INTERVAL_MS) return;
    lastPlayRef.current = now;
    playMessageChime();
  }, [bubbles]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      saveMuted(next);
      mutedRef.current = next;
      return next;
    });
  }, []);

  return { muted, toggleMute };
}
