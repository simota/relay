// Fleet Hamlet — Room Inspector descriptors.
//
// Each room object is a "live readout" of some part of the session state.
// This module turns a clickable object id + the derived room context into a
// short human-readable description so the Room Scene can pop an inspector
// card explaining *what the object means and what it currently says about
// the resident*.
//
// Pure: takes already-derived values; no React, no API calls.

import type { SessionDetail } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";
import type { Bustle } from "./fleet-hamlet-bustle";
import type { RoomKind } from "./fleet-hamlet-house";
import type { RoomState } from "./fleet-hamlet-room-state";
import type { AchievementBundle, RelationshipFrame } from "./fleet-hamlet-room-life";
import type { PetBundle } from "./fleet-hamlet-room-companion";
import type { ContainerContents } from "./fleet-hamlet-room-containers";
import type { TemporalDecor } from "./fleet-hamlet-room-temporal";
import type { RoomGuest } from "./fleet-hamlet-room-guests";
import type { WindowScene } from "./fleet-hamlet-room-window";

export type RoomObjectId =
  | { kind: "room-kind" }
  | { kind: "furniture" }
  | { kind: "tool" }
  | { kind: "whiteboard" }
  | { kind: "mess" }
  | { kind: "events" }
  | { kind: "achievements" }
  | { kind: "trophy" }
  | { kind: "crown" }
  | { kind: "carpet" }
  | { kind: "frames" }
  | { kind: "pets" }
  | { kind: "mood-wall" }
  | { kind: "bookshelf" }
  | { kind: "fridge" }
  | { kind: "season" }
  | { kind: "meal" }
  | { kind: "christmas-tree" }
  | { kind: "window-scene" }
  | { kind: "guests" }
  | { kind: "visitor" }
  | { kind: "bustle-banner" }
  | { kind: "lamp" }
  | { kind: "window" };

export interface RoomInspectorContext {
  card: SimCardModel;
  detail: SessionDetail | undefined;
  roomKind: RoomKind;
  now: number;
  roomState: RoomState;
  achievements: AchievementBundle;
  frames: readonly RelationshipFrame[];
  petBundle: PetBundle;
  containerContents: ContainerContents;
  temporal: TemporalDecor;
  windowScene: WindowScene;
  bustle: Bustle;
  guests: readonly RoomGuest[];
  hasRecentUserMessage: boolean;
  /** True when the lamp / night-tint layer is rendering. */
  isDark: boolean;
}

export interface RoomInspectorEntry {
  /** Short label shown at the top of the inspector. */
  title: string;
  /** One-line summary of what this object represents. */
  summary: string;
  /** Bullet lines with the *current value* observed from the session. */
  details: string[];
}

const ROOM_KIND_LABEL: Record<RoomKind, string> = {
  living: "Living room",
  workshop: "Workshop",
  library: "Library",
  nursery: "Nursery",
  trophy: "Trophy hall",
  study: "Study",
  reception: "Reception",
};

const ROOM_KIND_TRIGGER: Record<RoomKind, string> = {
  living: "既定。他カテゴリのツール傾向が無いとき",
  workshop: "直近で Bash / Edit / MultiEdit など書込系ツールが多い",
  library: "直近で Read / Grep / Glob など読込系ツールが多い",
  nursery: "サブエージェントが直近に誕生（spawn）",
  trophy: "最高スキル Lv が高い",
  study: "直近で TodoWrite / Plan など計画系メッセージが多い",
  reception: "Best friend / parent などの関係スコアが高い",
};

const MOOD_LABEL: Record<string, string> = {
  happy: "ご機嫌（happy）",
  stressed: "ストレス（stressed）",
  bored: "退屈（bored）",
  energized: "活気（energized）",
  focused: "集中（focused）",
  asleep: "就寝中（asleep）",
};

const TOOL_LABEL = {
  book: "📖 本（Read / View）",
  monitor: "🖥 モニタ（Edit / Write）",
  magnifier: "🔍 虫眼鏡（Grep / Glob / Find）",
  terminal: "💻 端末（Bash / Shell）",
  telescope: "🔭 望遠鏡（WebFetch / curl）",
  staff: "🪄 杖（Task / Agent / Spawn）",
  pen: "🖊 ペン（その他ツール）",
} as const;

const SEASON_LABEL: Record<TemporalDecor["season"], string> = {
  spring: "春（spring）",
  summer: "夏（summer）",
  autumn: "秋（autumn）",
  winter: "冬（winter）",
};

const MEAL_LABEL = {
  breakfast: "朝食（5:00-10:00）",
  lunch: "昼食（10:00-14:00）",
  tea: "ティータイム（14:00-17:00）",
  sleepwear: "夕食/部屋着（17:00-22:00）",
  "night-snack": "夜食（22:00-5:00）",
} as const;

const BUSTLE_LABEL = {
  quiet: "quiet（サブエージェントなし）",
  lively: "lively（1体）",
  busy: "busy（2-3体）",
  party: "party（4体以上）",
} as const;

