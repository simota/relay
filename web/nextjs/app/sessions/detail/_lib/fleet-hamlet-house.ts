// Hamlet — House Plan helpers.
//
// One session as an internal cross-section: 5-6 named "rooms" plus a
// vitals HUD, an action-queue extractor, and a babble window. Each room
// has a status color computed from already-derived signals (the same
// SessionDetail used by Pulse / Cards / Cosmos). Pure functions only —
// no React, no DOM access — so the component can stay focused on layout.

import type { SessionDetail, SessionMessage } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";
import { computeRelationships } from "./fleet-hamlet-relations";
import { computeSkills } from "./fleet-hamlet-skills";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RoomKind =
  | "living"
  | "workshop"
  | "library"
  | "nursery"
  | "trophy"
  | "study"
  | "reception";

export type RoomColor = "green" | "yellow" | "orange" | "red" | "gray";

export interface RoomAssessment {
  kind: RoomKind;
  color: RoomColor;
  label: string;
  emoji: string;
  title: string;
  details: string[];
}

export interface Vitals {
  /** beats per minute — proxy from msg/min × 12. */
  heartRate: number;
  /** breaths per minute — proxy from tool/min. */
  breathRate: number;
  /** °C — 36 baseline, climbs with context fill. */
  temperature: number;
  /** "120/80" style blood pressure proxy. */
  bpSystolic: number;
  bpDiastolic: number;
}

export interface BabbleLine {
  role: SessionMessage["role"];
  content: string;
}

