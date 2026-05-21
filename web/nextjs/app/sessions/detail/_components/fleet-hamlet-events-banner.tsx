"use client";

// Fleet Hamlet — Events Banner (P5).
//
// Top-of-tab rotating ticker that surfaces recent critical/celebrate events
// across the whole fleet. Hidden when there's nothing fresh or when the
// user toggles Quiet (LocalStorage persisted).

import { Bell, BellOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import {
  type LifeEvent,
  severityColor,
  severityWeight,
} from "../_lib/fleet-hamlet-events";
import { ConfettiBurst } from "./fleet-hamlet-decor";
import { EventBurst, PARTICLE_CSS } from "./fleet-hamlet-particles";

const FRESH_WINDOW_MS = 30_000;
const MAX_VISIBLE = 3;
const ROTATE_MS = 5_000;
const QUIET_STORAGE_KEY = "relay.sessions.detail.hamletEventsQuiet";

interface Props {
  events: readonly LifeEvent[];
  cards: readonly SimCardModel[];
  now: number;
  onEnterHouse: (sim: SimCardModel) => void;
}

export function FleetHamletEventsBanner({
  events,
  cards,
  now,
  onEnterHouse,
}: Props) {
  const [quiet, setQuiet] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [tick, setTick] = useState(0);

  // Hydrate Quiet pref from LocalStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(QUIET_STORAGE_KEY);
      setQuiet(v === "1");
    } catch {
      // ignore
    }
  }, []);

  const persistQuiet = (next: boolean) => {
    setQuiet(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(QUIET_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore — Safari private mode etc.
    }
  };

  // Filter events to the "fresh celebrate/critical/warn" subset.
  const visible = useMemo<LifeEvent[]>(() => {
    if (events.length === 0) return [];
    const out: LifeEvent[] = [];
    for (const ev of events) {
      if (now - ev.timestamp > FRESH_WINDOW_MS) continue;
      if (ev.severity === "info") continue;
      out.push(ev);
    }
    out.sort((a, b) => {
      const w = severityWeight(b.severity) - severityWeight(a.severity);
      if (w !== 0) return w;
      return b.timestamp - a.timestamp;
    });
    return out.slice(0, MAX_VISIBLE);
  }, [events, now]);

  // Rotate index every ROTATE_MS as long as we have ≥2 visible events.
  useEffect(() => {
    if (visible.length <= 1) {
      setTick(0);
      return;
    }
    const id = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [visible.length]);

  // Reset dismissal when the visible set changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDismissed(false), [visible.map((v) => v.sessionId + v.kind).join("|")]);

  if (quiet) {
    return (
      <div className="flex items-center justify-end px-4 py-1 border-b border-[var(--color-border)] text-[10px] font-mono bg-[var(--color-bg)]">
        <button
          type="button"
          onClick={() => persistQuiet(false)}
          className="inline-flex items-center gap-1 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          title="Re-enable Hamlet event banner"
        >
          <BellOff className="w-3 h-3" aria-hidden /> Quiet
        </button>
      </div>
    );
  }

  if (visible.length === 0 || dismissed) {
    return null;
  }

  const active = visible[tick % visible.length] ?? visible[0];
  if (!active) return null;
  const color = severityColor(active.severity);
  const card = cards.find((c) => c.sessionId === active.sessionId);

  const isCelebrate = active.severity === "celebrate";
  return (
    <div
      className="relative flex items-center gap-2 px-4 py-1.5 border-b text-[11px] font-mono overflow-hidden"
      style={{
        borderColor: color,
        background: `linear-gradient(90deg, ${withAlpha(color, 0.18)}, transparent 70%)`,
      }}
      aria-live="polite"
    >
      <style>{PARTICLE_CSS}</style>
      {/* Banner-level particle accents — confetti for celebrations,
          themed bursts for fire/reaper/achievement/quest. */}
      {isCelebrate ? <ConfettiBurst /> : <EventBurst kind={active.kind} />}
      <span aria-hidden className="text-[14px] leading-none">
        {active.icon}
      </span>
      <span className="uppercase tracking-wider" style={{ color }}>
        {active.label}
      </span>
      <button
        type="button"
        disabled={!card}
        onClick={() => card && onEnterHouse(card)}
        className={cn(
          "flex-1 min-w-0 text-left truncate",
          card
            ? "text-[var(--color-fg)] hover:text-[var(--color-accent)]"
            : "text-[var(--color-fg-muted)] cursor-default",
        )}
        title={card ? "Open this house" : "Source resident not in fleet"}
      >
        {active.message}
      </button>
      {visible.length > 1 && (
        <span className="text-[var(--color-fg-dim)] shrink-0">
          {(tick % visible.length) + 1}/{visible.length}
        </span>
      )}
      <button
        type="button"
        onClick={() => persistQuiet(true)}
        className="inline-flex items-center gap-1 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] shrink-0"
        title="Mute Hamlet event banner"
      >
        <Bell className="w-3 h-3" aria-hidden /> Quiet
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="inline-flex items-center text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] shrink-0"
        aria-label="dismiss"
      >
        <X className="w-3 h-3" aria-hidden />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withAlpha(hsl: string, alpha: number): string {
  // Cheap conversion from "hsl(h, s%, l%)" → "hsla(h, s%, l%, a)".
  const m = hsl.match(/hsl\(([^)]+)\)/);
  if (!m) return hsl;
  return `hsla(${m[1]}, ${alpha})`;
}
