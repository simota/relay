// Hamlet — The Sims–style "village of sessions" view.
//
// Every active session is one resident. We extrapolate eight needs bars,
// a moodlet, a life-stage label, and a deterministic avatar from data we
// already have (SessionSummary + SessionDetail). No new API surface and
// no new npm dependencies — everything is computed client-side so the
// page stays static-exportable.

import type { SessionDetail, SessionStatus, SessionSummary } from "@/lib/api";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NeedKey =
  | "hunger"
  | "energy"
  | "social"
  | "fun"
  | "hygiene"
  | "bladder"
  | "comfort"
  | "environment";

export const NEED_ORDER: readonly NeedKey[] = [
  "hunger",
  "energy",
  "social",
  "fun",
  "hygiene",
  "bladder",
  "comfort",
  "environment",
] as const;

/** Short pictographs used in moodlet + lifestage chips. */
export interface MoodletInfo {
  key: MoodKey;
  emoji: string;
  label: string;
  /** Tailwind-safe css color string. */
  color: string;
}

export type MoodKey =
  | "stressed"
  | "bored"
  | "energized"
  | "focused"
  | "asleep"
  | "happy";

export interface LifeStageInfo {
  key: LifeStageKey;
  emoji: string;
  label: string;
}

export type LifeStageKey =
  | "newborn"
  | "infant"
  | "toddler"
  | "adult"
  | "elder";

export interface SimNeed {
  key: NeedKey;
  /** 0-100 (clamped). */
  value: number;
}

export interface SimCardModel {
  key: string;
  sessionType: SessionSummary["type"];
  sessionId: string;
  /** Parent session id when this resident is a subagent — used by the
   *  Neighborhood view to draw spawn roads. */
  parentSessionId?: string;
  repo: string | null;
  agentId?: string;
  status: SessionStatus | undefined;
  needs: SimNeed[];
  mood: MoodletInfo;
  stage: LifeStageInfo;
  /** Deterministic avatar seed (hash of sessionType:sessionId). */
  avatarSeed: number;
  /** Hue from the shared Fleet hueMap, baked in so the card knows its lane. */
  hue: number;
  /** ms — first known activity (started_at fallback to last_active). */
  bornAt: number;
  /** ms — most recent activity timestamp we know about. */
  lastActiveAt: number;
}

// ---------------------------------------------------------------------------
// Constants / tunables
// ---------------------------------------------------------------------------

const SOCIAL_RECENT_WINDOW_MS = 60 * 60 * 1000; // 1h
const FOCUSED_BURST_WINDOW_MS = 8_000;
const ENERGIZED_BIRTH_WINDOW_MS = 60_000;
const BORED_SILENCE_MS = 5 * 60_000;
const ASLEEP_IDLE_MS = 24 * 60 * 60 * 1000;
const COMFORT_FAST_MS = 5_000;
const COMFORT_SLOW_MS = 60_000;

// Need calculation — Hunger uses message_count / 200 as a proxy for context
// fill; 200 messages ≈ a saturated context window for our sample sizes.
const HUNGER_FULL_MESSAGES = 200;

// Energy decays linearly over 24h since first activity.
const ENERGY_DECAY_MS = 24 * 60 * 60 * 1000;

// Default environment value until repo-density signal is wired in.
const ENV_DEFAULT = 70;

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

export interface BuildSimContext {
  now: number;
  hueMap: ReadonlyMap<string, number>;
  detailByKey: ReadonlyMap<string, SessionDetail>;
}

export function buildSimCards(
  sessions: readonly SessionSummary[],
  ctx: BuildSimContext,
): SimCardModel[] {
  // Pre-compute "is there any other session active within the social window"
  // once per call — used by every card's Social need.
  const recentOthers = new Map<string, number>();
  for (const s of sessions) {
    const ts = Date.parse(s.last_active);
    if (!Number.isFinite(ts)) continue;
    recentOthers.set(`${s.type}:${s.id}`, ts);
  }

  return sessions.map((s) => buildSim(s, ctx, recentOthers));
}