export interface Trophy {
  label: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Tunables — match fleet-hamlet.ts windows where applicable so the House
// view doesn't contradict the Card / Neighborhood signals.
// ---------------------------------------------------------------------------

const VITAL_WINDOW_MS = 5 * 60 * 1000; // 5m rolling window
const LIVING_ACTIVE_MS = 30_000;
const LIVING_THINKING_MS = 2 * 60 * 1000;
const LIVING_IDLE_MS = 10 * 60 * 1000;
const WORKSHOP_BURST_MS = 8_000;
const HUNGER_FULL_MESSAGES = 200; // mirror fleet-hamlet HUNGER_FULL_MESSAGES

// ---------------------------------------------------------------------------
// Room assessment
// ---------------------------------------------------------------------------

export function assessRoom(
  kind: RoomKind,
  card: SimCardModel,
  detail: SessionDetail | undefined,
  now: number,
  allCards: readonly SimCardModel[],
): RoomAssessment {
  switch (kind) {
    case "living":
      return assessLiving(card, detail, now);
    case "workshop":
      return assessWorkshop(card, detail, now);
    case "library":
      return assessLibrary(card, detail);
    case "nursery":
      return assessNursery(card, allCards, now);
    case "trophy":
      return assessTrophy(card, detail);
    case "study":
      return assessStudy(card, detail);
    case "reception":
      return assessReception(card, allCards, now);
  }
}

function assessStudy(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): RoomAssessment {
  const skills = computeSkills(card, detail);
  if (skills.length === 0) {
    return {
      kind: "study",
      color: "gray",
      label: "Empty",
      emoji: "🎓",
      title: "Study Room (Skills)",
      details: ["No skills earned yet"],
    };
  }
  const max = skills.reduce((m, s) => (s.level > m ? s.level : m), 0);
  const total = skills.reduce((sum, s) => sum + s.xp, 0);
  let color: RoomColor = "green";
  if (max >= 7) color = "yellow"; // shiny — almost a trophy
  if (max >= 9) color = "orange"; // mastery in progress
  return {
    kind: "study",
    color,
    label:
      max >= 9
        ? `Master · ${skills.length} skills`
        : `Lv${max} · ${skills.length} skills`,
    emoji: "🎓",
    title: "Study Room (Skills)",
    details: [
      `${skills.length} skill${skills.length === 1 ? "" : "s"} · total ${total} xp`,
      `Top level: Lv ${max}`,
    ],
  };
}

function assessReception(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
  now: number,
): RoomAssessment {
  const rels = computeRelationships(card, allCards, now);
  if (rels.length === 0) {
    return {
      kind: "reception",
      color: "gray",
      label: "No visitors",
      emoji: "🚪",
      title: "Reception Room (Relations)",
      details: ["Stranger to everyone"],
    };
  }
  const familyCount = rels.filter((r) => r.score >= 85).length;
  const friendCount = rels.filter((r) => r.score >= 45 && r.score < 85).length;
  const color: RoomColor = familyCount > 0 ? "green" : friendCount > 0 ? "yellow" : "orange";
  return {
    kind: "reception",
    color,
    label: `${rels.length} ${rels.length === 1 ? "tie" : "ties"}`,
    emoji: "🚪",
    title: "Reception Room (Relations)",
    details: [
      `${familyCount} family · ${friendCount} friends · ${rels.length - familyCount - friendCount} others`,
    ],
  };
}

function assessLiving(
  card: SimCardModel,
  detail: SessionDetail | undefined,
  now: number,
): RoomAssessment {
  const silence = Math.max(0, now - card.lastActiveAt);
  let color: RoomColor;
  let state: string;
  if (silence <= LIVING_ACTIVE_MS) {
    color = "green";
    state = "Active — recent message";
  } else if (silence <= LIVING_THINKING_MS) {
    color = "yellow";
    state = "Thinking — awaiting reply";
  } else if (silence <= LIVING_IDLE_MS) {
    color = "orange";
    state = "Idle";
  } else {
    color = "red";
    state = "Silent — no message > 10m";
  }
  const details: string[] = [
    `Last msg: ${formatAge(silence)} ago`,
    state,
  ];
  if (detail) {
    details.push(`Total messages: ${detail.messages.length}`);
  }
  return {
    kind: "living",
    color,
    label: roomLabel("living", color),
    emoji: "🛋",
    title: "Living Room (LLM Core)",
    details,
  };
}

function assessWorkshop(
  card: SimCardModel,
  detail: SessionDetail | undefined,
  now: number,
): RoomAssessment {
  if (!detail || detail.tool_calls.length === 0) {
    return {
      kind: "workshop",
      color: "gray",
      label: "Quiet",
      emoji: "🔨",
      title: "Workshop (Tool Exec)",
      details: ["No tool calls yet"],
    };
  }
  // Sort by timestamp desc.
  const sorted = [...detail.tool_calls]
    .map((tc) => ({ tc, ts: Date.parse(tc.timestamp) }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => b.ts - a.ts);

  // Combo = trailing tool calls whose adjacent gap is < WORKSHOP_BURST_MS.
  let combo = 1;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (!a || !b) break;
    if (a.ts - b.ts <= WORKSHOP_BURST_MS) combo += 1;
    else break;
  }
  if (sorted.length === 0) combo = 0;

  let errorCount = 0;
  for (const tc of detail.tool_calls) {
    if (looksLikeError(tc.args_summary)) errorCount += 1;
  }
  const errorRate = detail.tool_calls.length
    ? errorCount / detail.tool_calls.length
    : 0;

  const lastTs = sorted[0]?.ts ?? 0;
  const fresh = now - lastTs <= WORKSHOP_BURST_MS;

  let color: RoomColor;
  if (errorCount >= 3) color = "red";
  else if (errorRate > 0.15 || errorCount >= 1) color = "orange";
  else if (fresh && combo >= 2) color = "yellow";
  else color = "green";

  const recent = sorted
    .slice(0, 3)
    .map((x) => x.tc.name);
  const details: string[] = [
    combo >= 2 ? `Combo x${combo}` : "No active combo",
    recent.length > 0 ? `Recent: ${recent.join(" · ")}` : "No recent tools",
    `Errors: ${errorCount} / ${detail.tool_calls.length}`,
  ];

  return {
    kind: "workshop",
    color,
    label: roomLabel("workshop", color, combo),
    emoji: "🔨",
    title: "Workshop (Tool Exec)",
    details,
  };
}

function assessLibrary(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): RoomAssessment {
  // Hunger need = 100 - usage*100 — recover usage from there if we have it;
  // otherwise fall back to messages / HUNGER_FULL_MESSAGES.
  const hunger = card.needs.find((n) => n.key === "hunger")?.value;
  let usage: number;
  if (hunger !== undefined) {
    usage = Math.max(0, Math.min(100, 100 - hunger));
  } else {
    const msgs = detail?.messages.length ?? 0;
    usage = Math.min(100, Math.round((msgs / HUNGER_FULL_MESSAGES) * 100));
  }

  let color: RoomColor;
  if (usage >= 95) color = "red";
  else if (usage >= 80) color = "orange";
  else if (usage >= 60) color = "yellow";
  else color = "green";

  const details: string[] = [
    `Context: ${usage}% used`,
    detail
      ? `${detail.messages.length} messages indexed`
      : "Messages loading…",
  ];

  return {
    kind: "library",
    color,
    label: roomLabel("library", color),
    emoji: "📚",
    title: "Library (Memory)",
    details,
  };
}

function assessNursery(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
  now: number,
): RoomAssessment {
  const children = getChildSessions(card, allCards);
  if (children.length === 0) {
    return {
      kind: "nursery",
      color: "gray",
      label: "Empty",
      emoji: "🍼",
      title: "Nursery (Spawn)",
      details: ["No children", "Solo resident"],
    };
  }
  const activeWindow = 5 * 60 * 1000; // 5m
  const active = children.filter((c) => now - c.lastActiveAt <= activeWindow);
  const color: RoomColor =
    active.length === children.length ? "green" : "yellow";

  const details: string[] = [
    `${children.length} ${children.length === 1 ? "child" : "children"} · ${active.length} active`,
  ];
  // List up to 3 children compactly: short id + agent.
  for (const c of children.slice(0, 3)) {
    const shortId = c.sessionId.slice(0, 8);
    const dot = now - c.lastActiveAt <= activeWindow ? "●" : "○";
    details.push(`${dot} ${c.sessionType}@${shortId}…`);
  }
  if (children.length > 3) details.push(`+${children.length - 3} more`);

  return {
    kind: "nursery",
    color,
    label: roomLabel("nursery", color, children.length),
    emoji: "🍼",
    title: "Nursery (Spawn)",
    details,
  };
}

function assessTrophy(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): RoomAssessment {
  const trophies = computeTrophies(card, detail);
  const details = trophies.map((t) => `${t.label}: ${t.value}`);
  if (details.length === 0) details.push("No achievements yet");
  return {
    kind: "trophy",
    color: "green",
    label: "Showcase",
    emoji: "🏆",
    title: "Trophy Room",
    details,
  };
}

function roomLabel(kind: RoomKind, color: RoomColor, n?: number): string {
  if (color === "gray") {
    if (kind === "nursery") return "Empty";
    return "Quiet";
  }
  if (kind === "workshop") {
    if (color === "red") return "Critical";
    if (color === "orange") return "Warning";
    if (color === "yellow") return n && n >= 2 ? `Busy x${n}` : "Busy";
    return "Healthy";
  }
  if (kind === "library") {
    if (color === "red") return "Overflow";
    if (color === "orange") return "Filling";
    if (color === "yellow") return "Moderate";
    return "Spacious";
  }
  if (kind === "nursery") {
    if (color === "yellow") return `${n ?? 0} children · partial`;
    return `${n ?? 0} children · all active`;
  }
  if (kind === "living") {
    if (color === "red") return "Silent";
    if (color === "orange") return "Idle";
    if (color === "yellow") return "Thinking";
    return "Active";
  }
  return "OK";
}

// ---------------------------------------------------------------------------
// Vitals
// ---------------------------------------------------------------------------

export function computeVitals(
  card: SimCardModel,
  detail: SessionDetail | undefined,
  now: number,
): Vitals {
  let msgPerMin = 0;
  let toolPerMin = 0;
  if (detail) {
    let recentMsgs = 0;
    for (const m of detail.messages) {
      const ts = Date.parse(m.timestamp);
      if (!Number.isFinite(ts)) continue;
      if (now - ts <= VITAL_WINDOW_MS) recentMsgs += 1;
    }
    let recentTools = 0;
    for (const tc of detail.tool_calls) {
      const ts = Date.parse(tc.timestamp);
      if (!Number.isFinite(ts)) continue;
      if (now - ts <= VITAL_WINDOW_MS) recentTools += 1;
    }
    const windowMin = VITAL_WINDOW_MS / 60_000;
    msgPerMin = recentMsgs / windowMin;
    toolPerMin = recentTools / windowMin;
  }

  // Context usage from the Library room's input — reuse hunger when possible.
  const hunger = card.needs.find((n) => n.key === "hunger")?.value ?? 100;
  const ctxRatio = Math.max(0, Math.min(1, (100 - hunger) / 100));

  // Error rate from hygiene need (1 - hyg/100).
  const hyg = card.needs.find((n) => n.key === "hygiene")?.value ?? 100;
  const errorRate = Math.max(0, Math.min(1, (100 - hyg) / 100));

  // Comfort 0..100 — invert into a 0..1 discomfort signal.
  const comfort = card.needs.find((n) => n.key === "comfort")?.value ?? 75;
  const discomfort = Math.max(0, Math.min(1, (100 - comfort) / 100));

  return {
    heartRate: Math.round(msgPerMin * 12),
    breathRate: Math.round(toolPerMin),
    temperature: Math.round((36 + ctxRatio * 5) * 10) / 10,
    bpSystolic: Math.round(100 + errorRate * 100),
    bpDiastolic: Math.round(60 + discomfort * 50),
  };
}

// ---------------------------------------------------------------------------
// Children / Parent
// ---------------------------------------------------------------------------

export function getChildSessions(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
): SimCardModel[] {
  const out: SimCardModel[] = [];
  for (const c of allCards) {
    if (c.parentSessionId === card.sessionId) out.push(c);
  }
  // Newest-first so the freshest spawn lands at the top of the list.
  out.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return out;
}

export function getParentSession(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
): SimCardModel | null {
  if (!card.parentSessionId) return null;
  for (const c of allCards) {
    if (c.sessionId === card.parentSessionId) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Babble / Action queue
// ---------------------------------------------------------------------------

export function getRecentBabble(
  detail: SessionDetail | undefined,
  limit = 3,
  maxLen = 100,
): BabbleLine[] {
  if (!detail) return [];
  const conversational = detail.messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  // Sort oldest→newest, then take the trailing `limit` so the oldest of the
  // recent window appears first (reads like a conversation excerpt).
  const sorted = [...conversational].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
  const tail = sorted.slice(-limit);
  return tail.map((m) => ({
    role: m.role,
    content: truncate(m.text, maxLen),
  }));
}

export function extractActionQueue(
  detail: SessionDetail | undefined,
  limit = 5,
): string[] | null {
  if (!detail) return null;
  // Find the most recent assistant message and scan it for bullet / numbered
  // / checkbox lines. We deliberately don't try to be smart about nested
  // structures — the goal is a glance, not a full TodoWrite parse.
  const assistant = [...detail.messages]
    .filter((m) => m.role === "assistant")
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  for (const m of assistant) {
    const lines = m.text.split(/\r?\n/);
    const items: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      // - [ ] foo / - [x] foo / 1. foo / 2) foo / - foo / * foo
      const m1 = line.match(/^[-*]\s+\[\s?[xX]?\s?\]\s+(.+)$/);
      if (m1?.[1]) {
        items.push(m1[1]);
        continue;
      }
      const m2 = line.match(/^(\d+)[.)]\s+(.+)$/);
      if (m2?.[2]) {
        items.push(m2[2]);
        continue;
      }
      const m3 = line.match(/^[-*]\s+(.+)$/);
      if (m3?.[1] && items.length > 0) {
        // Only count bare bullets when we've already seen a structured item
        // — avoids treating ordinary prose dashes as todos.
        items.push(m3[1]);
      }
    }
    if (items.length >= 2) {
      return items.slice(0, limit).map((s) => truncate(s, 120));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trophies
// ---------------------------------------------------------------------------

export function computeTrophies(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): Trophy[] {
  const out: Trophy[] = [];
  if (detail) {
    const distinct = new Set(detail.tool_calls.map((tc) => tc.name)).size;
    if (distinct > 0) out.push({ label: "Tool variety", value: `${distinct}` });

    // Best combo = longest run of tool calls whose adjacent gap ≤ WORKSHOP_BURST_MS.
    const sorted = [...detail.tool_calls]
      .map((tc) => Date.parse(tc.timestamp))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    let best = sorted.length > 0 ? 1 : 0;
    let run = sorted.length > 0 ? 1 : 0;
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
    if (best > 0) out.push({ label: "Best combo", value: `x${best}` });

    // Fastest reply — min user→assistant gap.
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
    if (Number.isFinite(fastest)) {
      out.push({
        label: "Fastest reply",
        value: fastest < 1000 ? `${fastest}ms` : `${(fastest / 1000).toFixed(1)}s`,
      });
    }
  }
  out.push({ label: "Life-stage", value: card.stage.label });
  return out;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function looksLikeError(blob: string | null | undefined): boolean {
  if (!blob) return false;
  return /\b(error|failed|exception|traceback)\b/i.test(blob);
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** Map RoomColor → css color used by the UI. */
export function roomColorCss(c: RoomColor): string {
  switch (c) {
    case "green":
      return "hsl(140, 55%, 50%)";
    case "yellow":
      return "hsl(45, 80%, 55%)";
    case "orange":
      return "hsl(25, 80%, 55%)";
    case "red":
      return "hsl(0, 70%, 55%)";
    case "gray":
      return "var(--color-border)";
  }
}

/** Map RoomColor → status dot emoji. */
export function roomColorDot(c: RoomColor): string {
  switch (c) {
    case "green":
      return "🟢";
    case "yellow":
      return "🟡";
    case "orange":
      return "🟠";
    case "red":
      return "🔴";
    case "gray":
      return "⚪";
  }
}

export const ROOM_ORDER: readonly RoomKind[] = [
  "living",
  "workshop",
  "library",
  "study",
  "nursery",
  "reception",
  "trophy",
] as const;
