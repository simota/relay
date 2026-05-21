"use client";

// Fleet Hamlet — Room Scene.
//
// Renders the currently selected resident as an interior cutaway view:
// back wall + side wall sliver + perspective floor + window (time-of-day
// sky) + ceiling lamp + room-specific furniture + standing avatar.
//
// All visuals are pure SVG + emoji (no extra deps). Furniture positions
// come from `getFurnitureLayout(roomKind, seed)`; the wallpaper / floor
// palette comes from `roomPalette(roomKind, hue)`. The time-of-day sky
// inside the window reuses the shared `timeOfDay()` + `skyPalette()` so
// it stays in sync with the rest of the village.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { SessionDetail } from "@/lib/api";
import type { WeatherKind } from "../_lib/fleet-hamlet-layout";
import {
  avatarPartsFromSeed,
  hashStringToInt,
  type SimCardModel,
} from "../_lib/fleet-hamlet";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";
import {
  HAMLET_AVATAR_CSS,
  HamletAvatar,
  clothingForAgent,
} from "./fleet-hamlet-avatar";
import {
  skyPalette,
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
  type FurnitureItem,
  type RoomPalette,
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
  RedCarpet,
  RelationshipFrames,
  ROOM_LIFE_CSS,
  TrophyShelf,
} from "./fleet-hamlet-room-life";
import {
  ChristmasTree,
  MealTable,
  ROOM_TEMPORAL_CSS,
  SeasonDecor,
} from "./fleet-hamlet-room-temporal";
import {
  MoodWallpaper,
  PetGroup,
  ROOM_COMPANION_CSS,
} from "./fleet-hamlet-room-companion";
import { deriveWindowScene } from "../_lib/fleet-hamlet-room-window";
import { deriveContainerContents } from "../_lib/fleet-hamlet-room-containers";
import {
  Bookshelf,
  Fridge,
  ROOM_CONTAINERS_CSS,
} from "./fleet-hamlet-room-containers";
import { WindowSceneView } from "./fleet-hamlet-room-window-scene";
import {
  DIORAMA_DEFS,
  DIORAMA_ROOM,
} from "../_lib/fleet-hamlet-diorama-tokens";

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

// Window box used by both RoomWindow and the R6 F2 WindowSceneView overlay.
const WINDOW_BOX = { x: 60, y: 18, w: 84, h: 64 } as const;

