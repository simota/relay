"use client";

// Fleet Hamlet — Lifetime Timeline (P5).
//
// Horizontal birth→now strip with emoji pins for each LifeEvent. Sits in
// the House Plan footer; below it the most recent 5 events repeat as a
// collapsible list.

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type LifeEvent,
  severityColor,
} from "../_lib/fleet-hamlet-events";

interface Props {
  bornAt: number;
  now: number;
  events: readonly LifeEvent[];
}

const PIN_SIZE = 22; // px — emoji bubble width
const TRACK_HEIGHT = 28;

export function FleetHamletLifetime({ bornAt, now, events }: Props) {
  const totalMs = Math.max(1, now - bornAt);

  const pins = useMemo(() => {
    return events.map((ev) => {
      const offset = clamp01((ev.timestamp - bornAt) / totalMs);
      return { ev, offset };
    });
  }, [events, bornAt, totalMs]);

  const recent = useMemo(
    () => [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5),
    [events],
  );

  const [listOpen, setListOpen] = useState(true);

  return (
    <section className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-fg-muted)] mb-2 flex items-center gap-2">
        <span>🕰 Lifetime Timeline</span>
        <span className="text-[var(--color-fg-dim)] normal-case tracking-normal">
          {formatRelative(now - bornAt)} since birth · {events.length}{" "}
          event{events.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        className="relative w-full"
        style={{ height: TRACK_HEIGHT }}
        aria-label="lifetime track"
      >
        {/* track line */}
        <div
          className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, var(--color-border) 0%, var(--color-fg-dim) 100%)",
            opacity: 0.45,
          }}
        />
        {/* birth marker */}
        <span
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[14px] leading-none"
          style={{ left: 0 }}
          aria-hidden
          title="birth"
        >
          🐣
        </span>
        {/* now marker */}
        <span
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[14px] leading-none"
          style={{ left: "100%" }}
          aria-hidden
          title="now"
        >
          📍
        </span>

        {pins.map(({ ev, offset }, i) => (
          <span
            key={`${ev.kind}-${i}`}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 inline-flex items-center justify-center rounded-full border bg-[var(--color-bg)] hover:scale-110 transition-transform duration-150"
            style={{
              left: `${offset * 100}%`,
              width: PIN_SIZE,
              height: PIN_SIZE,
              borderColor: severityColor(ev.severity),
              fontSize: 13,
              lineHeight: 1,
            }}
            title={`${ev.label} · ${formatRelative(now - ev.timestamp)} ago — ${ev.message}`}
            aria-label={`${ev.label} ${formatRelative(now - ev.timestamp)} ago`}
          >
            <span aria-hidden>{ev.icon}</span>
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setListOpen((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        aria-expanded={listOpen}
      >
        {listOpen ? (
          <ChevronDown className="w-3 h-3" aria-hidden />
        ) : (
          <ChevronRight className="w-3 h-3" aria-hidden />
        )}
        Recent events
      </button>

      {listOpen && recent.length === 0 && (
        <div className="mt-1 text-[11px] font-mono text-[var(--color-fg-dim)]">
          No life events detected yet.
        </div>
      )}
      {listOpen && recent.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-[11px] font-mono">
          {recent.map((ev, i) => (
            <li
              key={`${ev.kind}-${i}`}
              className={cn(
                "flex gap-2 items-baseline leading-snug",
              )}
            >
              <span
                aria-hidden
                className="text-[14px] leading-none shrink-0"
                style={{ width: 16 }}
              >
                {ev.icon}
              </span>
              <span
                className="uppercase tracking-wider shrink-0"
                style={{ color: severityColor(ev.severity), width: 76 }}
              >
                {ev.label}
              </span>
              <span className="text-[var(--color-fg)] flex-1 min-w-0 truncate">
                {ev.message}
              </span>
              <span className="text-[var(--color-fg-dim)] shrink-0">
                {formatRelative(now - ev.timestamp)} ago
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function formatRelative(ms: number): string {
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