function buildSim(
  s: SessionSummary,
  ctx: BuildSimContext,
  recentOthers: ReadonlyMap<string, number>,
): SimCardModel {
  const key = `${s.type}:${s.id}`;
  const detail = ctx.detailByKey.get(key);

  const started = Date.parse(s.started_at);
  const lastActive = Date.parse(s.last_active);
  const bornAt = Number.isFinite(started) ? started : lastActive;
  const lastActiveAt = Number.isFinite(lastActive) ? lastActive : ctx.now;

  // Tool call summary stats — used by Fun (entropy) + Hygiene (error rate).
  const toolStats = summarizeToolCalls(detail);
  // Median latency drives Comfort.
  const medianLatencyMs = detail ? medianLatency(detail) : null;

  const hours = (ctx.now - bornAt) / 3_600_000;

  const hasSocialPeer = anyPeerActiveWithin(
    key,
    ctx.now,
    recentOthers,
    SOCIAL_RECENT_WINDOW_MS,
  );

  const errorRate = toolStats.count > 0 ? toolStats.errorCount / toolStats.count : 0;

  const rawNeeds: SimNeed[] = [
    { key: "hunger", value: hungerFromMessages(s.message_count) },
    { key: "energy", value: energyFromAge(hours) },
    {
      key: "social",
      value: socialFromContext(!!s.parent_session_id, hasSocialPeer),
    },
    {
      key: "fun",
      value: toolStats.count > 0 ? funFromEntropy(toolStats.entropy01) : 50,
    },
    {
      key: "hygiene",
      value: toolStats.count > 0 ? Math.round(100 - errorRate * 100) : 90,
    },
    { key: "bladder", value: bladderFromCount(s.message_count) },
    {
      key: "comfort",
      value: medianLatencyMs !== null ? comfortFromLatency(medianLatencyMs) : 75,
    },
    { key: "environment", value: ENV_DEFAULT },
  ];
  const needs: SimNeed[] = rawNeeds.map((n) => ({
    key: n.key,
    value: clamp01_100(n.value),
  }));

  const mood = pickMood({
    errorRate,
    silenceMs: Math.max(0, ctx.now - lastActiveAt),
    ageMs: Math.max(0, ctx.now - bornAt),
    recentToolBurst: toolStats.recentBurstWithinMs <= FOCUSED_BURST_WINDOW_MS,
  });

  const stage = pickLifeStage(Math.max(0, ctx.now - bornAt));

  const hue = ctx.hueMap.get(key) ?? 0;
  const avatarSeed = hashStringToInt(key);

  return {
    key,
    sessionType: s.type,
    sessionId: s.id,
    parentSessionId: s.parent_session_id,
    repo: s.repo,
    agentId: s.agent_id,
    status: s.status,
    needs,
    mood,
    stage,
    avatarSeed,
    hue,
    bornAt,
    lastActiveAt,
  };
}

// ---------------------------------------------------------------------------
// Need calculations
// ---------------------------------------------------------------------------

export function hungerFromMessages(messageCount: number): number {
  const ratio = Math.min(messageCount / HUNGER_FULL_MESSAGES, 1);
  return Math.round(100 - ratio * 100);
}

export function energyFromAge(hoursSinceFirstActivity: number): number {
  if (hoursSinceFirstActivity <= 0) return 100;
  const ratio = Math.min(hoursSinceFirstActivity / (ENERGY_DECAY_MS / 3_600_000), 1);
  return Math.round(100 - ratio * 100);
}

export function socialFromContext(
  hasParent: boolean,
  hasRecentPeer: boolean,
): number {
  let v = 30; // base
  if (hasParent) v += 40;
  if (hasRecentPeer) v += 30;
  return v;
}

// Shannon entropy of tool-name distribution, normalized to 0..1 against
// log2(distinctNames). Returns 0 when only one distinct name exists.
export function funFromEntropy(entropy01: number): number {
  return Math.round(entropy01 * 100);
}

export function bladderFromCount(messageCount: number): number {
  // Intentionally a placeholder — meant to be replaced by uncommitted-diff
  // pressure when the data is available. Falls in 1..100 deterministically.
  return Math.max(1, 100 - (messageCount % 100));
}

export function comfortFromLatency(medianMs: number): number {
  if (medianMs <= COMFORT_FAST_MS) return 100;
  if (medianMs >= COMFORT_SLOW_MS) return 0;
  const span = COMFORT_SLOW_MS - COMFORT_FAST_MS;
  return Math.round(100 - ((medianMs - COMFORT_FAST_MS) / span) * 100);
}

function clamp01_100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}

// ---------------------------------------------------------------------------
// Tool stats — Fun / Hygiene
// ---------------------------------------------------------------------------