export function describeRoomObject(
  id: RoomObjectId,
  ctx: RoomInspectorContext,
): RoomInspectorEntry {
  switch (id.kind) {
    case "room-kind":
      return {
        title: `🚪 ${ROOM_KIND_LABEL[ctx.roomKind]}`,
        summary: "直近のツール傾向と関係性から推定された部屋の種類。",
        details: [`現在の判定理由: ${ROOM_KIND_TRIGGER[ctx.roomKind]}`],
      };
    case "furniture":
      return {
        title: "🪑 静的家具",
        summary: "部屋種別ごとに固定で配置されるシンボル家具。状態には連動しない。",
        details: [
          `現部屋: ${ROOM_KIND_LABEL[ctx.roomKind]}`,
          "🪴 = plant。1時間以上沈黙すると🥀に枯れる。",
        ],
      };
    case "tool": {
      const t = ctx.roomState.toolProp;
      return {
        title: t ? TOOL_LABEL[t] : "🖊 道具",
        summary: "直近 2 分以内に呼ばれた最後の Tool を表す。",
        details: t
          ? [`Tool kind: ${t}`, "なければ非表示。種別は名前パターンで分類。"]
          : ["直近 2 分以内に Tool 呼び出しなし。"],
      };
    }
    case "whiteboard": {
      const items = ctx.roomState.whiteboardItems;
      return {
        title: "📋 Whiteboard",
        summary: "assistant メッセージから抽出した TodoWrite / [ ] checklist。",
        details:
          items.length === 0
            ? ["最新メッセージに抽出可能な checklist 行なし。"]
            : items
                .slice(0, 4)
                .map((it) => `${it.done ? "✅" : "⬜"} ${it.text}`),
      };
    }
    case "mess": {
      const lv = ctx.roomState.messLevel;
      return {
        title: `🗑 Mess level ${lv}/3`,
        summary: "直近 5 分の messages + tool_calls の頻度。エラー率高で +1。",
        details: [
          `現レベル: ${lv} (0=綺麗 / 3=散らかってる)`,
          ctx.roomState.errorBoost ? "tool error ratio ≥ 30% で boost 中。" : "error boost なし。",
          ctx.roomState.plantsWilted ? "🥀 沈黙 1h+ で plants 枯れた状態。" : "🪴 plants は健康。",
        ],
      };
    }
    case "events": {
      const evs = ctx.roomState.events;
      return {
        title: "🎉 Event decor",
        summary: "直近 1 時間以内に発生したライフイベント（誕生・結婚・大きな実績…）。",
        details:
          evs.length === 0
            ? ["直近 1h 以内のイベントなし。"]
            : evs.map(
                (e) =>
                  `[${e.severity}] ${e.kind}${e.label ? ` — ${e.label}` : ""}`,
              ),
      };
    }
    case "achievements": {
      const a = ctx.achievements;
      return {
        title: "🏅 Achievement frames",
        summary: "Top skills のうち Lv ≥ 3 を額装。Lv で tier が上がる。",
        details:
          a.frames.length === 0
            ? ["Lv ≥ 3 のスキルなし。"]
            : a.frames.map(
                (f) =>
                  `${f.icon ?? "✨"} ${f.label} — Lv ${f.level} (${f.tier}, ⭐${f.stars})`,
              ),
      };
    }
    case "trophy":
      return {
        title: ctx.achievements.hasGrandTrophy ? "🏆 Grand trophy" : "🏆 Trophy",
        summary: "最高スキル Lv ≥ 7 で表示。Lv ≥ 9 で大型化。",
        details: [
          `hasTrophy: ${ctx.achievements.hasTrophy}`,
          `hasGrandTrophy: ${ctx.achievements.hasGrandTrophy}`,
        ],
      };
    case "crown":
      return {
        title: "👑 Crown",
        summary: "最高スキル Lv = 10 達成時のみ出現する栄誉表示。",
        details: [`hasCrown: ${ctx.achievements.hasCrown}`],
      };
    case "carpet":
      return {
        title: "🟥 Red carpet",
        summary: "最高スキル Lv ≥ 9 達成時、アバター足元に出現。",
        details: [`hasCarpet: ${ctx.achievements.hasCarpet}`],
      };
    case "frames":
      return {
        title: "🖼 Relationship frames",
        summary: "Parent / Best friend / Children をフォトフレーム化（関係スコア閾値超え）。",
        details:
          ctx.frames.length === 0
            ? ["閾値（family ≥ 85 / friend ≥ 65）を超える関係なし。"]
            : ctx.frames.map((f) => `${f.caption}: ${f.kind} (hue ${Math.round(f.hue)})`),
      };
    case "pets": {
      const pets = ctx.petBundle.pets;
      return {
        title: "🐾 Pets",
        summary:
          "agent kind ごとに 1 匹（claude=🐈 / codex=🐕 / antigravity=🐦 / other=🐹）。1 日以上経過で出現。",
        details:
          pets.length === 0
            ? ["年齢 1 日未満のためペットなし。"]
            : pets.map(
                (p, i) =>
                  `Pet ${i + 1}: ${p.kind} — ${p.state}${p.state === "asleep" ? "（沈黙 30 分+）" : ""}`,
              ),
      };
    }
    case "mood-wall":
      return {
        title: "🎨 Mood wallpaper",
        summary: "壁の色相は現在の Mood を反映。time-of-day と独立。",
        details: [
          `現在 Mood: ${MOOD_LABEL[ctx.card.mood.key] ?? ctx.card.mood.key}`,
          `accent: ${ctx.card.mood.color}`,
        ],
      };
    case "bookshelf":
      return {
        title: "📚 Bookshelf",
        summary: "total skill XP / 30 + 年齢日数 × 2 → 本の数 (0-20)。背の色は top skill アイコンのハッシュ。",
        details: [
          `現在の本数: ${ctx.containerContents.bookCount} / 20`,
          `背色 hues: ${ctx.containerContents.bookHues
            .slice(0, 5)
            .map((h) => Math.round(h))
            .join(", ")}`,
        ],
      };
    case "fridge":
      return {
        title: "🧊 Fridge",
        summary: "Hunger need の bucket。25/50/80 で段階増加。",
        details: [
          `level: ${ctx.containerContents.fridgeLevel} / 3`,
          `items: ${ctx.containerContents.fridgeItems.join(" ") || "(空)"}`,
        ],
      };
    case "season":
      return {
        title: `🌸 Seasonal decor — ${SEASON_LABEL[ctx.temporal.season]}`,
        summary: "現在のローカル季節に応じた装飾。",
        details: [
          `season: ${ctx.temporal.season}`,
          `primary: ${ctx.temporal.seasonal.emoji}${ctx.temporal.seasonal.accentEmoji ? " / " + ctx.temporal.seasonal.accentEmoji : ""}`,
        ],
      };
    case "meal":
      return {
        title: `🍽 Meal — ${MEAL_LABEL[ctx.temporal.meal.kind]}`,
        summary: "現在時刻のローカル時間帯から食事を決定。",
        details: [
          `meal: ${ctx.temporal.meal.label}`,
          `glyphs: ${ctx.temporal.meal.primary}${ctx.temporal.meal.secondary ? " " + ctx.temporal.meal.secondary : ""}`,
        ],
      };
    case "christmas-tree":
      return {
        title: "🎄 Christmas tree",
        summary: "12 月（ローカル日付）のみ出現するシーズナル特例。",
        details: [
          `isChristmas: ${ctx.temporal.isChristmas}`,
          `current month: ${new Date(ctx.now).getMonth() + 1}`,
        ],
      };
    case "window-scene": {
      const w = ctx.windowScene;
      const lines: string[] = [];
      if (w.parentHouse) lines.push(`Parent house: hue ${Math.round(w.parentHouse.hue)}`);
      if (w.playingChildren.length > 0)
        lines.push(`Playing children: ${w.playingChildren.length} 体`);
      if (w.passingFriend)
        lines.push(`Passing friend: ${w.passingFriend.sessionType} (hue ${Math.round(w.passingFriend.hue)})`);
      return {
        title: "🪟 Window scene",
        summary: "窓の向こうに親家・子供たち・通りすがりの友達セッションを描く。",
        details:
          lines.length === 0
            ? ["窓の外に表示すべき関係セッションなし。"]
            : lines,
      };
    }
    case "guests": {
      const g = ctx.guests;
      return {
        title: "🧑‍🤝‍🧑 Guest agents",
        summary: "サブエージェント（parent_session が自分）が直近 5 分以内に動いていると、部屋に遊びに来る。",
        details:
          g.length === 0
            ? ["現在 active なサブエージェントなし。"]
            : g.map(
                (gu) =>
                  `Guest: ${gu.sessionType} — hue ${Math.round(gu.hue)}`,
              ),
      };
    }
    case "visitor":
      return {
        title: "👤 User visitor",
        summary: "ユーザーが直近 5 分以内に発言（指示しに遊びに来た体裁）。",
        details: [
          ctx.hasRecentUserMessage
            ? "今、来訪中。"
            : "直近 5 分以内のユーザー発言なし。",
        ],
      };
    case "bustle-banner":
      return {
        title: "✨ Bustle banner",
        summary: "サブエージェント数で intensity が決まり、頭上に sparkles / notes が浮かぶ。",
        details: [
          `intensity: ${BUSTLE_LABEL[ctx.bustle.intensity]}`,
          `subagent count: ${ctx.bustle.subagentCount}`,
        ],
      };
    case "lamp":
      return {
        title: "💡 Pendant lamp",
        summary: "夜・夕方は点灯して光の cone を床に投影。time-of-day を反映。",
        details: [
          `現在の time-of-day: ${ctx.isDark ? "暗（night/evening）" : "明（morning/noon）"}`,
        ],
      };
    case "window":
      return {
        title: "🪟 Window (time-of-day sky)",
        summary: "現時刻の空（☀️/🌙/⭐）と天気を描画。stormy 時は☔。",
        details: [
          `time-of-day: ${ctx.isDark ? "暗" : "明"}`,
        ],
      };
  }
}
