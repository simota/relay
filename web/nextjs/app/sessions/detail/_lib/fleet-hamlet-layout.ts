// Hamlet — Neighborhood layout helpers.
//
// Given the Sim cards built by `fleet-hamlet.ts`, this module decides which
// residents live on the main street vs. the idle "park" cul-de-sac, what
// hue their roof is (a function of their repo), what subtle hue shift their
// walls take (a function of the agent kind), how big the house renders
// (function of recent activity), and what the village-wide weather looks
// like (function of aggregate error rate).
//
// All functions are pure and deterministic — the same input set always
// produces the same layout so successive renders don't jitter houses
// across the screen.

import type { SimCardModel } from "./fleet-hamlet";
import { hashStringToInt } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Active vs. Park split
// ---------------------------------------------------------------------------

/** Sessions that haven't moved within this window go to the park. */
export const PARK_SILENCE_MS = 60 * 60 * 1000; // 1h

export interface HamletZones {
  /** Recently-active residents — placed on the main street grid. */
  active: SimCardModel[];
  /** Idle residents — placed in the park footer band. */
  park: SimCardModel[];
}

export function assignHouseholdZones(
  cards: readonly SimCardModel[],
  now: number,
): HamletZones {
  const active: SimCardModel[] = [];
  const park: SimCardModel[] = [];
  for (const c of cards) {
    const silenceMs = Math.max(0, now - c.lastActiveAt);
    if (silenceMs >= PARK_SILENCE_MS) {
      park.push(c);
    } else {
      active.push(c);
    }
  }
  // Stable ordering: hash the key so the same set always sorts the same way
  // regardless of stream-arrival order.
  const byHash = (a: SimCardModel, b: SimCardModel) =>
    hashStringToInt(a.key) - hashStringToInt(b.key);
  active.sort(byHash);
  park.sort(byHash);
  return { active, park };
}

// ---------------------------------------------------------------------------
// Roof / wall colors
// ---------------------------------------------------------------------------

/**
 * Map a repo name to a stable hue (0–359). Sessions sharing a repo land on
 * the same color roof so the user can spot "which family lives where" at a
 * glance.
 */
export function hashRepoToHue(repoName: string | null | undefined): number {
  if (!repoName) return 210; // muted blue fallback for the "no repo" tribe
  return hashStringToInt(repoName) % 360;
}

/**
 * Per-agent hue shift on the walls so a Claude house and a Codex house in
 * the same repo are still distinguishable. Returned in degrees and meant
 * to be added to the roof hue.
 *   claude  → cool tilt (blue lean)
 *   codex   → warm tilt (green lean)
 *   agy     → violet tilt (antigravity)
 */
export function agentHueShift(
  agentKind: SimCardModel["sessionType"] | undefined,
): number {
  switch (agentKind) {
    case "claude":
      return -20;
    case "codex":
      return 30;
    case "antigravity":
      return 60;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Weather — village-wide error rate
// ---------------------------------------------------------------------------

export type WeatherKind = "clear" | "partly" | "cloudy" | "stormy";

export interface WeatherInfo {
  kind: WeatherKind;
  emoji: string;
  label: string;
}

const WEATHER_TABLE: Record<WeatherKind, WeatherInfo> = {
  clear: { kind: "clear", emoji: "☀", label: "Clear" },
  partly: { kind: "partly", emoji: "🌤", label: "Partly Cloudy" },
  cloudy: { kind: "cloudy", emoji: "☁", label: "Cloudy" },
  stormy: { kind: "stormy", emoji: "⛈", label: "Stormy" },
};

export function computeWeather(cards: readonly SimCardModel[]): WeatherInfo {
  if (cards.length === 0) return WEATHER_TABLE.clear;
  // Hygiene = 100 - errorRate * 100 (from buildSim). Recover the error rate
  // by averaging (100 - hygiene) / 100.
  let sum = 0;
  let n = 0;
  for (const c of cards) {
    const hyg = c.needs.find((nx) => nx.key === "hygiene");
    if (!hyg) continue;
    sum += (100 - hyg.value) / 100;
    n += 1;
  }
  if (n === 0) return WEATHER_TABLE.clear;
  const avg = sum / n;
  if (avg < 0.05) return WEATHER_TABLE.clear;
  if (avg < 0.15) return WEATHER_TABLE.partly;
  if (avg < 0.3) return WEATHER_TABLE.cloudy;
  return WEATHER_TABLE.stormy;
}

// ---------------------------------------------------------------------------
// House size — activity score
// ---------------------------------------------------------------------------

export type HouseSize = "sm" | "md" | "lg";

/**
 * Houses grow with how much the resident has been doing. The proxy is the
 * message_count-driven hunger need: full pantry (high hunger value, i.e.
 * low usage) ⇒ small house; depleted (high usage) ⇒ large house. Tweaked
 * to coexist with Energy so prolonged sessions also look bigger.
 */
export function houseSizeFromActivity(card: SimCardModel): HouseSize {
  const hunger = card.needs.find((n) => n.key === "hunger")?.value ?? 100;
  const energy = card.needs.find((n) => n.key === "energy")?.value ?? 100;
  // "Activity" rises as hunger and energy decrease (resident is older +
  // has eaten more context). 0..200; thresholds picked so the population
  // doesn't all collapse into one bucket.
  const activity = 100 - hunger + (100 - energy);
  if (activity < 60) return "sm";
  if (activity < 140) return "md";
  return "lg";
}

// ---------------------------------------------------------------------------
// Mood frequency — used by HUD "dominant mood" indicator
// ---------------------------------------------------------------------------

export interface DominantMood {
  emoji: string;
  label: string;
  count: number;
}

export function dominantMood(cards: readonly SimCardModel[]): DominantMood | null {
  if (cards.length === 0) return null;
  const tally = new Map<string, { emoji: string; label: string; count: number }>();
  for (const c of cards) {
    const k = c.mood.key;
    const cur = tally.get(k);
    if (cur) cur.count += 1;
    else tally.set(k, { emoji: c.mood.emoji, label: c.mood.label, count: 1 });
  }
  let best: DominantMood | null = null;
  for (const v of tally.values()) {
    if (!best || v.count > best.count) best = v;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Grid placement — deterministic (col, row) per card
// ---------------------------------------------------------------------------

export interface GridSlot {
  col: number;
  row: number;
}

/**
 * Deterministic placement: sort by hash, then drop into row-major order.
 * Caller picks `cols` based on viewport width.
 */
export function assignGridSlots(
  cards: readonly SimCardModel[],
  cols: number,
): Map<string, GridSlot> {
  const out = new Map<string, GridSlot>();
  cards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.set(c.key, { col, row });
  });
  return out;
}
