// Hamlet — Particle systems & dynamic life helpers.
//
// Pure data-generation utilities for richness-pass #2: walking sims, season
// particles, weather effects, event bursts, dynamic room residency, and
// accessory derivation from skill levels.
//
// All functions are side-effect-free and deterministic given their inputs.
// Component rendering happens in `_components/fleet-hamlet-particles.tsx`.

import type { SessionDetail } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";
import { hashStringToInt } from "./fleet-hamlet";
import type { RoomKind } from "./fleet-hamlet-house";
import { computeSkills, topSkills } from "./fleet-hamlet-skills";

// ---------------------------------------------------------------------------
// Seasons — derived from the local month
// ---------------------------------------------------------------------------

export type Season = "spring" | "summer" | "autumn" | "winter";

export function currentSeason(date: Date = new Date()): Season {
  const m = date.getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter";
}

// ---------------------------------------------------------------------------
// Walking sims — pick 2..4 cards to wander on the road
// ---------------------------------------------------------------------------

export interface WalkingSimSpec {
  /** Reference back to the originating sim so we can color it. */
  sim: SimCardModel;
  /** 0..1 — relative starting offset in the walk cycle. */
  startOffset: number;
  /** ms — full traversal duration (left → right). */
  durationMs: number;
  /** px from top of the street band. */
  topPx: number;
  /** 1=L→R, -1=R→L (flip via CSS). */
  direction: 1 | -1;
}

export function pickWalkingSims(
  cards: readonly SimCardModel[],
  now: number,
  count = 3,
  groundHeight = 120,
): WalkingSimSpec[] {
  if (cards.length === 0) return [];
  // Prefer active (recent) cards; fall back to whatever exists. Sort by
  // most-recent activity, then deterministic by key so the picks are stable
  // across renders even when `now` ticks forward.
  const ranked = [...cards].sort((a, b) => {
    const da = now - a.lastActiveAt;
    const db = now - b.lastActiveAt;
    if (da !== db) return da - db;
    return hashStringToInt(a.key) - hashStringToInt(b.key);
  });
  const picks = ranked.slice(0, Math.min(count, ranked.length));
  return picks.map((sim, i) => {
    const seed = hashStringToInt(sim.key);
    return {
      sim,
      startOffset: (seed % 100) / 100,
      durationMs: 26_000 + (seed % 14_000),
      topPx: Math.max(8, (groundHeight * 0.35) + ((seed * 7) % Math.max(8, groundHeight * 0.55))),
      direction: (i % 2 === 0 ? 1 : -1) as 1 | -1,
    };
  });
}

// ---------------------------------------------------------------------------
// Season particles — deterministic seeded array of fall+sway pieces
// ---------------------------------------------------------------------------

export interface FallingPiece {
  id: number;
  xPct: number;
  delay: number;
  duration: number;
  scale: number;
  sway: number;
  hue: number;
}

export function seasonParticles(
  season: Season,
  count: number,
  seed: number,
): FallingPiece[] {
  const out: FallingPiece[] = [];
  for (let i = 0; i < count; i++) {
    const k = (seed + i * 131) >>> 0;
    const xPct = (k * 13) % 100;
    const hue = pickSeasonHue(season, k);
    out.push({
      id: i,
      xPct,
      delay: -((k % 80) / 10),
      duration: 8 + ((k * 3) % 9),
      scale: 0.7 + ((k * 5) % 50) / 100,
      sway: 6 + ((k * 7) % 14),
      hue,
    });
  }
  return out;
}

function pickSeasonHue(season: Season, k: number): number {
  if (season === "spring") return 330 + (k % 25); // pinks / sakura
  if (season === "autumn") {
    const palette = [18, 28, 38, 6, 12]; // oranges / reds / yellows
    return palette[k % palette.length] ?? 28;
  }
  if (season === "summer") return 110 + (k % 30); // green-yellow drift (rare)
  return 210 + (k % 20); // snowflakes — bluish white, used as base hue marker
}