interface ToolStats {
  count: number;
  errorCount: number;
  /** Normalized Shannon entropy (0..1) of tool-name distribution. */
  entropy01: number;
  /** ms — gap between the two most recent tool calls (Infinity if <2). */
  recentBurstWithinMs: number;
}

function summarizeToolCalls(detail: SessionDetail | undefined): ToolStats {
  if (!detail || detail.tool_calls.length === 0) {
    return { count: 0, errorCount: 0, entropy01: 0, recentBurstWithinMs: Number.POSITIVE_INFINITY };
  }
  const counts = new Map<string, number>();
  let errorCount = 0;
  for (const tc of detail.tool_calls) {
    counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1);
    // SessionToolCall has no explicit success/failure field — best effort
    // detection looks at the args_summary blob for error-ish tokens.
    if (looksLikeError(tc.args_summary)) errorCount += 1;
  }
  const entropy = shannonEntropy([...counts.values()]);
  const distinct = counts.size;
  const entropy01 = distinct > 1 ? entropy / Math.log2(distinct) : 0;

  // Gap between the two most recent tool calls (any pair) — drives Focused.
  let recentGap = Number.POSITIVE_INFINITY;
  if (detail.tool_calls.length >= 2) {
    const sorted = [...detail.tool_calls]
      .map((tc) => Date.parse(tc.timestamp))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    if (sorted.length >= 2) {
      const a = sorted[0];
      const b = sorted[1];
      if (a !== undefined && b !== undefined) recentGap = a - b;
    }
  }

  return { count: detail.tool_calls.length, errorCount, entropy01, recentBurstWithinMs: recentGap };
}

function looksLikeError(blob: string | null | undefined): boolean {
  if (!blob) return false;
  return /\b(error|failed|exception|traceback)\b/i.test(blob);
}

