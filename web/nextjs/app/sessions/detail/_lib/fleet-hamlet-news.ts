// Hamlet — Village news ticker (軸A).
//
// Generates newspaper-style headlines from the current village state.
// Pure function, no React, no side-effects.

import type { SimCardModel } from "./fleet-hamlet";
import type { LifeEvent } from "./fleet-hamlet-events";
import type { Season } from "./fleet-hamlet-particles";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Headline {
  id: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose 5–8 headlines from the current village snapshot.
 * Returns only the headlines that have something meaningful to say;
 * null-returning axes are simply skipped.
 */
export function composeVillageHeadlines(
  sims: readonly SimCardModel[],
  events: readonly LifeEvent[],
  now: number,
  season: Season,
): Headline[] {
  const out: Headline[] = [];

  // Festival — multiple celebration events in the past 1h trigger a
  // village-wide festival headline (軸A).
  const festiveKinds = new Set(["achievement", "birthday", "baby", "wedding"]);
  const oneHourAgoForFestival = now - 60 * 60 * 1000;
  const recentFestiveEvents = events.filter(
    (e) => festiveKinds.has(e.kind) && e.timestamp >= oneHourAgoForFestival,
  );
  if (recentFestiveEvents.length >= 2) {
    out.push({
      id: "festival",
      text: `🎉 今日は村全体の祭り! 過去1hで ${recentFestiveEvents.length}件の慶事`,
    });
  }

  // Founder — oldest non-archived (bornAt most in the past) active resident.
  const founder = findFounder(sims, now);
  if (founder) {
    const hoursAlive = Math.floor((now - founder.bornAt) / (1000 * 60 * 60));
    const label = founder.repo ?? founder.agentId ?? founder.sessionId.slice(0, 8);
    out.push({
      id: "founder",
      text: `📰 創設者 ${label} が ${hoursAlive}時間連続稼働中`,
    });
  }

  // Achievement burst — count achievement events in the last 1h.
  const oneHourAgo = now - 60 * 60 * 1000;
  const recentAchievements = events.filter(
    (e) => e.kind === "achievement" && e.timestamp >= oneHourAgo,
  );
  if (recentAchievements.length > 0) {
    out.push({
      id: "achievements",
      text: `⚡ 過去1時間で ${recentAchievements.length}個の達成が連続発生`,
    });
  }

  // Active count (past 5 minutes).
  const fiveMinAgo = now - 5 * 60 * 1000;
  const activeCount = sims.filter((s) => s.lastActiveAt >= fiveMinAgo).length;
  if (activeCount > 0) {
    out.push({
      id: "busy",
      text: `📈 ${activeCount}世帯が同時稼働中`,
    });
  } else {
    out.push({
      id: "quiet",
      text: `🌙 全住民が休息中 — 村は静まり返っている`,
    });
  }

  // Season flavor.
  const seasonHeadline = seasonText(season);
  if (seasonHeadline) {
    out.push({ id: "season", text: seasonHeadline });
  }

  // Quest completions in the last 1h.
  const recentQuests = events.filter(
    (e) => e.kind === "quest" && e.timestamp >= oneHourAgo,
  );
  if (recentQuests.length > 0) {
    out.push({
      id: "quests",
      text: `🎯 ${recentQuests.length}件のクエストがクリアされた`,
    });
  }

  // New births (baby events) in the last 1h.
  const recentBabies = events.filter(
    (e) => e.kind === "baby" && e.timestamp >= oneHourAgo,
  );
  if (recentBabies.length > 0) {
    out.push({
      id: "babies",
      text: `👶 ${recentBabies.length}件の新セッションが誕生`,
    });
  }

  // Village size milestone.
  const totalHouseholds = sims.length;
  if (totalHouseholds >= 10) {
    out.push({
      id: "milestone",
      text: `🏘️ 村の世帯数が ${totalHouseholds}件に達している`,
    });
  }

  return out.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the oldest non-archived sim (most ancient bornAt that is still active).
 * "Archived" proxy: lastActiveAt more than 7 days ago.
 */
function findFounder(
  sims: readonly SimCardModel[],
  now: number,
): SimCardModel | null {
  const ARCHIVE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
  let oldest: SimCardModel | null = null;
  for (const s of sims) {
    // Skip likely-archived sims.
    if (now - s.lastActiveAt > ARCHIVE_THRESHOLD_MS) continue;
    if (!oldest || s.bornAt < oldest.bornAt) oldest = s;
  }
  return oldest;
}

function seasonText(season: Season): string | null {
  switch (season) {
    case "spring":
      return "🌸 桜の季節、村は華やかに彩られている";
    case "summer":
      return "☀️ 夏の陽射しが村に活気をもたらしている";
    case "autumn":
      return "🍁 紅葉の季節、村は深まる色に包まれている";
    case "winter":
      return "❄️ 雪の季節、村は静かな白に覆われている";
  }
}
