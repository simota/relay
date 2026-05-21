// Hamlet — Events system (P5).
//
// Detects life events for each resident purely from data we already have
// in SessionSummary + SessionDetail. Pure functions only — no React, no
// network — so the same detector can drive the banner, the timeline, and
// the neighborhood overlay without any duplication.

import type { SessionDetail } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";
import { computeSkills } from "./fleet-hamlet-skills";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EventKind =
  | "fire"
  | "reaper"
  | "birthday"
  | "baby"
  | "wedding"
  | "achievement"
  | "sleep"
  | "quest";

export type EventSeverity = "info" | "warn" | "critical" | "celebrate";

export interface LifeEvent {
  kind: EventKind;
  sessionId: string;
  /** Best-guess ms timestamp for the trigger. Sorted-by-most-recent. */
  timestamp: number;
  icon: string;
  /** Short label e.g. "Birthday", "Fire". */
  label: string;
  /** One-line natural language message. */
  message: string;
  severity: EventSeverity;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const FIRE_WINDOW_TOOLS = 10;
const FIRE_ERROR_RATIO = 0.3;
const REAPER_IDLE_MS = 24 * 60 * 60 * 1000;
const REAPER_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000;
const BABY_WINDOW_MS = 60 * 60 * 1000;
const WEDDING_PAIR_MS = 5 * 60 * 1000;
const SLEEP_MIN_MS = 10 * 60 * 1000;
const SLEEP_MAX_MS = REAPER_IDLE_MS;
const ACHIEVEMENT_LEVELS = new Set<number>([5, 7, 10]);
const BIRTHDAY_BUCKETS_MS = [
  { ms: 60 * 60 * 1000, label: "1 hour" },
  { ms: 24 * 60 * 60 * 1000, label: "1 day" },
  { ms: 7 * 24 * 60 * 60 * 1000, label: "1 week" },
  { ms: 30 * 24 * 60 * 60 * 1000, label: "30 days" },
] as const;
// Allow ±1% of the bucket size (min 30s) so the once-per-15s tick still
// catches the birthday without firing every render.
const BIRTHDAY_TOLERANCE_RATIO = 0.01;
const BIRTHDAY_TOLERANCE_MIN_MS = 30_000;

const QUEST_KEYWORD_RE =
  /\b(完了|完成|done|finished|complete[d]?|shipped|merged|all green|ready to merge)\b/i;
const TOOL_ERROR_RE = /\b(error|failed|exception|traceback)\b/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect all events triggered by a single resident. Multiple events of
 * different kinds may fire simultaneously; the same kind never doubles up
 * (we keep the most recent).
 */
export function detectEvents(
  card: SimCardModel,
  detail: SessionDetail | undefined,
  allCards: readonly SimCardModel[],
  now: number,
): LifeEvent[] {
  const out: LifeEvent[] = [];
  const silenceMs = Math.max(0, now - card.lastActiveAt);
  const ageMs = Math.max(0, now - card.bornAt);

  // Fire — recent tool error storm.
  const fire = detectFire(card, detail, now);
  if (fire) out.push(fire);

  // Reaper — idle too long but not yet archived.
  if (silenceMs >= REAPER_IDLE_MS && silenceMs < REAPER_ARCHIVE_MS) {
    out.push({
      kind: "reaper",
      sessionId: card.sessionId,
      timestamp: card.lastActiveAt + REAPER_IDLE_MS,
      icon: "💀",
      label: "Reaper",
      message: `The Reaper looms over ${labelFor(card)}…`,
      severity: "warn",
    });
  }

  // Birthday — hit a milestone bucket within tolerance.
  const bday = detectBirthday(card, ageMs);
  if (bday) out.push(bday);

  // Baby — this resident spawned a child within the last hour.
  const baby = detectBaby(card, allCards, now);
  if (baby) out.push(baby);

  // Wedding — co-started with another resident in the same repo.
  const wedding = detectWedding(card, allCards);
  if (wedding) out.push(wedding);

  // Achievement — newly reached level 5 / 7 / 10 of some skill.
  const ach = detectAchievement(card, detail);
  if (ach) out.push(ach);

  // Sleep — idle band 10m..24h.
  if (silenceMs >= SLEEP_MIN_MS && silenceMs < SLEEP_MAX_MS) {
    out.push({
      kind: "sleep",
      sessionId: card.sessionId,
      timestamp: card.lastActiveAt + SLEEP_MIN_MS,
      icon: "😴",
      label: "Sleep",
      message: `${labelFor(card)} is sleeping…`,
      severity: "info",
    });
  }

  // Quest — latest assistant message announces completion.
  const quest = detectQuest(card, detail);
  if (quest) out.push(quest);

  // Same-kind dedupe (defensive — currently each detector returns at most
  // one event of its kind, but guard against future signal additions).
  const byKind = new Map<EventKind, LifeEvent>();
  for (const ev of out) {
    const prev = byKind.get(ev.kind);
    if (!prev || ev.timestamp > prev.timestamp) {
      byKind.set(ev.kind, ev);
    }
  }
  return [...byKind.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Collect events across every resident — used by the global banner and the
 * neighborhood overlay. Returned newest-first.
 */
export function collectAllEvents(
  allCards: readonly SimCardModel[],
  detailByKey: ReadonlyMap<string, SessionDetail>,
  now: number,
): LifeEvent[] {
  const out: LifeEvent[] = [];
  for (const card of allCards) {
    const detail = detailByKey.get(card.key);
    for (const ev of detectEvents(card, detail, allCards, now)) {
      out.push(ev);
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

// ---------------------------------------------------------------------------
// Severity → color (CSS string)
// ---------------------------------------------------------------------------

export function severityColor(s: EventSeverity): string {
  switch (s) {
    case "critical":
      return "hsl(0, 75%, 55%)";
    case "warn":
      return "hsl(35, 80%, 55%)";
    case "celebrate":
      return "hsl(280, 65%, 60%)";
    case "info":
      return "hsl(210, 50%, 60%)";
  }
}

/** Severity weight — higher means more attention-grabbing. */
export function severityWeight(s: EventSeverity): number {
  switch (s) {
    case "critical":
      return 4;
    case "warn":
      return 3;
    case "celebrate":
      return 2;
    case "info":
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Internal detectors
// ---------------------------------------------------------------------------

function detectFire(
  card: SimCardModel,
  detail: SessionDetail | undefined,
  now: number,
): LifeEvent | null {
  if (!detail || detail.tool_calls.length === 0) return null;
  // Sort newest-first, take the last FIRE_WINDOW_TOOLS.
  const sorted = [...detail.tool_calls]
    .map((tc) => ({ tc, ts: Date.parse(tc.timestamp) }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, FIRE_WINDOW_TOOLS);
  if (sorted.length < 3) return null;
  let errors = 0;
  for (const x of sorted) {
    if (x.tc.args_summary && TOOL_ERROR_RE.test(x.tc.args_summary)) errors += 1;
  }
  const ratio = errors / sorted.length;
  if (ratio < FIRE_ERROR_RATIO) return null;
  const first = sorted[0];
  const ts = first ? first.ts : now;
  return {
    kind: "fire",
    sessionId: card.sessionId,
    timestamp: ts,
    icon: "🔥",
    label: "Fire",
    message: `${labelFor(card)}'s house is on fire! (${errors}/${sorted.length} recent tools failed)`,
    severity: "critical",
  };
}

function detectBirthday(card: SimCardModel, ageMs: number): LifeEvent | null {
  for (const bucket of BIRTHDAY_BUCKETS_MS) {
    const tol = Math.max(
      BIRTHDAY_TOLERANCE_MIN_MS,
      bucket.ms * BIRTHDAY_TOLERANCE_RATIO,
    );
    if (Math.abs(ageMs - bucket.ms) <= tol) {
      return {
        kind: "birthday",
        sessionId: card.sessionId,
        timestamp: card.bornAt + bucket.ms,
        icon: "🎂",
        label: "Birthday",
        message: `${labelFor(card)} turned ${bucket.label} old!`,
        severity: "celebrate",
      };
    }
  }
  return null;
}

function detectBaby(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
  now: number,
): LifeEvent | null {
  let latestChild: SimCardModel | null = null;
  for (const c of allCards) {
    if (c.parentSessionId !== card.sessionId) continue;
    if (now - c.bornAt > BABY_WINDOW_MS) continue;
    if (!latestChild || c.bornAt > latestChild.bornAt) latestChild = c;
  }
  if (!latestChild) return null;
  return {
    kind: "baby",
    sessionId: card.sessionId,
    timestamp: latestChild.bornAt,
    icon: "🤱",
    label: "Baby",
    message: `${labelFor(card)} welcomed a child: ${labelFor(latestChild)}`,
    severity: "celebrate",
  };
}

function detectWedding(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
): LifeEvent | null {
  if (!card.repo) return null;
  let partner: SimCardModel | null = null;
  for (const other of allCards) {
    if (other.sessionId === card.sessionId) continue;
    if (other.repo !== card.repo) continue;
    if (other.sessionType === card.sessionType && other.agentId === card.agentId)
      continue;
    if (Math.abs(other.bornAt - card.bornAt) > WEDDING_PAIR_MS) continue;
    if (!partner || other.bornAt < partner.bornAt) partner = other;
  }
  if (!partner) return null;
  // Stable ordering — only emit from the earlier-born side so we don't get
  // a pair of wedding events for the same couple.
  if (card.bornAt > partner.bornAt) return null;
  if (
    card.bornAt === partner.bornAt &&
    card.sessionId.localeCompare(partner.sessionId) > 0
  )
    return null;
  return {
    kind: "wedding",
    sessionId: card.sessionId,
    timestamp: Math.max(card.bornAt, partner.bornAt),
    icon: "💍",
    label: "Wedding",
    message: `${labelFor(card)} & ${labelFor(partner)} started together in ${card.repo}`,
    severity: "celebrate",
  };
}

function detectAchievement(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): LifeEvent | null {
  const skills = computeSkills(card, detail);
  for (const s of skills) {
    if (ACHIEVEMENT_LEVELS.has(s.level)) {
      return {
        kind: "achievement",
        sessionId: card.sessionId,
        // Achievement timestamp is fuzzy — anchor to last activity so the
        // banner places it near "now".
        timestamp: card.lastActiveAt,
        icon: "⭐",
        label: "Achievement",
        message: `${labelFor(card)} reached ${s.levelLabel} in ${s.label}`,
        severity: "celebrate",
      };
    }
  }
  return null;
}

function detectQuest(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): LifeEvent | null {
  if (!detail) return null;
  const assistant = [...detail.messages]
    .filter((m) => m.role === "assistant")
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const latest = assistant[0];
  if (!latest) return null;
  if (!QUEST_KEYWORD_RE.test(latest.text)) return null;
  const ts = Date.parse(latest.timestamp);
  return {
    kind: "quest",
    sessionId: card.sessionId,
    timestamp: Number.isFinite(ts) ? ts : card.lastActiveAt,
    icon: "🎯",
    label: "Quest",
    message: `${labelFor(card)} cleared a quest!`,
    severity: "celebrate",
  };
}

// ---------------------------------------------------------------------------
// Utility — short label
// ---------------------------------------------------------------------------

function labelFor(card: SimCardModel): string {
  const agent = card.sessionType[0]?.toUpperCase() ?? "?";
  const name =
    card.agentId ?? `${agent}@${card.sessionId.slice(0, 6)}…`;
  if (card.repo) return `${name} (${card.repo})`;
  return name;
}