// Axis 3 — plant stage glyph + scale maps (module-level so useMemo deps stay clean).
const PLANT_GLYPHS: Record<0 | 1 | 2 | 3, string> = { 0: "🌱", 1: "🪴", 2: "🌿", 3: "🌳" };
const PLANT_SCALES: Record<0 | 1 | 2 | 3, number> = { 0: 1.0, 1: 1.05, 2: 1.10, 3: 1.15 };

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
  const sky = useMemo(() => skyPalette(tod), [tod]);
  const isDark = tod === "night" || tod === "evening";
  const seed = useMemo(() => hashStringToInt(card.key), [card.key]);
  const furnitureRaw = useMemo(
    () => getFurnitureLayout(roomKind, seed),
    [roomKind, seed],
  );
  // Dynamic-layer state (R1 + R2). The neighborhood-wide event detectors
  // require the full card list; fall back to a single-element list so the
  // detector still functions when the panel was rendered standalone.
  const roomState = useMemo(
    () => deriveRoomState(card, detail, allCards ?? [card], now),
    [card, detail, allCards, now],
  );
  // Visitor presence — a user-role message in the last 5 minutes means
  // the human came by to give instructions, so we plant a visitor avatar
  // next to the resident for the duration of the visit window.
  const hasRecentUserMessage = useMemo(() => {
    if (!detail?.messages?.length) return false;
    const cutoff = now - 5 * 60 * 1000;
    for (let i = detail.messages.length - 1; i >= 0; i--) {
      const m = detail.messages[i];
      if (!m || m.role !== "user") continue;
      const ts = Date.parse(m.timestamp);
      if (Number.isFinite(ts) && ts >= cutoff) return true;
      // Older messages still ascend; bail early once we pass the cutoff.
      if (Number.isFinite(ts) && ts < cutoff) return false;
    }
    return false;
  }, [detail, now]);

  // Swap any plant-tagged furniture depending on state:
  //   plantsWilted → 🥀 (silence ≥ 1h, overrides growth stage)
  //   plantStage 0 → 🌱, 1 → 🪴 (default), 2 → 🌿, 3 → 🌳 (with scale bump)
  const furniture = useMemo(() => {
    return furnitureRaw.map((it) => {
      if (it.swapKind !== "plant") return it;
      if (roomState.plantsWilted) return { ...it, glyph: "🥀" };
      const stage = roomState.plantStage;
      return {
        ...it,
        glyph: PLANT_GLYPHS[stage],
        scale: it.scale * PLANT_SCALES[stage],
      };
    });
  }, [furnitureRaw, roomState.plantsWilted, roomState.plantStage]);
  const dynamicSlots = useMemo(() => getRoomDynamicSlots(roomKind), [roomKind]);

  // Axis 2 — find the 🖥 furniture item's scene position for the MonitorScreen overlay.
  // Uses the same trapezoid mapping as the static furniture layer so the overlay
  // lands precisely on top of the emoji.
  const monitorPos = useMemo<{ sx: number; sy: number } | null>(() => {
    const pcItem = furnitureRaw.find((it) => it.glyph === "🖥");
    if (!pcItem) return null;
    // Mirror the perspective compression used by FurnitureLayer.
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
  // Floor-anchored achievement slots are reused by the trophy / crown
  // displays. Wall-anchored ones drive the AchievementFrames component.
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
  // Spawned sub-agents that are currently active drop by the room as
  // "guests" — small standing avatars in the back/mid floor band tinted
  // by their own repo + agent kind. Drives the "lively / busy / party"
  // overhead bustle banner too.
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
  // Which room kinds get a bookshelf vs. fridge — gated by template slots,
  // but kept explicit so the renderer reads at a glance.
  const showBookshelf =
    roomKind === "library" ||
    roomKind === "workshop" ||
    roomKind === "study" ||
    roomKind === "reception";
  const showFridge = roomKind === "living" || roomKind === "nursery";

  // Inspector — clicked-object id + resolved descriptor entry. Selection is
  // local to the panel; ESC and the X button close it.
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

  // Clickable helper — wraps an SVG group with a click handler that
  // selects the object's inspector entry, and a `<title>` so hovering shows
  // a native tooltip too. **Memoized once via useMemo so the component
  // reference is stable across renders.** Without memoization, defining the
  // helper inline causes React to see a new component type every render,
  // which remounts the entire SVG subtree and tears down event listeners
  // between the user pressing and releasing the mouse — clicks silently
  // disappear. `setSelected` is referentially stable (React state setters
  // are), so capturing it in the closure is safe.
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
          // SVG <g> defaults to `pointer-events: visiblePainted` which only
          // fires events on actually-painted pixels of its children. Many
          // of our sub-components paint with low opacity, gradients, or
          // wrap their content in nested <g aria-hidden> groups that the
          // hit-test sees as "non-painted" — clicks then pass through to
          // the parent SVG and never reach this handler. `bounding-box`
          // makes the entire union-of-children area clickable, which is
          // what we want for the Inspector.
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
      // Clicks inside the room (walls, floor, furniture, inspector) should
      // never bubble out to the surrounding Rooms-tab cell, which would
      // otherwise drill into House Plan. Drill-down stays scoped to the
      // explicit "Enter House" footer button.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <svg
        viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
      >
        <RoomBackWall palette={palette} isDark={isDark} />
        {/* G1 — mood-coloured wallpaper overlay sits on top of the
            default wall so existing pattern stays visible underneath. */}
        <Clickable id={{ kind: "mood-wall" }} label="Mood wallpaper — クリックで詳細">
          <MoodWallpaper palette={moodPalette} />
        </Clickable>
        <RoomSideWall palette={palette} />
        <RoomFloor palette={palette} roomKind={roomKind} />
        <Clickable id={{ kind: "window" }} label="Window — 時刻と天気">
          <RoomWindow sky={sky} tod={tod} isStormy={weather === "stormy"} />
        </Clickable>
        {/* R6 F2 — window-through relationships overlay (parent house,
            children playing, passing friend). Clipped to the same window
            rect so silhouettes never leak onto the wall. */}
        <Clickable id={{ kind: "window-scene" }} label="Window scene — 関係セッション">
          <WindowSceneView scene={windowScene} windowBox={WINDOW_BOX} />
        </Clickable>
        <Clickable id={{ kind: "lamp" }} label="Pendant lamp — 夜間ライティング">
          <RoomLighting isDark={isDark} accent={palette.accent} />
        </Clickable>
        {/* C2 — family / friend photo frames mounted on the back wall. */}
        {dynamicSlots.frameSlots && (
          <Clickable id={{ kind: "frames" }} label="Relationship frames — 家族/友人">
            <RelationshipFrames
              frames={frames}
              slots={dynamicSlots.frameSlots}
            />
          </Clickable>
        )}
        {/* C1 — wall-mounted achievement frames. */}
        {dynamicSlots.achievementSlots && (
          <Clickable id={{ kind: "achievements" }} label="Achievement frames — スキル Lv">
            <AchievementFrames
              items={achievements.frames}
              slots={dynamicSlots.achievementSlots}
              accent={palette.accent}
            />
          </Clickable>
        )}
        {/* C1 — Lv 10 crown sits high on the wall when present. */}
        {achievements.hasCrown && (
          <Clickable id={{ kind: "crown" }} label="Crown — Lv 10 達成">
            <CrownDisplay slot={floorAchievementSlots[0]} />
          </Clickable>
        )}
        {/* Furniture is split into back / mid / front so the avatar sits
            in the middle layer, hidden by front items but in front of
            back-wall items. The four dynamic layers (mess / events /
            whiteboard / tool) are interleaved to read at a glance:
            mess sits on the floor under everything else; ceiling /
            wall events go behind front furniture; the whiteboard
            mounts to the back wall in front of wall furniture; the
            tool prop sits next to the avatar. */}
        {/* R6 G2 — wall-mounted containers. Bookshelf / Fridge sit on the
            back wall behind the emoji wall furniture so existing decor
            (clocks / certificates / book emoji) reads as foreground props. */}
        {showBookshelf && dynamicSlots.bookshelfSlot && (
          <Clickable id={{ kind: "bookshelf" }} label="Bookshelf — XP + 年齢">
            <Bookshelf
              slot={dynamicSlots.bookshelfSlot}
              bookCount={containerContents.bookCount}
              hues={containerContents.bookHues}
              sceneW={SCENE_W}
              sceneH={SCENE_H}
            />
          </Clickable>
        )}
        {showFridge && dynamicSlots.fridgeSlot && (
          <Clickable id={{ kind: "fridge" }} label="Fridge — Hunger need">
            <Fridge
              slot={dynamicSlots.fridgeSlot}
              level={containerContents.fridgeLevel}
              items={containerContents.fridgeItems}
              sceneW={SCENE_W}
              sceneH={SCENE_H}
            />
          </Clickable>
        )}
        <Clickable id={{ kind: "furniture" }} label="Static furniture — 部屋種別の固定家具">
          <FurnitureLayer items={furniture} layer="wall" />
        </Clickable>
        {dynamicSlots.whiteboardSlot && (
          <Clickable id={{ kind: "whiteboard" }} label="Whiteboard — TodoWrite checklist">
            <RoomWhiteboard
              items={roomState.whiteboardItems}
              slot={dynamicSlots.whiteboardSlot}
              accent={palette.accent}
            />
          </Clickable>
        )}
        {/* Axis 1 — TODO sticky-note cluster on the right wall, clear of whiteboard. */}
        <TodoStickyCluster count={roomState.todoStickyCount} />
        <FurnitureLayer items={furniture} layer="ceiling" />
        {dynamicSlots.eventSlots && (
          <Clickable id={{ kind: "events" }} label="Event decor — 直近 1h イベント">
            <EventDecorLayer
              events={roomState.events}
              slots={dynamicSlots.eventSlots}
              seed={seed}
            />
          </Clickable>
        )}
        <FurnitureLayer items={furniture} layer="floor-back" />
        {/* E1 — seasonal decoration on the floor. */}
        <Clickable id={{ kind: "season" }} label="Seasonal decor — 現在の季節">
          <SeasonDecor
            seasonal={temporal.seasonal}
            slot={dynamicSlots.seasonSlot}
          />
        </Clickable>
        {temporal.isChristmas && (
          <Clickable id={{ kind: "christmas-tree" }} label="Christmas tree — 12 月のみ">
            <ChristmasTree visible={temporal.isChristmas} />
          </Clickable>
        )}
        {/* C1 — trophies on the floor (Lv ≥ 7 / Lv ≥ 9). */}
        {achievements.hasTrophy && (
          <Clickable id={{ kind: "trophy" }} label="Trophy — 最高 Lv ≥ 7">
            <TrophyShelf
              slot={floorAchievementSlots[achievements.hasCrown ? 1 : 0]}
              large={achievements.hasGrandTrophy}
            />
          </Clickable>
        )}
        {/* C1 — red carpet under the avatar (Lv ≥ 9). */}
        {achievements.hasCarpet && (
          <Clickable id={{ kind: "carpet" }} label="Red carpet — Lv ≥ 9">
            <RedCarpet visible={achievements.hasCarpet} />
          </Clickable>
        )}
        {/* E2 — meal item on the desk-side table. */}
        <Clickable id={{ kind: "meal" }} label="Meal — 現在時刻の食事">
          <MealTable meal={temporal.meal} slot={dynamicSlots.mealSlot} />
        </Clickable>
        <FurnitureLayer items={furniture} layer="corner" />
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
        <FurnitureLayer items={furniture} layer="floor-mid" />
        {/* Axis 2 — Monitor live-code overlay on top of 🖥 emoji (workshop only). */}
        {monitorPos && roomState.monitorLines.length > 0 && (
          <MonitorScreen
            lines={roomState.monitorLines}
            sx={monitorPos.sx}
            sy={monitorPos.sy}
          />
        )}
        {/* F1 — pets sit on the floor in front of furniture, behind the
            avatar so the resident remains the visual anchor. */}
        {dynamicSlots.petSlots && petBundle.pets.length > 0 && (
          <Clickable id={{ kind: "pets" }} label="Pets — agent kind のコンパニオン">
            <PetGroup pets={petBundle.pets} slots={dynamicSlots.petSlots} />
          </Clickable>
        )}
        {/* Spawn-driven guests render behind the resident so the resident
            stays the visual anchor, with the overhead bustle banner on
            top of all avatars when intensity ≥ busy. */}
        {guests.length > 0 && (
          <Clickable id={{ kind: "guests" }} label="Guest agents — 来訪サブエージェント">
            <RoomGuests guests={guests} />
          </Clickable>
        )}
        <RoomAvatar card={card} detail={detail} now={now} />
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
        <FurnitureLayer items={furniture} layer="floor-front" />
        {isDark && <NightTint />}
      </svg>

      {/* Room-kind chip (top-left) — clickable for "why is this room?" */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSelected({ kind: "room-kind" });
        }}
        className="absolute top-1.5 left-1.5 px-1.5 h-5 inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[10px] font-mono cursor-pointer hover:opacity-100"
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

      {/* Always-visible state badge (top-right) — diagnostic: shows which
          object is currently selected so the user can verify clicks update
          state even when the inspector overlay isn't visible. */}
      <div
        className="absolute top-1.5 right-1.5 px-1.5 h-5 inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[9px] font-mono pointer-events-none"
        style={{
          background: selected ? "hsl(45, 95%, 55%)" : "rgba(0,0,0,0.6)",
          color: selected ? "#1a1a1a" : "#FAF6EC",
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        <span aria-hidden>{selected ? "🔍" : "·"}</span>
        <span>{selected ? selected.kind : "no selection"}</span>
      </div>

      {/* Inspector overlay — bottom-anchored card explaining what the clicked
          object represents. ESC also closes it. Background is intentionally
          high-contrast yellow so the panel is unmistakable against any room
          palette and can't be missed when state updates. */}
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
// Primitives
// ---------------------------------------------------------------------------

function RoomBackWall({ palette, isDark }: { palette: RoomPalette; isDark: boolean }) {
  // Back wall trapezoid (matches the floor perspective): from x≈40 to
  // x≈320 at y=0 down to y=110 (the horizon line).
  const wallId = "relay-room-wall-grad";
  const dotsId = "relay-room-wall-dots";
  return (
    <>
      <defs>
        <linearGradient id={wallId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.wallTop} />
          <stop offset="100%" stopColor={palette.wallBottom} />
        </linearGradient>
        <pattern id={dotsId} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill={palette.wallAccent} />
        </pattern>
      </defs>
      <rect x="0" y="0" width={SCENE_W} height="120" fill={`url(#${wallId})`} />
      <rect x="0" y="0" width={SCENE_W} height="120" fill={`url(#${dotsId})`} opacity={0.55} />
      {/* D2 — soft shadow band on the lamp's away side (left column). */}
      <rect
        x="0"
        y="0"
        width={SCENE_W}
        height="120"
        fill={`url(#${DIORAMA_DEFS.roomWallShadowBand})`}
        opacity={DIORAMA_ROOM.wallShadowOpacity}
      />
      {/* D2 — soft highlight band on the lit side (right column, under lamp). */}
      <rect
        x="0"
        y="0"
        width={SCENE_W}
        height="120"
        fill={`url(#${DIORAMA_DEFS.roomWallHighlightBand})`}
        opacity={DIORAMA_ROOM.wallHighlightOpacity}
      />
      {isDark && (
        <rect x="0" y="0" width={SCENE_W} height="120" fill="rgba(20, 25, 60, 0.28)" />
      )}
    </>
  );
}

function RoomSideWall({ palette }: { palette: RoomPalette }) {
  // A thin right-side wall slice to give the room a cubic feel. D2 — apply
  // depth fog so the far end desaturates a touch and the seam reads as
  // deeper space.
  return (
    <g aria-hidden>
      <polygon
        points={`${SCENE_W - 20},0 ${SCENE_W},0 ${SCENE_W},${SCENE_H} ${SCENE_W - 32},${SCENE_H}`}
        fill={palette.wallBottom}
        opacity={0.85}
      />
      {/* Depth fog — a cool wash darker at the far end. */}
      <polygon
        points={`${SCENE_W - 20},0 ${SCENE_W},0 ${SCENE_W},${SCENE_H} ${SCENE_W - 32},${SCENE_H}`}
        fill="rgba(20, 30, 60, 0.18)"
      />
      {/* Edge shadow at the corner seam. */}
      <rect
        x={SCENE_W - 22}
        y={0}
        width={2.5}
        height={SCENE_H}
        fill="rgba(0,0,0,0.28)"
      />
    </g>
  );
}

function RoomFloor({ palette, roomKind }: { palette: RoomPalette; roomKind: RoomKind }) {
  const gradId = "relay-room-floor-grad";
  const beamClip = "relay-room-floor-beam-clip";
  // F-3 — trophy / reception rooms get a polished marble floor; library /
  // study get a wood-grain wash. Other rooms keep the default plank look.
  const floorTexture =
    roomKind === "trophy" || roomKind === "reception"
      ? DIORAMA_DEFS.marble
      : roomKind === "library" || roomKind === "study"
        ? DIORAMA_DEFS.woodGrain
        : null;
  const floorTextureOpacity = roomKind === "trophy" || roomKind === "reception" ? 0.22 : 0.18;
  const floorTextureFill =
    roomKind === "trophy" || roomKind === "reception"
      ? "rgba(245, 245, 250, 0.6)"
      : "rgba(110, 78, 42, 0.9)";
  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.floorFar} />
          <stop offset="100%" stopColor={palette.floorNear} />
        </linearGradient>
        {/* Beam shape is clipped to the floor polygon. */}
        <clipPath id={beamClip}>
          <polygon
            points={`40,120 ${SCENE_W - 40},120 ${SCENE_W},${SCENE_H} 0,${SCENE_H}`}
          />
        </clipPath>
      </defs>
      {/* Trapezoid floor: narrow at the back, wide at the front. */}
      <polygon
        points={`40,120 ${SCENE_W - 40},120 ${SCENE_W},${SCENE_H} 0,${SCENE_H}`}
        fill={`url(#${gradId})`}
      />
      {/* F-3 — procedural texture overlay (marble or wood) for material
          rooms. Clipped to the floor polygon so it never spills onto walls. */}
      {floorTexture && (
        <g clipPath={`url(#${beamClip})`}>
          <polygon
            points={`40,120 ${SCENE_W - 40},120 ${SCENE_W},${SCENE_H} 0,${SCENE_H}`}
            fill={floorTextureFill}
            filter={`url(#${floorTexture})`}
            opacity={floorTextureOpacity}
          />
        </g>
      )}
      {/* Plank stripes — 3-tone (lit / mid / shadow) alternation. */}
      {Array.from({ length: 5 }).map((_, i) => {
        const y = 130 + i * 18;
        // i=0 darkest (back), tones cycle to lend depth
        const stroke =
          i % 3 === 0
            ? "rgba(0,0,0,0.28)"
            : i % 3 === 1
              ? "rgba(255,240,210,0.16)"
              : "rgba(0,0,0,0.16)";
        return (
          <line
            key={i}
            x1={0}
            y1={y}
            x2={SCENE_W}
            y2={y}
            stroke={stroke}
            strokeWidth={i % 3 === 1 ? 0.6 : 0.9}
          />
        );
      })}
      {/* D2 — Diagonal window light beam projected on the floor. The window
          sits at x=60..144, y=18..82. The beam is a parallelogram dropping
          down-right toward the foreground, clipped to the floor. */}
      <g clipPath={`url(#${beamClip})`}>
        <polygon
          points={`78,120 146,120 196,${SCENE_H - 8} 104,${SCENE_H - 8}`}
          fill={`url(#${DIORAMA_DEFS.roomFloorBeam})`}
          opacity={DIORAMA_ROOM.floorBeamOpacity}
        />
      </g>
    </>
  );
}

function RoomWindow({
  sky,
  tod,
  isStormy,
}: {
  sky: ReturnType<typeof skyPalette>;
  tod: TimeOfDay;
  isStormy: boolean;
}) {
  // Window in the top-left of the back wall.
  const x = 60;
  const y = 18;
  const w = 84;
  const h = 64;
  const skyId = "relay-room-window-sky";
  const skyColors = pickWindowColors(tod);
  return (
    <g>
      {/* Frame shadow */}
      <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} fill="rgba(0,0,0,0.18)" rx={2} />
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skyColors.top} />
          <stop offset="60%" stopColor={skyColors.mid} />
          <stop offset="100%" stopColor={skyColors.bottom} />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${skyId})`} />
      {/* Stars at night */}
      {sky.stars > 0 &&
        Array.from({ length: 6 }).map((_, i) => (
          <circle
            key={i}
            cx={x + 8 + i * 12 + (i % 2) * 4}
            cy={y + 12 + ((i * 13) % 30)}
            r={0.9}
            fill="#FFFCE0"
            opacity={0.85}
          />
        ))}
      {/* Sun / moon */}
      <circle
        cx={x + (tod === "morning" ? 16 : tod === "evening" ? w - 16 : w / 2)}
        cy={y + (tod === "noon" ? 22 : 30)}
        r={7}
        fill={sky.luminary === "moon" ? "#F5E9C5" : tod === "evening" ? "#FF7043" : "#FFD27E"}
        opacity={0.95}
      />
      {/* D2 — glass reflection sheen (upper-left corner). */}
      <polygon
        points={`${x},${y} ${x + w * 0.4},${y} ${x + w * 0.18},${y + h * 0.65} ${x},${y + h * 0.55}`}
        fill={`url(#${DIORAMA_DEFS.roomWindowReflection})`}
      />
      {/* Mullions — cross */}
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#FAF6EC" strokeWidth={2} />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#FAF6EC" strokeWidth={2} />
      {/* D2 — inner sash frame (slightly inset, gives the window depth). */}
      <rect
        x={x + 2}
        y={y + 2}
        width={w - 4}
        height={h - 4}
        fill="none"
        stroke="#E4D8B6"
        strokeWidth={0.8}
        opacity={0.85}
      />
      {/* Outer frame */}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#FAF6EC" strokeWidth={3} />
      {/* D2 — curtain drapes on left/right edges. Very thin so they don't
          eat the window content but suggest fabric volume. */}
      <path
        d={`M ${x - 6} ${y - 2}
            Q ${x - 4} ${y + h * 0.5} ${x - 6} ${y + h + 2}
            L ${x - 1} ${y + h + 2}
            Q ${x - 0.5} ${y + h * 0.5} ${x - 1} ${y - 2} Z`}
        fill="rgba(220, 90, 90, 0.5)"
        stroke="rgba(120, 40, 40, 0.55)"
        strokeWidth={0.4}
      />
      <path
        d={`M ${x + w + 1} ${y - 2}
            Q ${x + w + 0.5} ${y + h * 0.5} ${x + w + 1} ${y + h + 2}
            L ${x + w + 6} ${y + h + 2}
            Q ${x + w + 4} ${y + h * 0.5} ${x + w + 6} ${y - 2} Z`}
        fill="rgba(220, 90, 90, 0.5)"
        stroke="rgba(120, 40, 40, 0.55)"
        strokeWidth={0.4}
      />
      {/* Sill — top highlight band + main board + cast shadow below. */}
      <rect x={x - 4} y={y + h} width={w + 8} height={4} fill="#E4D8B6" />
      <rect x={x - 4} y={y + h} width={w + 8} height={1} fill="rgba(255,250,225,0.85)" />
      <rect x={x - 4} y={y + h + 4} width={w + 8} height={1.2} fill="rgba(0,0,0,0.30)" />
      {/* Storm raindrops — small inside the window for accent. */}
      {isStormy && (
        <g>
          {Array.from({ length: 8 }).map((_, i) => (
            <line
              key={i}
              x1={x + 6 + i * 10}
              y1={y + 6 + (i % 3) * 8}
              x2={x + 4 + i * 10}
              y2={y + 14 + (i % 3) * 8}
              stroke="rgba(180,200,230,0.85)"
              strokeWidth={1}
            />
          ))}
        </g>
      )}
    </g>
  );
}