// ---------------------------------------------------------------------------
// Rain droplets — for stormy weather
// ---------------------------------------------------------------------------

export interface RainDrop {
  id: number;
  xPct: number;
  delay: number;
  duration: number;
  length: number;
}

export function rainDrops(count: number, width: number): RainDrop[] {
  const out: RainDrop[] = [];
  for (let i = 0; i < count; i++) {
    const k = (i * 977 + 17) >>> 0;
    out.push({
      id: i,
      xPct: (k * 11) % 100,
      delay: -((k % 70) / 100),
      duration: 0.7 + ((k % 60) / 100),
      length: 10 + ((k * 3) % 14),
    });
  }
  // width unused for now but kept in signature for future per-px scaling.
  void width;
  return out;
}

// ---------------------------------------------------------------------------
// Lightning — fires every N seconds via CSS keyframes
// ---------------------------------------------------------------------------

export interface LightningBolt {
  /** Animation delay seconds — staggers multiple bolts. */
  delay: number;
  /** Animation duration in seconds — one full flash + dark cycle. */
  cycle: number;
}

export function lightningBolts(seed: number, count = 1): LightningBolt[] {
  const out: LightningBolt[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      delay: -((seed + i * 37) % 13),
      cycle: 8 + ((seed * 3 + i * 5) % 6),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Active-room detection — for the House Plan mini-avatar
// ---------------------------------------------------------------------------

export function selectActiveRoom(
  detail: SessionDetail | undefined,
  card: SimCardModel,
  now: number,
): RoomKind {
  if (detail) {
    // Latest tool call within 2m → Workshop.
    let latestToolTs = 0;
    for (const tc of detail.tool_calls) {
      const t = Date.parse(tc.timestamp);
      if (Number.isFinite(t) && t > latestToolTs) latestToolTs = t;
    }
    if (latestToolTs > 0 && now - latestToolTs <= 2 * 60 * 1000) {
      return "workshop";
    }
    // Latest message within 1m → Living.
    let latestMsgTs = 0;
    for (const m of detail.messages) {
      const t = Date.parse(m.timestamp);
      if (Number.isFinite(t) && t > latestMsgTs) latestMsgTs = t;
    }
    if (latestMsgTs > 0 && now - latestMsgTs <= 60 * 1000) {
      return "living";
    }
  }
  // Spawn-like card (has a parent) → Nursery; otherwise Library by default.
  if (card.parentSessionId) return "nursery";
  return "library";
}

// ---------------------------------------------------------------------------
// Accessories — derived from a sim's top skills
// ---------------------------------------------------------------------------

export type HatKind = "scholar" | "cap" | "tophat" | "none";

export interface Accessories {
  /** Lv 7+ → an agent-specific hat. */
  hat: HatKind;
  /** Lv 10 (Master) anywhere → crown. */
  crown: boolean;
  /** Optional badge text — first language at Lv 7+. */
  badge: string | null;
}

export function deriveAccessories(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): Accessories {
  const skills = computeSkills(card, detail);
  if (skills.length === 0) {
    return { hat: "none", crown: false, badge: null };
  }
  const tops = topSkills(skills, 4);
  const top = tops[0];
  if (!top) {
    return { hat: "none", crown: false, badge: null };
  }
  const maxLevel = top.level;
  const crown = maxLevel >= 10;
  const hat: HatKind =
    maxLevel >= 7
      ? card.sessionType === "claude"
        ? "scholar"
        : card.sessionType === "codex"
        ? "cap"
        : card.sessionType === "antigravity"
        ? "tophat"
        : "scholar"
      : "none";
  // Pick the highest-level lang/tool skill at Lv 7+ for a 2-char badge.
  const badgeSkill = tops.find((s) => s.level >= 7 && (s.kind === "lang" || s.kind === "tool"));
  const badge = badgeSkill ? badgeSkill.icon : null;
  return { hat, crown, badge };
}
