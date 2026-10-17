"use client";

// Fleet Hamlet — Room Scene (Three.js 3D Cutaway Room Diorama + Interactive Inspector Overlay).
//
// Renders the currently selected resident inside a realistic 3D cutaway room
// (`ThreeRoomDioramaView`) with 3D plastered/wood-wainscoted walls, hardwood
// or marble floor, 3D window with volumetric light beam, 3D pendant lamp with
// PointLight, 3D room-specific furniture, 3D pets, and 3D articulated
// resident / guest / visitor characters.
//
// On top of the 3D room canvas sits a synchronized SVG layer that provides:
// - `<Clickable>` hit-zones for the Room Object Inspector (`describeRoomObject`)
// - Crisp vector text overlays (TodoWrite whiteboard checklist, live code
//   MonitorScreen, relationship photo frames, skill achievement frames,
//   overhead bustle banner, and thinking/sleeping status indicators).

import { useEffect, useMemo, useState } from "react";
import type { SessionDetail } from "@/lib/api";
import type { WeatherKind } from "../_lib/fleet-hamlet-layout";
import {
  hashStringToInt,
  type SimCardModel,
} from "../_lib/fleet-hamlet";
import {
  HAMLET_AVATAR_CSS,
  avatarStyleFromSeed,
  clothingForStyle,
} from "./fleet-hamlet-avatar";
import {
  timeOfDay,
  type TimeOfDay,
} from "../_lib/fleet-hamlet-decor";
import type { RoomKind } from "../_lib/fleet-hamlet-house";
import { deriveAccessories, selectActiveRoom } from "../_lib/fleet-hamlet-particles";
import {
  getFurnitureLayout,
  getRoomDynamicSlots,
  roomKindLabel,
  roomPalette,
} from "../_lib/fleet-hamlet-room-furniture";
import { deriveRoomState } from "../_lib/fleet-hamlet-room-state";
import {
  deriveAchievements,
  deriveFrames,
  frameMaxForRoom,
} from "../_lib/fleet-hamlet-room-life";
import { deriveTemporal } from "../_lib/fleet-hamlet-room-temporal";
import {
  countSubagents,
  derivePets,
  deriveMoodPalette,
} from "../_lib/fleet-hamlet-room-companion";
import { computeBustle, type BustleIntensity } from "../_lib/fleet-hamlet-bustle";
import {
  computeRoomMotion,
  type RoomAvatarMotion,
} from "../_lib/fleet-hamlet-outing";
import {
  deriveRoomGuests,
  type RoomGuest,
} from "../_lib/fleet-hamlet-room-guests";
import {
  describeRoomObject,
  type RoomInspectorContext,
  type RoomInspectorEntry,
  type RoomObjectId,
} from "../_lib/fleet-hamlet-room-inspector";
import {
  EventDecorLayer,
  MessLayer,
  MonitorScreen,
  ROOM_STATE_CSS,
  RoomWhiteboard,
  TodoStickyCluster,
  ToolPropSvg,
} from "./fleet-hamlet-room-state";
import {
  AchievementFrames,
  CrownDisplay,
  RelationshipFrames,
  ROOM_LIFE_CSS,
  TrophyShelf,
} from "./fleet-hamlet-room-life";
import {
  MealTable,
  ROOM_TEMPORAL_CSS,
  SeasonDecor,
} from "./fleet-hamlet-room-temporal";
import {
  ROOM_COMPANION_CSS,
} from "./fleet-hamlet-room-companion";
import { deriveWindowScene } from "../_lib/fleet-hamlet-room-window";
import { deriveContainerContents } from "../_lib/fleet-hamlet-room-containers";
import {
  ROOM_CONTAINERS_CSS,
} from "./fleet-hamlet-room-containers";
import { WindowSceneView } from "./fleet-hamlet-room-window-scene";
import { ThreeRoomDioramaView } from "./fleet-hamlet-three-house";

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export interface RoomSceneProps {
  card: SimCardModel;
  detail: SessionDetail | undefined;
  /** Full neighborhood — used by dynamic event detection (baby / wedding). */
  allCards?: readonly SimCardModel[];
  now: number;
  /** Village-wide weather — drives optional window raindrops. */
  weather?: WeatherKind;
  /** Force a specific room kind (mostly for tests / overrides). */
  forceRoom?: RoomKind;
}

