// Hamlet Rooms — Room Rankings / 称号バッジ (軸2).
//
// Computes a single "most characteristic" title per sim from the last 24 h of
// metrics. Pure, deterministic — no React, no side effects.

import type { SessionDetail } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";
import { detectEvents } from "./fleet-hamlet-events";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RoomTitle {
  emoji: string;
  label: string;
  /** Higher = shown first in priority sort. */
  priority: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assigns at most one title per sim. Titles that require exclusive ownership
 * (MVP, 黒帯, 電光石火, 星の探検家) are assigned to the sim that qualifies
 * best and skipped for all others. Non-exclusive titles (💎, 🎨, 📚) can be
 * held by any number of sims simultaneously.
 */
export function computeRoomTitles(
  sims: readonly SimCardModel[],
  details: ReadonlyMap<string, SessionDetail>,
  now: number,
): Map<string, RoomTitle> {
  if (sims.length === 0) return new Map();

  // -------------------------------------------------------------------------
  // Pre-compute per-sim metrics
  // -------------------------------------------------------------------------

  interface SimMetrics {
    key: string;
    achievementCount: number;
    toolCallCount: number;
    readGrepRatio: number;
    messageCount: number;
    bornAt: number;
    sessionType: SimCardModel["sessionType"];
    hasAchievement: boolean;
    messLevel: number;
  }

  const metrics: SimMetrics[] = sims.map((sim) => {
    const detail = details.get(sim.key);
    const toolCalls = detail?.tool_calls ?? [];
    const messages = detail?.messages ?? [];

    // Achievement count — only events from last 24h
    const events = detectEvents(sim, detail, sims, now);
    const achievementCount = events.filter(
      (e) =>
        e.kind === "achievement" &&
        e.timestamp >= now - WINDOW_24H_MS,
    ).length;

    // Tool call metrics
    const toolCallCount = toolCalls.length;
    const readGrepCount = toolCalls.filter(
      (tc) => tc.name === "Read" || tc.name === "Grep" || tc.name === "Glob",
    ).length;
    const readGrepRatio =
      toolCallCount > 0 ? readGrepCount / toolCallCount : 0;

    // Mess level: 0 = clean (no error-ish tool calls, few tool calls overall)
    const errorCount = toolCalls.filter(
      (tc) =>
        tc.args_summary !== undefined &&
        /\b(error|failed|exception)\b/i.test(tc.args_summary),
    ).length;
    const messLevel = errorCount + Math.max(0, toolCallCount - 5);

    return {
      key: sim.key,
      achievementCount,
      toolCallCount,
      readGrepRatio,
      messageCount: messages.length,
      bornAt: sim.bornAt,
      sessionType: sim.sessionType,
      hasAchievement: achievementCount > 0,
      messLevel,
    };
  });

  const avgToolCalls =
    metrics.reduce((s, m) => s + m.toolCallCount, 0) / metrics.length;
  const avgMessages =
    metrics.reduce((s, m) => s + m.messageCount, 0) / metrics.length;

  // -------------------------------------------------------------------------
  // Exclusive titles — awarded to exactly one sim (best-qualifies first)
  // -------------------------------------------------------------------------

  const assigned = new Map<string, RoomTitle>();

  // 🏆 "今日のMVP" — most achievements
  const mvpKey = argMax(
    metrics.filter((m) => m.achievementCount > 0),
    (m) => m.achievementCount,
  )?.key;
  if (mvpKey) {
    assigned.set(mvpKey, { emoji: "🏆", label: "今日のMVP", priority: 10 });
  }

  // 🥋 "コード黒帯" — most tool_calls
  const blackBeltKey = argMax(
    metrics.filter((m) => m.toolCallCount > 0),
    (m) => m.toolCallCount,
  )?.key;
  if (blackBeltKey && !assigned.has(blackBeltKey)) {
    assigned.set(blackBeltKey, {
      emoji: "🥋",
      label: "コード黒帯",
      priority: 9,
    });
  }

  // ⚡ "電光石火" — codex with above-average tool_calls
  const lightningKey = argMax(
    metrics.filter(
      (m) =>
        m.sessionType === "codex" && m.toolCallCount > avgToolCalls,
    ),
    (m) => m.toolCallCount,
  )?.key;
  if (lightningKey && !assigned.has(lightningKey)) {
    assigned.set(lightningKey, {
      emoji: "⚡",
      label: "電光石火",
      priority: 7,
    });
  }

  // 🌌 "星の探検家" — antigravity with above-average messages
  const explorerKey = argMax(
    metrics.filter(
      (m) =>
        m.sessionType === "antigravity" && m.messageCount > avgMessages,
    ),
    (m) => m.messageCount,
  )?.key;
  if (explorerKey && !assigned.has(explorerKey)) {
    assigned.set(explorerKey, {
      emoji: "🌌",
      label: "星の探検家",
      priority: 7,
    });
  }

  // 🌙 "夜更かし王" — oldest bornAt
  const founderKey = argMin(
    metrics,
    (m) => m.bornAt,
  )?.key;
  if (founderKey && !assigned.has(founderKey)) {
    assigned.set(founderKey, {
      emoji: "🌙",
      label: "夜更かし王",
      priority: 6,
    });
  }

  // -------------------------------------------------------------------------
  // Non-exclusive titles — any qualifying sim gets one (unless already assigned)
  // -------------------------------------------------------------------------

  for (const m of metrics) {
    if (assigned.has(m.key)) continue;

    // 💎 "宝石コーダー" — claude + at least one achievement
    if (m.sessionType === "claude" && m.hasAchievement) {
      assigned.set(m.key, { emoji: "💎", label: "宝石コーダー", priority: 8 });
      continue;
    }

    // 🎨 "整理整頓" — mess level === 0 (clean, quiet session)
    if (m.messLevel === 0 && m.toolCallCount === 0) {
      assigned.set(m.key, { emoji: "🎨", label: "整理整頓", priority: 4 });
      continue;
    }

    // 📚 "読書家" — read/grep ratio ≥ 60 % (at least 3 read-type calls)
    if (
      m.readGrepRatio >= 0.6 &&
      m.toolCallCount >= 3
    ) {
      assigned.set(m.key, { emoji: "📚", label: "読書家", priority: 5 });
      continue;
    }
  }

  return assigned;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function argMax<T>(
  arr: T[],
  fn: (item: T) => number,
): T | null {
  if (arr.length === 0) return null;
  let best = arr[0];
  if (!best) return null;
  let bestScore = fn(best);
  for (let i = 1; i < arr.length; i++) {
    const item = arr[i];
    if (!item) continue;
    const score = fn(item);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

function argMin<T>(
  arr: T[],
  fn: (item: T) => number,
): T | null {
  if (arr.length === 0) return null;
  let best = arr[0];
  if (!best) return null;
  let bestScore = fn(best);
  for (let i = 1; i < arr.length; i++) {
    const item = arr[i];
    if (!item) continue;
    const score = fn(item);
    if (score < bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}