function RoomLighting({ isDark, accent }: { isDark: boolean; accent: string }) {
  // Pendant lamp from the ceiling, slightly right of center. Glows at night.
  const cx = SCENE_W * 0.66;
  const cy = 8;
  return (
    <g>
      <line x1={cx} y1={0} x2={cx} y2={cy + 6} stroke="#3A2A1F" strokeWidth={1.5} />
      {/* Shade — D2: highlight band on top, shadow on the underside. */}
      <ellipse cx={cx} cy={cy + 8} rx={10} ry={5} fill="#4A3320" />
      <ellipse cx={cx - 1.5} cy={cy + 6.5} rx={6} ry={1.4} fill="rgba(255,235,200,0.55)" />
      <ellipse cx={cx} cy={cy + 10} rx={9} ry={1.2} fill="rgba(0,0,0,0.35)" />
      <circle cx={cx} cy={cy + 11} r={3.6} fill={isDark ? "#FFE9A5" : "#FFD27E"} />
      {isDark && (
        <>
          {/* Outer halo */}
          <circle cx={cx} cy={cy + 11} r={9} fill="#FFE9A5" opacity={0.22} />
          {/* D2 — volumetric light cone falling down to the floor. */}
          <polygon
            points={`${cx - 10},${cy + 12} ${cx + 10},${cy + 12} ${cx + 56},${SCENE_H - 6} ${cx - 56},${SCENE_H - 6}`}
            fill={`url(#${DIORAMA_DEFS.roomLampCone})`}
            opacity={DIORAMA_ROOM.lampConeOpacity}
          />
          {/* D2 — warm pocket where the cone hits the floor. */}
          <ellipse
            cx={cx}
            cy={SCENE_H - 18}
            rx={48}
            ry={10}
            fill={`url(#${DIORAMA_DEFS.roomLampWarmPocket})`}
            opacity={DIORAMA_ROOM.lampWarmOpacity}
          />
          {/* Accent halo (mood-tinted) — kept very subtle to avoid
              haloing the room avatar with a visible orange/blue ring. */}
          <polygon
            points={`${cx - 14},${cy + 14} ${cx + 14},${cy + 14} ${cx + 70},${SCENE_H} ${cx - 70},${SCENE_H}`}
            fill={accent}
            opacity={0.025}
          />
        </>
      )}
    </g>
  );
}