const SCENE_W = 360;
const SCENE_H = 220;

// Window box used by the WindowSceneView overlay (aligned with the 3D window).
const WINDOW_BOX = { x: 60, y: 18, w: 84, h: 64 } as const;

export function RoomScene({
  card,
  detail,
  allCards,
  now,
  weather = "clear",
  forceRoom,
}: RoomSceneProps) {
  const roomKind = useMemo<RoomKind>(
    () => forceRoom ?? selectActiveRoom(detail, card, now),
    [card, detail, forceRoom, now],
  );
  const palette = useMemo(() => roomPalette(roomKind, card.hue), [roomKind, card.hue]);
  const tod = useMemo<TimeOfDay>(() => timeOfDay(new Date(now)), [now]);
  const isDark = tod === "night" || tod === "evening";
  const seed = useMemo(() => hashStringToInt(card.key), [card.key]);
  const furnitureRaw = useMemo(
    () => getFurnitureLayout(roomKind, seed),
    [roomKind, seed],
  );
  const roomState = useMemo(
    () => deriveRoomState(card, detail, allCards ?? [card], now),
    [card, detail, allCards, now],
  );

  // Visitor presence — a user-role message in the last 5 minutes means
  // the human came by to give instructions.
  const hasRecentUserMessage = useMemo(() => {
    if (!detail?.messages?.length) return false;
    const cutoff = now - 5 * 60 * 1000;
    for (let i = detail.messages.length - 1; i >= 0; i--) {
      const m = detail.messages[i];
      if (!m || m.role !== "user") continue;
      const ts = Date.parse(m.timestamp);
      if (Number.isFinite(ts) && ts >= cutoff) return true;
      if (Number.isFinite(ts) && ts < cutoff) return false;
    }
    return false;
  }, [detail, now]);

  const dynamicSlots = useMemo(() => getRoomDynamicSlots(roomKind), [roomKind]);

  // Axis 2 — find the 🖥 furniture item's scene position for the MonitorScreen overlay.
  const monitorPos = useMemo<{ sx: number; sy: number } | null>(() => {
    const pcItem = furnitureRaw.find((it) => it.glyph === "🖥");
    if (!pcItem) return null;
    const depth = 1 - pcItem.y;
    const compress = depth * 0.18;
    const sx = SCENE_W / 2 + (pcItem.x - 0.5) * SCENE_W * (1 - compress);
    const FLOOR_TOP = 120;
    const FLOOR_BOTTOM = 216;
    const sy = FLOOR_TOP + pcItem.y * (FLOOR_BOTTOM - FLOOR_TOP);
    return { sx, sy };
  }, [furnitureRaw]);

  // R3 — accumulated life (achievements + relationship photos).
  const achievements = useMemo(
    () => deriveAchievements(card, detail),
    [card, detail],
  );
  const frames = useMemo(
    () => deriveFrames(card, allCards ?? [card], now, frameMaxForRoom(roomKind)),
    [card, allCards, now, roomKind],
  );
  // R4 — time of day + season (purely a function of `now`).
  const temporal = useMemo(() => deriveTemporal(now), [now]);
  // R5 — pets + mood palette.
  const subagentCount = useMemo(
    () => (allCards ? countSubagents(card, allCards) : 0),
    [card, allCards],
  );
  const petBundle = useMemo(
    () => derivePets(card, now, subagentCount),
    [card, now, subagentCount],
  );
  const moodPalette = useMemo(
    () => deriveMoodPalette(card.mood.key),
    [card.mood.key],
  );
  const floorAchievementSlots = useMemo(
    () => (dynamicSlots.achievementSlots ?? []).filter((s) => s.anchor === "floor"),
    [dynamicSlots.achievementSlots],
  );
  // R6 F2 — out-the-window relationships (parent house / kids / friend).
  const windowScene = useMemo(
    () => deriveWindowScene(card, allCards ?? [card], now),
    [card, allCards, now],
  );
  // R6 G2 — bookshelf / fridge contents.
  const containerContents = useMemo(
    () => deriveContainerContents(card, detail),
    [card, detail],
  );
  const bustle = useMemo(
    () => computeBustle(card, allCards ?? [card], now),
    [card, allCards, now],
  );
  const guests = useMemo(
    () =>
      deriveRoomGuests(card, allCards ?? [card], bustle, {
        visitorPresent: hasRecentUserMessage,
      }),
    [card, allCards, bustle, hasRecentUserMessage],
  );

  const showBookshelf =
    roomKind === "library" ||
    roomKind === "workshop" ||
    roomKind === "study" ||
    roomKind === "reception";
  const showFridge = roomKind === "living" || roomKind === "nursery";

  const motion: RoomAvatarMotion = useMemo(() => computeRoomMotion(card, now), [card, now]);
  const stylePreset = useMemo(
    () => avatarStyleFromSeed(card.avatarSeed, card.sessionType),
    [card.avatarSeed, card.sessionType],
  );
  const clothes = useMemo(
    () => clothingForStyle(card.sessionType, stylePreset),
    [card.sessionType, stylePreset],
  );
  const accessories = useMemo(() => deriveAccessories(card, detail), [card, detail]);

  // Inspector — clicked-object id + resolved descriptor entry.
  const [selected, setSelected] = useState<RoomObjectId | null>(null);
  const inspectorCtx = useMemo<RoomInspectorContext>(
    () => ({
      card,
      detail,
      roomKind,
      now,
      roomState,
      achievements,
      frames,
      petBundle,
      containerContents,
      temporal,
      windowScene,
      bustle,
      guests,
      hasRecentUserMessage,
      isDark,
    }),
    [
      card,
      detail,
      roomKind,
      now,
      roomState,
      achievements,
      frames,
      petBundle,
      containerContents,
      temporal,
      windowScene,
      bustle,
      guests,
      hasRecentUserMessage,
      isDark,
    ],
  );
  const inspectorEntry = useMemo<RoomInspectorEntry | null>(
    () => (selected ? describeRoomObject(selected, inspectorCtx) : null),
    [selected, inspectorCtx],
  );
  useEffect(() => {
    if (!selected) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected]);

  const Clickable = useMemo(() => {
    function Clickable({
      id,
      label,
      children,
    }: {
      id: RoomObjectId;
      label: string;
      children: React.ReactNode;
    }) {
      return (
        <g
          pointerEvents="bounding-box"
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            setSelected(id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setSelected(id);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={label}
        >
          <title>{label}</title>
          {children}
        </g>
      );
    }
    return Clickable;
  }, []);

  return (
    <div
      className="relative w-full h-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
      style={{ background: palette.wallBottom, minHeight: 160 }}
      role="img"
      aria-label={`${roomKindLabel(roomKind)} interior view`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* 1. Three.js 3D Cutaway Room Diorama (3D walls, floor, window, lamp, furniture, pets, and 3D articulated characters) */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <ThreeRoomDioramaView
          card={card}
          roomKind={roomKind}
          palette={palette}
          moodPalette={moodPalette}
          tod={tod}
          weather={weather}
          isDark={isDark}
          roomState={roomState}
          achievements={achievements}
          temporal={temporal}
          containerContents={containerContents}
          pets={petBundle.pets}
          guests={guests}
          hasRecentUserMessage={hasRecentUserMessage}
          motion={motion}
          stylePreset={stylePreset}
          clothing={clothes}
          accessories={accessories}
        />
      </div>

      {/* 2. Interactive Inspector Hit-Zones & Crisp HUD/Text Overlays */}
      <svg
        className="relative z-10 w-full h-full"
        viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Hit-zone: Mood wallpaper */}
        <Clickable id={{ kind: "mood-wall" }} label="Mood wallpaper — クリックで詳細">
          <rect x={0} y={0} width={SCENE_W} height={118} fill="transparent" />
        </Clickable>

        {/* Hit-zone: Window */}
        <Clickable id={{ kind: "window" }} label="Window — 時刻と天気">
          <rect
            x={WINDOW_BOX.x}
            y={WINDOW_BOX.y}
            width={WINDOW_BOX.w}
            height={WINDOW_BOX.h}
            fill="transparent"
          />
        </Clickable>

        {/* Out-the-window relationships silhouettes */}
        <Clickable id={{ kind: "window-scene" }} label="Window scene — 関係セッション">
          <WindowSceneView scene={windowScene} windowBox={WINDOW_BOX} />
        </Clickable>

        {/* Hit-zone: Pendant lamp */}
        <Clickable id={{ kind: "lamp" }} label="Pendant lamp — 夜間ライティング">
          <rect x={SCENE_W * 0.66 - 18} y={0} width={36} height={34} fill="transparent" />
        </Clickable>

        {/* Family / friend photo frames mounted on the back wall */}
        {dynamicSlots.frameSlots && (
          <Clickable id={{ kind: "frames" }} label="Relationship frames — 家族/友人">
            <RelationshipFrames
              frames={frames}
              slots={dynamicSlots.frameSlots}
            />
          </Clickable>
        )}

        {/* Wall-mounted achievement frames */}
        {dynamicSlots.achievementSlots && (
          <Clickable id={{ kind: "achievements" }} label="Achievement frames — スキル Lv">
            <AchievementFrames
              items={achievements.frames}
              slots={dynamicSlots.achievementSlots}
              accent={palette.accent}
            />
          </Clickable>
        )}

        {/* Lv 10 crown hit-zone + badge */}
        {achievements.hasCrown && (
          <Clickable id={{ kind: "crown" }} label="Crown — Lv 10 達成">
            <CrownDisplay slot={floorAchievementSlots[0]} />
          </Clickable>
        )}

        {/* Hit-zone: 3D Bookshelf */}
        {showBookshelf && dynamicSlots.bookshelfSlot && (
          <Clickable id={{ kind: "bookshelf" }} label="Bookshelf — XP + 年齢">
            <rect
              x={dynamicSlots.bookshelfSlot.x * SCENE_W - 22}
              y={70}
              width={44}
              height={56}
              fill="transparent"
            />
          </Clickable>
        )}

        {/* Hit-zone: 3D Fridge */}
        {showFridge && dynamicSlots.fridgeSlot && (
          <Clickable id={{ kind: "fridge" }} label="Fridge — Hunger need">
            <rect
              x={dynamicSlots.fridgeSlot.x * SCENE_W - 20}
              y={68}
              width={40}
              height={58}
              fill="transparent"
            />
          </Clickable>
        )}

        {/* Hit-zone: 3D Room Furniture */}
        <Clickable id={{ kind: "furniture" }} label="Static furniture — 部屋種別の固定家具">
          <rect x={140} y={118} width={110} height={64} fill="transparent" />
        </Clickable>

        {/* Crisp vector TodoWrite Whiteboard checklist */}
        {dynamicSlots.whiteboardSlot && (
          <Clickable id={{ kind: "whiteboard" }} label="Whiteboard — TodoWrite checklist">
            <RoomWhiteboard
              items={roomState.whiteboardItems}
              slot={dynamicSlots.whiteboardSlot}
              accent={palette.accent}
            />
          </Clickable>
        )}

        {/* TODO sticky-note cluster on the right wall */}
        <TodoStickyCluster count={roomState.todoStickyCount} />

        {/* Recent 1h event decor */}
        {dynamicSlots.eventSlots && (
          <Clickable id={{ kind: "events" }} label="Event decor — 直近 1h イベント">
            <EventDecorLayer
              events={roomState.events}
              slots={dynamicSlots.eventSlots}
              seed={seed}
            />
          </Clickable>
        )}

        {/* Seasonal decoration */}
        <Clickable id={{ kind: "season" }} label="Seasonal decor — 現在の季節">
          <SeasonDecor
            seasonal={temporal.seasonal}
            slot={dynamicSlots.seasonSlot}
          />
        </Clickable>

        {temporal.isChristmas && (
          <Clickable id={{ kind: "christmas-tree" }} label="Christmas tree — 12 月のみ">
            <rect x={22} y={96} width={38} height={60} fill="transparent" />
          </Clickable>
        )}

        {achievements.hasTrophy && (
          <Clickable id={{ kind: "trophy" }} label="Trophy — 最高 Lv ≥ 7">
            <TrophyShelf
              slot={floorAchievementSlots[achievements.hasCrown ? 1 : 0]}
              large={achievements.hasGrandTrophy}
            />
          </Clickable>
        )}

        {achievements.hasCarpet && (
          <Clickable id={{ kind: "carpet" }} label="Red carpet — Lv ≥ 9">
            <rect x={SCENE_W * 0.62 - 42} y={178} width={84} height={28} fill="transparent" />
          </Clickable>
        )}

        <Clickable id={{ kind: "meal" }} label="Meal — 現在時刻の食事">
          <MealTable meal={temporal.meal} slot={dynamicSlots.mealSlot} />
        </Clickable>

        {dynamicSlots.messSlots && (
          <Clickable id={{ kind: "mess" }} label="Mess level — 活動量">
            <MessLayer
              level={roomState.messLevel}
              errorBoost={roomState.errorBoost}
              slots={dynamicSlots.messSlots}
              seed={seed}
              allNighter={roomState.allNighter}
              recentCelebration={roomState.recentCelebration}
            />
          </Clickable>
        )}

        {/* Monitor live-code overlay on top of 3D monitor */}
        {monitorPos && roomState.monitorLines.length > 0 && (
          <MonitorScreen
            lines={roomState.monitorLines}
            sx={monitorPos.sx}
            sy={monitorPos.sy}
          />
        )}

        {/* Hit-zone: 3D Pets */}
        {dynamicSlots.petSlots && petBundle.pets.length > 0 && (
          <Clickable id={{ kind: "pets" }} label="Pets — agent kind のコンパニオン">
            <g>
              {petBundle.pets.map((pet, idx) => {
                const slot = dynamicSlots.petSlots?.[idx % dynamicSlots.petSlots.length];
                const px = (slot?.x ?? 0.35 + idx * 0.14) * SCENE_W;
                const py = 125 + (slot?.y ?? 0.72) * 85;
                return (
                  <rect
                    key={`pet-hit-${pet.kind}-${idx}`}
                    x={px - 16}
                    y={py - 16}
                    width={32}
                    height={28}
                    fill="transparent"
                  />
                );
              })}
            </g>
          </Clickable>
        )}

        {/* Hit-zone: 3D Guest Subagents */}
        {guests.length > 0 && (
          <Clickable id={{ kind: "guests" }} label="Guest agents — 来訪サブエージェント">
            <RoomGuests guests={guests} />
          </Clickable>
        )}

        {/* 3D Resident Status Overlay (thinking pips / Zzz) */}
        <RoomAvatar motion={motion} />

        {/* Hit-zone + label: 3D Human Visitor */}
        {hasRecentUserMessage && (
          <Clickable id={{ kind: "visitor" }} label="Visitor — ユーザー来訪">
            <RoomVisitor />
          </Clickable>
        )}

        {bustle.intensity !== "quiet" && (
          <Clickable id={{ kind: "bustle-banner" }} label="Bustle banner — 賑やかさ">
            <RoomBustleBanner intensity={bustle.intensity} hues={bustle.subagentHues} />
          </Clickable>
        )}

        {roomState.toolProp && dynamicSlots.toolSlot && (
          <Clickable id={{ kind: "tool" }} label="Tool prop — 直近 2 分の道具">
            <ToolPropSvg
              kind={roomState.toolProp}
              slot={dynamicSlots.toolSlot}
              accent={palette.accent}
            />
          </Clickable>
        )}
      </svg>

      {/* Room-kind chip (top-left) — clickable for "why is this room?" */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSelected({ kind: "room-kind" });
        }}
        className="absolute top-1.5 left-1.5 z-20 px-1.5 h-5 inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[10px] font-mono cursor-pointer hover:opacity-100"
        style={{
          background: "var(--color-bg)",
          color: palette.accent,
          border: `1px solid ${palette.accent}`,
          opacity: 0.92,
        }}
        title={`${roomKindLabel(roomKind)} — クリックで判定理由を表示`}
      >
        <span aria-hidden>🚪</span>
        <span>{roomKindLabel(roomKind)}</span>
      </button>

      {/* Always-visible state badge (top-right) */}
      <div
        className="absolute top-1.5 right-1.5 z-20 px-1.5 h-5 inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[9px] font-mono pointer-events-none"
        style={{
          background: selected ? "hsl(45, 95%, 55%)" : "rgba(0,0,0,0.6)",
          color: selected ? "#1a1a1a" : "#FAF6EC",
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        <span aria-hidden>{selected ? "🔍" : "·"}</span>
        <span>{selected ? selected.kind : "no selection"}</span>
      </div>

      {/* Inspector overlay */}
      {inspectorEntry && (
        <div
          className="absolute bottom-1.5 left-1.5 right-1.5 z-50 p-2 rounded-[var(--radius-sm)] text-[10px] font-mono shadow-lg"
          style={{
            background: "hsl(45, 95%, 92%)",
            color: "#1a1a1a",
            border: "2px solid hsl(45, 95%, 45%)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Room object inspector"
        >
          <header className="flex items-start justify-between gap-2 mb-1">
            <span className="font-semibold leading-tight">{inspectorEntry.title}</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close inspector"
              className="shrink-0 -mr-0.5 -mt-0.5 px-1 text-[12px] leading-none opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </header>
          <p className="leading-snug opacity-90">{inspectorEntry.summary}</p>
          {inspectorEntry.details.length > 0 && (
            <ul className="mt-1 space-y-0.5 leading-snug opacity-95">
              {inspectorEntry.details.map((d, i) => (
                <li key={i} className="before:content-['•_'] before:opacity-60">
                  {d}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar Overlays — Status indicators & hit-zones aligned with the 3D figures
// ---------------------------------------------------------------------------

function RoomAvatar({ motion }: { motion: RoomAvatarMotion }) {
  const cx = SCENE_W * 0.62;
  const groundY = 200;
  const totalH = 70;
  return (
    <g transform={`translate(${cx}, ${groundY - totalH})`} pointerEvents="none">
      {motion === "working" && (
        <g aria-hidden transform="translate(0, -4)">
          {[-4, 0, 4].map((dx, i) => (
            <circle
              key={dx}
              cx={dx}
              cy={0}
              r={1.3}
              fill="hsl(45, 90%, 58%)"
              style={{
                animation: `relayRoomAvatarThink 1.05s ease-in-out ${i * 0.18}s infinite`,
                transformBox: "fill-box",
                transformOrigin: "center",
              }}
            />
          ))}
        </g>
      )}
      {motion === "resting" && (
        <g aria-hidden>
          <text
            x={48}
            y={56}
            fontSize={11}
            textAnchor="middle"
            style={{
              animation: "relayRoomAvatarZzz 3.2s ease-out infinite",
              transformBox: "fill-box",
              transformOrigin: "center",
            }}
          >
            💤
          </text>
          <text
            x={54}
            y={52}
            fontSize={9}
            textAnchor="middle"
            style={{
              animation: "relayRoomAvatarZzz 3.2s ease-out 1.6s infinite",
              transformBox: "fill-box",
              transformOrigin: "center",
            }}
          >
            💤
          </text>
        </g>
      )}
    </g>
  );
}

function RoomVisitor() {
  const cx = SCENE_W * 0.32;
  const groundY = 200;
  const totalH = 64;
  return (
    <g transform={`translate(${cx}, ${groundY - totalH})`}>
      {/* Clickable hit-zone over the 3D visitor character */}
      <rect x={-18} y={-4} width={36} height={totalH + 8} fill="transparent" />
      <g transform="translate(0, -8)">
        <rect
          x={-14}
          y={-7}
          width={28}
          height={11}
          rx={5}
          fill="rgba(255, 250, 240, 0.92)"
          stroke="rgba(0,0,0,0.18)"
          strokeWidth={0.5}
        />
        <text
          x={0}
          y={1.2}
          textAnchor="middle"
          fontSize={7}
          fill="#3A2A1F"
          fontFamily="ui-monospace, monospace"
          fontWeight={600}
        >
          👤 you
        </text>
      </g>
    </g>
  );
}

function RoomGuests({ guests }: { guests: readonly RoomGuest[] }) {
  return (
    <g aria-hidden>
      {guests.map((g) => (
        <rect
          key={g.key}
          x={g.cx - 16}
          y={g.groundY - g.height}
          width={32}
          height={g.height + 4}
          fill="transparent"
        />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// RoomBustleBanner — overhead chatter / sparkles / music notes
// ---------------------------------------------------------------------------

function RoomBustleBanner({
  intensity,
  hues,
}: {
  intensity: BustleIntensity;
  hues: readonly number[];
}) {
  const cfg = BUSTLE_BANNER_CFG[intensity];
  if (!cfg) return null;
  const baseX = SCENE_W / 2;
  const baseY = 96;
  return (
    <g aria-hidden>
      {Array.from({ length: cfg.count }).map((_, i) => {
        const glyph = cfg.glyphs[i % cfg.glyphs.length] ?? "✨";
        const hue = hues[i % Math.max(1, hues.length)] ?? 48;
        const xOffset = (i - (cfg.count - 1) / 2) * cfg.spread;
        const delay = -(i * (cfg.period / cfg.count));
        return (
          <text
            key={i}
            x={baseX + xOffset}
            y={baseY}
            fontSize={cfg.fontSize}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={`hsl(${hue}, 75%, 62%)`}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={0.2}
            style={{
              animation: `relayRoomBustleSparkle ${cfg.period.toFixed(2)}s ease-out ${delay.toFixed(2)}s infinite`,
              transformOrigin: `${(baseX + xOffset).toFixed(2)}px ${baseY}px`,
              filter: "drop-shadow(0 1px 1.4px rgba(0,0,0,0.35))",
            }}
          >
            {glyph}
          </text>
        );
      })}
    </g>
  );
}

interface BustleBannerCfg {
  count: number;
  glyphs: readonly string[];
  spread: number;
  fontSize: number;
  period: number;
}

const BUSTLE_BANNER_CFG: Record<BustleIntensity, BustleBannerCfg | null> = {
  quiet: null,
  lively: { count: 2, glyphs: ["✨", "💬"], spread: 14, fontSize: 9, period: 3.0 },
  busy: { count: 4, glyphs: ["✨", "💬", "♪", "🎈"], spread: 16, fontSize: 10, period: 2.4 },
  party: { count: 5, glyphs: ["🎉", "✨", "♪", "💬", "🎈"], spread: 18, fontSize: 11, period: 1.8 },
};

export const ROOM_SCENE_CSS = `
@keyframes relayRoomLampBreathe {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
@keyframes relayRoomGuestBob {
  0%, 100% { transform: translate(0, 0); }
  50%      { transform: translate(0, -1.2px); }
}
@keyframes relayRoomBustleSparkle {
  0%   { transform: translate(0, 4px)  scale(0.7) rotate(-6deg); opacity: 0; }
  20%  { opacity: 0.95; }
  60%  { transform: translate(1.6px, -10px) scale(1.05) rotate(8deg); opacity: 0.9; }
  100% { transform: translate(-1.6px, -22px) scale(1.15) rotate(-4deg); opacity: 0; }
}
@keyframes relayRoomAvatarThink {
  0%, 100% { opacity: 0.18; transform: scale(0.85); }
  50%      { opacity: 1;    transform: scale(1.15); }
}
@keyframes relayRoomAvatarZzz {
  0%   { transform: translate(0, 0)     scale(0.55); opacity: 0; }
  20%  { opacity: 0.9; }
  100% { transform: translate(8px, -18px) scale(1.2);  opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  [style*="relayRoomGuestBob"],
  [style*="relayRoomBustleSparkle"],
  [style*="relayRoomAvatarThink"],
  [style*="relayRoomAvatarZzz"] {
    animation: none !important;
  }
}
${ROOM_STATE_CSS}
${ROOM_LIFE_CSS}
${ROOM_TEMPORAL_CSS}
${ROOM_COMPANION_CSS}
${ROOM_CONTAINERS_CSS}
${HAMLET_AVATAR_CSS}
`;
