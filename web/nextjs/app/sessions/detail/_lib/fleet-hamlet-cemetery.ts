// Hamlet — Cemetery (P5).
//
// Treats archived / long-idle residents as departed souls. Builds Headstone
// records and the Hall of Fame board purely from data we already have.
// Pure functions only.

import type { SessionDetail } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";
import { computeTrophies } from "./fleet-hamlet-house";
import { computeSkills, topSkills } from "./fleet-hamlet-skills";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Headstone {
  card: SimCardModel;
  bornAt: number;
  restedAt: number;
  lifetimeMs: number;
  /** Short achievement line — "Master TypeScript", "Adept Refactoring"… */
  epitaph: string;
}

export interface HallOfFameEntry {
  /** Stable id for keying the JSX list. */
  id: string;
  label: string;
  card: SimCardModel | null;
  /** Pre-formatted display value, "—" when unavailable. */
  value: string;
  emoji: string;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const ARCHIVE_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7d fallback
const FRESHLY_RESTED_MS = 7 * 24 * 60 * 60 * 1000; // "last 7 days" rollup
const WORKSHOP_BURST_MS = 8_000; // mirror house.ts

// ---------------------------------------------------------------------------
// Archived predicate
// ---------------------------------------------------------------------------

export function isArchived(card: SimCardModel, now: number): boolean {
  // SessionStatus doesn't include "archived" today, but if the upstream
  // detector ever introduces it we honour it first.
  const s = card.status as string | undefined;
  if (s === "archived") return true;
  return now - card.lastActiveAt > ARCHIVE_IDLE_MS;
}

// ---------------------------------------------------------------------------
// Cemetery builder
// ---------------------------------------------------------------------------

export function buildCemetery(
  cards: readonly SimCardModel[],
  detailByKey: ReadonlyMap<string, SessionDetail>,
  now: number,
): Headstone[] {
  const out: Headstone[] = [];
  for (const card of cards) {
    if (!isArchived(card, now)) continue;
    const detail = detailByKey.get(card.key);
    out.push({
      card,
      bornAt: card.bornAt,
      restedAt: card.lastActiveAt,
      lifetimeMs: Math.max(0, card.lastActiveAt - card.bornAt),
      epitaph: pickEpitaph(card, detail),
    });
  }
  // Most-recent resting first.
  out.sort((a, b) => b.restedAt - a.restedAt);
  return out;
}

export function countRecentlyRested(
  stones: readonly Headstone[],
  now: number,
): number {
  let n = 0;
  for (const s of stones) {
    if (now - s.restedAt <= FRESHLY_RESTED_MS) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Hall of Fame
// ---------------------------------------------------------------------------

export function computeHallOfFame(
  cards: readonly SimCardModel[],
  detailByKey: ReadonlyMap<string, SessionDetail>,
  now: number,
): HallOfFameEntry[] {
  // Longest Lifetime — biggest ageMs
  const longest = pickByMetric(cards, (c) => Math.max(0, now - c.bornAt));

  // Best Tool Combo — longest tool-call burst
  const combo = pickByMetricWithDetail(
    cards,
    detailByKey,
    (_c, detail) => bestCombo(detail),
  );

  // Fastest Reply — min user→assistant gap (smaller is better → invert)
  const fastestPair = pickByMetricWithDetail(
    cards,
    detailByKey,
    (_c, detail) => negFastestReply(detail),
  );

  // Most Children — count cards whose parent_session_id matches
  const childCounts = new Map<string, number>();
  for (const c of cards) {
    if (!c.parentSessionId) continue;
    childCounts.set(c.parentSessionId, (childCounts.get(c.parentSessionId) ?? 0) + 1);
  }
  const mostChildren = pickByMetric(cards, (c) => childCounts.get(c.sessionId) ?? 0);

  return [
    {
      id: "longest-lifetime",
      label: "Longest Lifetime",
      emoji: "⏳",
      card: longest?.card ?? null,
      value: longest ? formatDuration(longest.value) : "—",
    },
    {
      id: "best-combo",
      label: "Best Tool Combo",
      emoji: "🔨",
      card: combo?.card ?? null,
      value: combo && combo.value > 0 ? `x${combo.value}` : "—",
    },
    {
      id: "fastest-reply",
      label: "Fastest Reply",
      emoji: "⚡",
      card: fastestPair?.card ?? null,
      value:
        fastestPair && fastestPair.value > Number.NEGATIVE_INFINITY
          ? formatLatency(-fastestPair.value)
          : "—",
    },
    {
      id: "most-children",
      label: "Most Children",
      emoji: "👨‍👩‍👧",
      card: mostChildren && mostChildren.value > 0 ? mostChildren.card : null,
      value: mostChildren && mostChildren.value > 0 ? `${mostChildren.value}` : "—",
    },
  ];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function pickEpitaph(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): string {
  const skills = computeSkills(card, detail);
  const top = topSkills(skills, 1)[0];
  if (top && top.level > 0) {
    return `${top.levelLabel} ${top.label}`;
  }
  const trophies = computeTrophies(card, detail);
  const first = trophies[0];
  if (first) return `${first.label}: ${first.value}`;
  return "A quiet life";
}

function pickByMetric<T extends SimCardModel>(
  cards: readonly T[],
  metric: (c: T) => number,
): { card: T; value: number } | null {
  let best: { card: T; value: number } | null = null;
  for (const c of cards) {
    const v = metric(c);
    if (!Number.isFinite(v)) continue;
    if (!best || v > best.value || (v === best.value && c.lastActiveAt > best.card.lastActiveAt)) {
      best = { card: c, value: v };
    }
  }
  return best;
}

function pickByMetricWithDetail(
  cards: readonly SimCardModel[],
  detailByKey: ReadonlyMap<string, SessionDetail>,
  metric: (c: SimCardModel, detail: SessionDetail | undefined) => number,
): { card: SimCardModel; value: number } | null {
  let best: { card: SimCardModel; value: number } | null = null;
  for (const c of cards) {
    const v = metric(c, detailByKey.get(c.key));
    if (!Number.isFinite(v)) continue;
    if (!best || v > best.value || (v === best.value && c.lastActiveAt > best.card.lastActiveAt)) {
      best = { card: c, value: v };
    }
  }
  return best;
}

function bestCombo(detail: SessionDetail | undefined): number {
  if (!detail || detail.tool_calls.length === 0) return 0;
  const sorted = detail.tool_calls
    .map((tc) => Date.parse(tc.timestamp))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (cur === undefined || prev === undefined) continue;
    if (cur - prev <= WORKSHOP_BURST_MS) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

/** Returns negative-fastest so a higher metric == faster. */
function negFastestReply(detail: SessionDetail | undefined): number {
  if (!detail) return Number.NEGATIVE_INFINITY;
  const msgs = [...detail.messages].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
  let pendingUserTs: number | null = null;
  let fastest = Number.POSITIVE_INFINITY;
  for (const m of msgs) {
    const ts = Date.parse(m.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (m.role === "user") {
      pendingUserTs = ts;
    } else if (m.role === "assistant" && pendingUserTs !== null) {
      fastest = Math.min(fastest, Math.max(0, ts - pendingUserTs));
      pendingUserTs = null;
    }
  }
  if (!Number.isFinite(fastest)) return Number.NEGATIVE_INFINITY;
  return -fastest;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 14) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}

export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()] ?? "?"} ${d.getDate()}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