function shannonEntropy(counts: readonly number[]): number {
  let total = 0;
  for (const c of counts) total += c;
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Latency median (Comfort)
// ---------------------------------------------------------------------------

function medianLatency(detail: SessionDetail): number | null {
  // Walk messages chronologically pairing user → next-assistant. Matches
  // the convention used by fleet-pulse's Tide chart.
  const msgs = [...detail.messages].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
  const gaps: number[] = [];
  let pendingUserTs: number | null = null;
  for (const m of msgs) {
    const ts = Date.parse(m.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (m.role === "user") {
      pendingUserTs = ts;
      continue;
    }
    if (m.role === "assistant" && pendingUserTs !== null) {
      gaps.push(Math.max(0, ts - pendingUserTs));
      pendingUserTs = null;
    }
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  if (gaps.length % 2 === 1) return gaps[mid] ?? null;
  const lo = gaps[mid - 1];
  const hi = gaps[mid];
  if (lo === undefined || hi === undefined) return null;
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Peer-activity check (Social)
// ---------------------------------------------------------------------------

function anyPeerActiveWithin(
  selfKey: string,
  now: number,
  recent: ReadonlyMap<string, number>,
  windowMs: number,
): boolean {
  for (const [k, ts] of recent) {
    if (k === selfKey) continue;
    if (now - ts <= windowMs) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mood selection — priority order documented in CLAUDE-recipe
// ---------------------------------------------------------------------------

interface MoodInput {
  errorRate: number;
  silenceMs: number;
  ageMs: number;
  recentToolBurst: boolean;
}

export function pickMood(input: MoodInput): MoodletInfo {
  if (input.errorRate > 0.3) {
    return { key: "stressed", emoji: "🥵", label: "Stressed", color: "hsl(0, 70%, 55%)" };
  }
  if (input.silenceMs > BORED_SILENCE_MS && input.silenceMs < ASLEEP_IDLE_MS) {
    return { key: "bored", emoji: "🥱", label: "Bored", color: "hsl(220, 25%, 55%)" };
  }
  if (input.ageMs < ENERGIZED_BIRTH_WINDOW_MS) {
    return { key: "energized", emoji: "🏃", label: "Energized", color: "hsl(140, 60%, 50%)" };
  }
  if (input.recentToolBurst) {
    return { key: "focused", emoji: "🎯", label: "Focused", color: "hsl(45, 80%, 55%)" };
  }
  if (input.silenceMs >= ASLEEP_IDLE_MS) {
    return { key: "asleep", emoji: "💤", label: "Asleep", color: "hsl(260, 30%, 55%)" };
  }
  return { key: "happy", emoji: "😊", label: "Happy", color: "hsl(180, 55%, 50%)" };
}

// ---------------------------------------------------------------------------
// Life-stage — first-activity age buckets
// ---------------------------------------------------------------------------

export function pickLifeStage(ageMs: number): LifeStageInfo {
  if (ageMs < 60_000) return { key: "newborn", emoji: "👶", label: "Newborn" };
  if (ageMs < 3_600_000) return { key: "infant", emoji: "🧒", label: "Infant" };
  if (ageMs < 86_400_000) return { key: "toddler", emoji: "🧑", label: "Toddler" };
  if (ageMs < 7 * 86_400_000) return { key: "adult", emoji: "🧑‍💼", label: "Adult" };
  return { key: "elder", emoji: "👴", label: "Elder" };
}

// ---------------------------------------------------------------------------
// Avatar — deterministic SVG seed
// ---------------------------------------------------------------------------

// FNV-1a 32-bit. We only need a stable 32-bit integer per session so the
// SVG components (skin tone, hair shape, eye shape) pick the same option
// across renders.
export function hashStringToInt(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface AvatarParts {
  skinHue: number;
  hairHue: number;
  /** Legacy 4-way enum (kept for older callers that switch on it). */
  hairStyle: 0 | 1 | 2 | 3;
  eyeShape: 0 | 1 | 2;
  /** Six-way refined hair style enum used by the new avatar renderers. */
  hair: "short" | "wavy" | "bob" | "topknot" | "curly" | "bald";
  /** Whether the chosen hair style leaves the ears visible. */
  hasEars: boolean;
  /** Hue for the cheek-blush ellipses (always a soft pink/rose). */
  cheekHue: number;
  /** Animation delay (s) for the blink keyframe so a crowd doesn't blink in unison. */
  blinkDelay: number;
  /** Animation delay (s) for the idle-breathe keyframe (same reason). */
  breatheDelay: number;
}

const REFINED_HAIR: readonly AvatarParts["hair"][] = [
  "short",
  "wavy",
  "bob",
  "topknot",
  "curly",
  "bald",
] as const;

export function avatarPartsFromSeed(seed: number): AvatarParts {
  // Slice the seed into 4 8-bit lanes; each lane drives one feature.
  const a = (seed >>> 0) & 0xff;
  const b = (seed >>> 8) & 0xff;
  const c = (seed >>> 16) & 0xff;
  const d = (seed >>> 24) & 0xff;
  const hair = REFINED_HAIR[c % REFINED_HAIR.length] ?? "short";
  // Bob / curly cover the ears; everything else exposes them.
  const hasEars = hair !== "bob" && hair !== "curly";
  // Cheek hue is always in the warm pink band — keeps the village palette
  // consistent regardless of skin tone.
  const cheekHue = 350 + ((d >>> 1) % 20);
  return {
    skinHue: (a * 360) >>> 8,
    hairHue: (b * 360) >>> 8,
    hairStyle: (c % 4) as AvatarParts["hairStyle"],
    eyeShape: (d % 3) as AvatarParts["eyeShape"],
    hair,
    hasEars,
    cheekHue,
    // Stagger delays across [-4, 0)s so neighbours animate out of phase.
    blinkDelay: -((a % 80) / 10),
    breatheDelay: -((b % 40) / 10),
  };
}

// ---------------------------------------------------------------------------
// Need rendering hints — color ramp per value
// ---------------------------------------------------------------------------

// Green (full) → amber (mid) → red (low). The Sims uses an even sharper
// red at the bottom, but we keep it subdued so a glance over many cards
// isn't visually shouty.
export function needColor(value: number): string {
  if (value >= 70) return "hsl(140, 55%, 50%)";
  if (value >= 40) return "hsl(45, 75%, 55%)";
  if (value >= 20) return "hsl(20, 75%, 55%)";
  return "hsl(0, 65%, 55%)";
}

export function needLabel(key: NeedKey): string {
  switch (key) {
    case "hunger":
      return "Hunger";
    case "energy":
      return "Energy";
    case "social":
      return "Social";
    case "fun":
      return "Fun";
    case "hygiene":
      return "Hygiene";
    case "bladder":
      return "Bladder";
    case "comfort":
      return "Comfort";
    case "environment":
      return "Environment";
  }
}