function NightTint() {
  // Subtle bluish overlay to make night-time rooms read as evening. D2 —
  // includes a localized warm pocket under the lamp so cool night doesn't
  // wash out the lit zone. **pointer-events: none is critical**: this
  // rect covers the entire SVG and would otherwise absorb every click,
  // preventing the Inspector from receiving any hit-test through the
  // <Clickable> wrappers underneath.
  return (
    <g aria-hidden pointerEvents="none">
      <rect
        x="0"
        y="0"
        width={SCENE_W}
        height={SCENE_H}
        fill="rgba(20, 28, 70, 0.18)"
        pointerEvents="none"
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Furniture layer — paints items whose `slot` matches `layer`
// ---------------------------------------------------------------------------

function FurnitureLayer({
  items,
  layer,
}: {
  items: readonly FurnitureItem[];
  layer: FurnitureItem["slot"];
}) {
  // The floor's y=0 (back wall) maps to scene y=120, y=1 (front) to y=215.
  // Wall-slot items are positioned along the back wall area instead.
  const filtered = items.filter((it) => it.slot === layer);
  // D2 — floor-anchored items get a small shadow ellipse under their feet.
  const hasFloorShadow =
    layer === "floor-back" || layer === "floor-mid" || layer === "floor-front" || layer === "corner";
  return (
    // pointer-events: none on the whole layer — furniture is decorative and
    // is sometimes drawn AFTER Clickable wrappers (mess / tool / pets etc.);
    // without this the emoji text would absorb clicks that should reach
    // those interactive layers behind it. The Clickable that wraps the
    // "wall" layer in RoomScene re-enables hit-testing for its own bounds.
    <g pointerEvents="none">
      {filtered.map((it, i) => {
        const sx = mapX(it);
        const sy = mapY(it);
        // Depth-based scale: items closer to the front appear larger.
        const depthScale = it.slot === "wall" || it.slot === "ceiling"
          ? 1.0
          : 0.85 + it.y * 0.35;
        const fontSize = 22 * it.scale * depthScale;
        // Shadow ellipse — sized to the emoji footprint.
        const shadowRx = fontSize * 0.42;
        const shadowRy = Math.max(1.2, fontSize * 0.10);
        return (
          <g key={`${layer}-${i}`} transform={`translate(${sx}, ${sy})`}>
            {hasFloorShadow && (
              <ellipse
                cx={0}
                cy={fontSize * 0.42}
                rx={shadowRx}
                ry={shadowRy}
                fill="rgba(0,0,0,0.22)"
                opacity={DIORAMA_ROOM.furnitureShadowOpacity}
              />
            )}
            <text
              x={0}
              y={0}
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                // Faint drop shadow keeps emoji legible on busy walls/floors.
                filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
              }}
            >
              {it.glyph}
            </text>
            {it.caption && (
              <text
                x={0}
                y={fontSize * 0.55 + 4}
                fontSize={7}
                textAnchor="middle"
                fill="rgba(255,255,255,0.65)"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                {it.caption}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Avatar — full-body figure sized for the room, using the shared
// HamletAvatar primitives so face + body match the rest of the village.
// ---------------------------------------------------------------------------

function RoomAvatar({
  card,
  detail,
  now,
}: {
  card: SimCardModel;
  detail: SessionDetail | undefined;
  now: number;
}) {
  const parts = useMemo(
    () => avatarPartsFromSeed(card.avatarSeed, card.stage.key),
    [card.avatarSeed, card.stage.key],
  );
  const expression = useMemo(() => getExpressionForMood(card.mood.key), [card.mood.key]);
  const clothes = clothingForAgent(card.sessionType);
  const accessories = useMemo(() => deriveAccessories(card, detail), [card, detail]);
  // Stand the avatar at the center-front, slightly off-center to leave
  // room for the sofa / desk / bed on the mid layer.
  const cx = SCENE_W * 0.62;
  const groundY = 200;
  const totalH = 70; // matches the legacy ~60-70px standing figure
  // Idle motion — three buckets driven by session silence:
  //   working (<5m)  → subtle desk-focus sway + 💦 sweat drops (hard at work)
  //   walking (5–30m) → pace the floor with a scaleX flip at each apex
  //   resting (≥30m) → lie down on the floor with 💤 Zzz (asleep)
  const motion: RoomAvatarMotion = computeRoomMotion(card, now);
  let paceStyle: CSSProperties | undefined;
  if (motion === "working") {
    paceStyle = {
      // Slow, almost-imperceptible head sway so the avatar reads as
      // *alive at the desk* rather than a frozen sprite. Pivot near the
      // feet so the head swings more than the legs.
      animation: "relayRoomAvatarFocus 2.8s ease-in-out infinite",
      transformBox: "fill-box",
      transformOrigin: "50% 90%",
    };
  } else if (motion === "walking") {
    paceStyle = {
      animation: "relayRoomAvatarPace 10s ease-in-out infinite",
      // Without an explicit transform-box, CSS transforms on SVG <g>
      // pivot from the SVG root and the scaleX flip would teleport the
      // avatar. fill-box pins the origin to the group's local bbox.
      transformBox: "fill-box",
      transformOrigin: `center ${totalH / 2}px`,
    };
  } else {
    // resting — rotate 90° CW around the feet so the body extends
    // horizontally along the floor (head pointing right). A 4s scaleY
    // expansion mimics chest rise/fall during sleep.
    paceStyle = {
      animation: "relayRoomAvatarRest 4.4s ease-in-out infinite",
      transformBox: "fill-box",
      transformOrigin: "50% 100%",
    };
  }
  return (
    // pointer-events: none — the resident avatar is decorative and is
    // drawn AFTER pet/guest Clickables; without this it would absorb
    // clicks meant for the pets/guests behind it.
    <g transform={`translate(${cx}, ${groundY - totalH})`} pointerEvents="none">
      <g style={paceStyle}>
        {/* Ground shadow under the feet */}
        <ellipse cx={0} cy={totalH + 1} rx={16} ry={3.5} fill="rgba(0,0,0,0.28)" />
        <HamletAvatar
          parts={parts}
          expression={expression}
          clothing={clothes}
          height={totalH}
          haloColor={card.mood.color}
          glasses={accessories.glasses}
          mustache={accessories.mustache}
          beard={accessories.beard}
          earring={accessories.earring}
          scarf={accessories.scarf}
        />
      </g>
      {/* Working-state "thinking / typing" dots — three small pips above
          the head that fade in/out on a rolling stagger, the same pattern
          Slack and IDE chat clients use for "typing…". Reads as "session
          is actively processing" without the panicked feel of 💦. */}
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
      {/* Zzz — floats above the lying avatar's head (which after rotation
          ends up to the right of the feet anchor). Two staggered glyphs
          keep the sleep loop continuous. */}
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

// Visitor avatar — appears next to the resident when the user has sent
// a message within the last 5 minutes. Visually distinct (warm orange
// clothing, fixed visitor seed) so it reads as "the player came over
// to give instructions" rather than another resident.
function RoomVisitor() {
  const parts = useMemo(
    () => avatarPartsFromSeed(hashStringToInt("user-visitor")),
    [],
  );
  const expression = useMemo(() => getExpressionForMood("happy"), []);
  const visitorClothing = useMemo(
    () => ({
      shirt: "hsl(28, 78%, 58%)",
      shirtDark: "hsl(24, 72%, 42%)",
      accent: "hsl(40, 85%, 80%)",
    }),
    [],
  );
  // Stand the visitor on the opposite side of the room from the
  // resident so they read as a pair greeting each other.
  const cx = SCENE_W * 0.32;
  const groundY = 200;
  const totalH = 64;
  return (
    <g transform={`translate(${cx}, ${groundY - totalH})`}>
      <ellipse cx={0} cy={totalH + 1} rx={14} ry={3.2} fill="rgba(0,0,0,0.25)" />
      <HamletAvatar
        parts={parts}
        expression={expression}
        clothing={visitorClothing}
        height={totalH}
      />
      {/* "Visitor" pip — small 👤 chip floats above to signal the human
          is in the room. Positioned so it doesn't overlap the head. */}
      <g transform={`translate(0, -8)`}>
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

// ---------------------------------------------------------------------------
// RoomGuests — sub-agent avatars that "drop by" the room while their parent
// session is the active resident. Each guest is a smaller HamletAvatar tinted
// by its own session-type clothing, with a per-guest bob/sway phase so the
// crowd reads as alive but not synchronized. A small accent halo at the
// guest's head color helps distinguish them from the resident.
// ---------------------------------------------------------------------------

function RoomGuests({ guests }: { guests: readonly RoomGuest[] }) {
  return (
    <g aria-hidden>
      {guests.map((g) => (
        <RoomGuestAvatar key={g.key} guest={g} />
      ))}
    </g>
  );
}

function RoomGuestAvatar({ guest }: { guest: RoomGuest }) {
  const parts = useMemo(() => avatarPartsFromSeed(guest.seed), [guest.seed]);
  const expression = useMemo(() => getExpressionForMood("happy"), []);
  const clothes = useMemo(() => clothingForAgent(guest.sessionType), [guest.sessionType]);
  const haloColor = `hsl(${guest.hue}, 70%, 60%)`;
  // Per-guest stagger so multiple guests don't bob in lockstep.
  const animStyle = {
    animation: `relayRoomGuestBob 2.4s ease-in-out ${guest.phase.toFixed(2)}s infinite`,
    transformOrigin: "center",
  } as const;
  return (
    <g transform={`translate(${guest.cx}, ${guest.groundY - guest.height})`}>
      <ellipse
        cx={0}
        cy={guest.height + 1}
        rx={guest.height * 0.22}
        ry={Math.max(2, guest.height * 0.055)}
        fill="rgba(0,0,0,0.24)"
      />
      <g style={animStyle}>
        <HamletAvatar
          parts={parts}
          expression={expression}
          clothing={clothes}
          height={guest.height}
          haloColor={haloColor}
        />
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// RoomBustleBanner — overhead chatter / sparkles / music notes that float
// above the resident when sub-agents are present. Intensity drives both the
// emoji set and the spawn count, mirroring the Neighborhood-side bustle.
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
  // Centered between the back row of guests and the lamp so the eye picks
  // it up without overlapping the avatars' heads.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapX(it: FurnitureItem): number {
  // Slight perspective: items further back compress towards center.
  const depth = it.slot === "wall" || it.slot === "ceiling" ? 0 : 1 - it.y;
  const compress = depth * 0.18; // 0..0.18
  const center = SCENE_W / 2;
  return center + (it.x - 0.5) * SCENE_W * (1 - compress);
}

function mapY(it: FurnitureItem): number {
  switch (it.slot) {
    case "wall":
      // Wall items live in the back-wall band (y 8..100).
      return 18 + it.y * 90;
    case "ceiling":
      return 10 + it.y * 8;
    case "corner":
      // Corner items sit near the seam of back wall + floor.
      return 110 + it.y * 70;
    case "floor-back":
      return 130 + it.y * 30;
    case "floor-mid":
      return 145 + it.y * 50;
    case "floor-front":
      return 180 + it.y * 25;
  }
}

function pickWindowColors(tod: TimeOfDay): {
  top: string;
  mid: string;
  bottom: string;
} {
  switch (tod) {
    case "morning":
      return { top: "#FFD9B3", mid: "#FFE9C9", bottom: "#C6E8F7" };
    case "noon":
      return { top: "#BEE6FB", mid: "#DCEEFC", bottom: "#F4FAFE" };
    case "evening":
      return { top: "#FFB070", mid: "#FF8FA3", bottom: "#9C6BBA" };
    case "night":
      return { top: "#0D1B3D", mid: "#1A2B55", bottom: "#0A1024" };
  }
}

// Style block used once per panel to register room-scene-only animations.
// Includes the dynamic-layer keyframes so the parent panel only needs one
// `<style>` import to get the full Room Scene visual vocabulary.
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
/* Resident avatar in-room pacing — used when the session is mildly idle
   (5m–30m silence). The flip slots at 50% / 100% land on the apexes so the
   avatar visually turns around before walking back. */
@keyframes relayRoomAvatarPace {
  0%   { transform: translateX(0)     scaleX(1); }
  45%  { transform: translateX(-60px) scaleX(1); }
  50%  { transform: translateX(-60px) scaleX(-1); }
  95%  { transform: translateX(50px)  scaleX(-1); }
  100% { transform: translateX(0)     scaleX(1); }
}
/* Resident avatar working-at-desk sway — used when the session is active
   (<5m silence). Pivots near the feet so the upper body leans into the
   work; sub-pixel deltas keep it from looking jittery. */
@keyframes relayRoomAvatarFocus {
  0%, 100% { transform: translateY(0)    rotate(0deg); }
  25%      { transform: translateY(0.3px) rotate(-0.6deg); }
  50%      { transform: translateY(-0.4px) rotate(0deg); }
  75%      { transform: translateY(0.3px) rotate(0.6deg); }
}
/* Resident avatar lying-down sleep — used when silence ≥ 30m. Pivot at
   the feet so the body lays flat along the floor; scaleY mimics chest
   rise/fall on a slow 4-ish second breathing cycle. */
@keyframes relayRoomAvatarRest {
  0%, 100% { transform: rotate(90deg) scaleY(1);    }
  50%      { transform: rotate(90deg) scaleY(1.05); }
}
/* Working-state thinking dots — three pips rolling in/out above the
   head, scale + opacity together so it reads as a soft "blink" rather
   than a hard flash. */
@keyframes relayRoomAvatarThink {
  0%, 100% { opacity: 0.18; transform: scale(0.85); }
  50%      { opacity: 1;    transform: scale(1.15); }
}
/* Resting-state Zzz — floats up from above the sleeping head. */
@keyframes relayRoomAvatarZzz {
  0%   { transform: translate(0, 0)     scale(0.55); opacity: 0; }
  20%  { opacity: 0.9; }
  100% { transform: translate(8px, -18px) scale(1.2);  opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  [style*="relayRoomGuestBob"],
  [style*="relayRoomBustleSparkle"],
  [style*="relayRoomAvatarPace"],
  [style*="relayRoomAvatarFocus"],
  [style*="relayRoomAvatarRest"],
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
