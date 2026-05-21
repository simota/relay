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

import { useMemo } from "react";
import type { SessionDetail } from "@/lib/api";
import type { WeatherKind } from "../_lib/fleet-hamlet-layout";
import {
  avatarPartsFromSeed,
  hashStringToInt,
  type SimCardModel,
} from "../_lib/fleet-hamlet";
import {
  skyPalette,
  timeOfDay,
  type TimeOfDay,
} from "../_lib/fleet-hamlet-decor";
import type { RoomKind } from "../_lib/fleet-hamlet-house";
import { selectActiveRoom } from "../_lib/fleet-hamlet-particles";
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
import {
  EventDecorLayer,
  MessLayer,
  ROOM_STATE_CSS,
  RoomWhiteboard,
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
  // Swap any plant-tagged furniture to a wilted glyph when silence is long.
  const furniture = useMemo(() => {
    if (!roomState.plantsWilted) return furnitureRaw;
    return furnitureRaw.map((it) =>
      it.swapKind === "plant" ? { ...it, glyph: "🥀" } : it,
    );
  }, [furnitureRaw, roomState.plantsWilted]);
  const dynamicSlots = useMemo(() => getRoomDynamicSlots(roomKind), [roomKind]);
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
  // Which room kinds get a bookshelf vs. fridge — gated by template slots,
  // but kept explicit so the renderer reads at a glance.
  const showBookshelf =
    roomKind === "library" ||
    roomKind === "workshop" ||
    roomKind === "study" ||
    roomKind === "reception";
  const showFridge = roomKind === "living" || roomKind === "nursery";

  return (
    <div
      className="relative w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
      style={{ aspectRatio: `${SCENE_W} / ${SCENE_H}`, background: palette.wallBottom }}
      role="img"
      aria-label={`${roomKindLabel(roomKind)} interior view`}
    >
      <svg
        viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <RoomBackWall palette={palette} isDark={isDark} />
        {/* G1 — mood-coloured wallpaper overlay sits on top of the
            default wall so existing pattern stays visible underneath. */}
        <MoodWallpaper palette={moodPalette} />
        <RoomSideWall palette={palette} />
        <RoomFloor palette={palette} />
        <RoomWindow sky={sky} tod={tod} isStormy={weather === "stormy"} />
        {/* R6 F2 — window-through relationships overlay (parent house,
            children playing, passing friend). Clipped to the same window
            rect so silhouettes never leak onto the wall. */}
        <WindowSceneView scene={windowScene} windowBox={WINDOW_BOX} />
        <RoomLighting isDark={isDark} accent={palette.accent} />
        {/* C2 — family / friend photo frames mounted on the back wall. */}
        {dynamicSlots.frameSlots && (
          <RelationshipFrames
            frames={frames}
            slots={dynamicSlots.frameSlots}
          />
        )}
        {/* C1 — wall-mounted achievement frames. */}
        {dynamicSlots.achievementSlots && (
          <AchievementFrames
            items={achievements.frames}
            slots={dynamicSlots.achievementSlots}
            accent={palette.accent}
          />
        )}
        {/* C1 — Lv 10 crown sits high on the wall when present. */}
        {achievements.hasCrown && (
          <CrownDisplay slot={floorAchievementSlots[0]} />
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
          <Bookshelf
            slot={dynamicSlots.bookshelfSlot}
            bookCount={containerContents.bookCount}
            hues={containerContents.bookHues}
            sceneW={SCENE_W}
            sceneH={SCENE_H}
          />
        )}
        {showFridge && dynamicSlots.fridgeSlot && (
          <Fridge
            slot={dynamicSlots.fridgeSlot}
            level={containerContents.fridgeLevel}
            items={containerContents.fridgeItems}
            sceneW={SCENE_W}
            sceneH={SCENE_H}
          />
        )}
        <FurnitureLayer items={furniture} layer="wall" />
        {dynamicSlots.whiteboardSlot && (
          <RoomWhiteboard
            items={roomState.whiteboardItems}
            slot={dynamicSlots.whiteboardSlot}
            accent={palette.accent}
          />
        )}
        <FurnitureLayer items={furniture} layer="ceiling" />
        {dynamicSlots.eventSlots && (
          <EventDecorLayer
            events={roomState.events}
            slots={dynamicSlots.eventSlots}
            seed={seed}
          />
        )}
        <FurnitureLayer items={furniture} layer="floor-back" />
        {/* E1 — seasonal decoration on the floor. */}
        <SeasonDecor
          seasonal={temporal.seasonal}
          slot={dynamicSlots.seasonSlot}
        />
        <ChristmasTree visible={temporal.isChristmas} />
        {/* C1 — trophies on the floor (Lv ≥ 7 / Lv ≥ 9). */}
        {achievements.hasTrophy && (
          <TrophyShelf
            slot={floorAchievementSlots[achievements.hasCrown ? 1 : 0]}
            large={achievements.hasGrandTrophy}
          />
        )}
        {/* C1 — red carpet under the avatar (Lv ≥ 9). */}
        <RedCarpet visible={achievements.hasCarpet} />
        {/* E2 — meal item on the desk-side table. */}
        <MealTable meal={temporal.meal} slot={dynamicSlots.mealSlot} />
        <FurnitureLayer items={furniture} layer="corner" />
        {dynamicSlots.messSlots && (
          <MessLayer
            level={roomState.messLevel}
            errorBoost={roomState.errorBoost}
            slots={dynamicSlots.messSlots}
            seed={seed}
          />
        )}
        <FurnitureLayer items={furniture} layer="floor-mid" />
        {/* F1 — pets sit on the floor in front of furniture, behind the
            avatar so the resident remains the visual anchor. */}
        {dynamicSlots.petSlots && (
          <PetGroup pets={petBundle.pets} slots={dynamicSlots.petSlots} />
        )}
        <RoomAvatar card={card} />
        {roomState.toolProp && dynamicSlots.toolSlot && (
          <ToolPropSvg
            kind={roomState.toolProp}
            slot={dynamicSlots.toolSlot}
            accent={palette.accent}
          />
        )}
        <FurnitureLayer items={furniture} layer="floor-front" />
        {isDark && <NightTint />}
      </svg>

      {/* Room-kind chip (top-left) */}
      <div
        className="absolute top-1.5 left-1.5 px-1.5 h-5 inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[10px] font-mono"
        style={{
          background: "var(--color-bg)",
          color: palette.accent,
          border: `1px solid ${palette.accent}`,
          opacity: 0.92,
        }}
      >
        <span aria-hidden>🚪</span>
        <span>{roomKindLabel(roomKind)}</span>
      </div>
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
      {isDark && (
        <rect x="0" y="0" width={SCENE_W} height="120" fill="rgba(20, 25, 60, 0.28)" />
      )}
    </>
  );
}

function RoomSideWall({ palette }: { palette: RoomPalette }) {
  // A thin right-side wall slice to give the room a cubic feel.
  return (
    <polygon
      points={`${SCENE_W - 20},0 ${SCENE_W},0 ${SCENE_W},${SCENE_H} ${SCENE_W - 32},${SCENE_H}`}
      fill={palette.wallBottom}
      opacity={0.85}
    />
  );
}

function RoomFloor({ palette }: { palette: RoomPalette }) {
  const gradId = "relay-room-floor-grad";
  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.floorFar} />
          <stop offset="100%" stopColor={palette.floorNear} />
        </linearGradient>
      </defs>
      {/* Trapezoid floor: narrow at the back, wide at the front. */}
      <polygon
        points={`40,120 ${SCENE_W - 40},120 ${SCENE_W},${SCENE_H} 0,${SCENE_H}`}
        fill={`url(#${gradId})`}
      />
      {/* Subtle plank stripes for wood / tile feel. */}
      {Array.from({ length: 5 }).map((_, i) => {
        const y = 130 + i * 18;
        return (
          <line
            key={i}
            x1={0}
            y1={y}
            x2={SCENE_W}
            y2={y}
            stroke="rgba(0,0,0,0.18)"
            strokeWidth={0.8}
          />
        );
      })}
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
      {/* Mullions — cross */}
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#FAF6EC" strokeWidth={2} />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#FAF6EC" strokeWidth={2} />
      {/* Outer frame */}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#FAF6EC" strokeWidth={3} />
      {/* Sill */}
      <rect x={x - 4} y={y + h} width={w + 8} height={4} fill="#E4D8B6" />
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
      <ellipse cx={cx} cy={cy + 8} rx={10} ry={5} fill="#4A3320" />
      <circle cx={cx} cy={cy + 11} r={3.6} fill={isDark ? "#FFE9A5" : "#FFD27E"} />
      {isDark && (
        <>
          <circle cx={cx} cy={cy + 11} r={9} fill="#FFE9A5" opacity={0.22} />
          <polygon
            points={`${cx - 14},${cy + 14} ${cx + 14},${cy + 14} ${cx + 70},${SCENE_H} ${cx - 70},${SCENE_H}`}
            fill={accent}
            opacity={0.08}
          />
        </>
      )}
    </g>
  );
}

function NightTint() {
  // Subtle bluish overlay to make night-time rooms read as evening.
  return (
    <rect
      x="0"
      y="0"
      width={SCENE_W}
      height={SCENE_H}
      fill="rgba(20, 28, 70, 0.18)"
    />
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
  return (
    <g>
      {filtered.map((it, i) => {
        const sx = mapX(it);
        const sy = mapY(it);
        // Depth-based scale: items closer to the front appear larger.
        const depthScale = it.slot === "wall" || it.slot === "ceiling"
          ? 1.0
          : 0.85 + it.y * 0.35;
        const fontSize = 22 * it.scale * depthScale;
        return (
          <g key={`${layer}-${i}`} transform={`translate(${sx}, ${sy})`}>
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
// Avatar — stand-alone SVG figure sized for the room
// ---------------------------------------------------------------------------

function RoomAvatar({ card }: { card: SimCardModel }) {
  const parts = useMemo(() => avatarPartsFromSeed(card.avatarSeed), [card.avatarSeed]);
  // Stand the avatar at the center-front, slightly off-center to leave
  // room for the sofa / desk / bed on the mid layer.
  const cx = SCENE_W * 0.62;
  const groundY = 195;
  const skin = `hsl(${parts.skinHue}, 45%, 70%)`;
  const hair = `hsl(${parts.hairHue}, 50%, 30%)`;
  const clothes = clothingColor(card.sessionType);
  // Stressed → slight forward lean; Bored → slight back lean.
  const lean =
    card.mood.key === "stressed" ? -3 : card.mood.key === "bored" ? 2 : 0;
  return (
    <g transform={`translate(${cx}, ${groundY})`}>
      {/* shadow */}
      <ellipse cx={0} cy={2} rx={16} ry={3.5} fill="rgba(0,0,0,0.28)" />
      <g transform={`rotate(${lean}) translate(0, -2)`}>
        {/* legs */}
        <rect x={-7} y={-22} width={5.5} height={22} fill="#3A2C24" rx={1.5} />
        <rect x={1.5} y={-22} width={5.5} height={22} fill="#3A2C24" rx={1.5} />
        {/* torso */}
        <path
          d="M -12 -22 L -8 -42 L 8 -42 L 12 -22 Z"
          fill={clothes.shirt}
        />
        <path d="M -8 -42 L 0 -36 L 8 -42 Z" fill={clothes.accent} />
        {/* arms */}
        <rect x={-15} y={-40} width={4} height={18} fill={clothes.shirtDark} rx={1.5} />
        <rect x={11} y={-40} width={4} height={18} fill={clothes.shirtDark} rx={1.5} />
        {/* neck */}
        <rect x={-3} y={-46} width={6} height={5} fill={skin} />
        {/* head */}
        <circle cx={0} cy={-54} r={10} fill={skin} stroke={card.mood.color} strokeOpacity={0.55} strokeWidth={1} />
        {/* hair */}
        {parts.hairStyle === 0 && (
          <path d={`M -10 -54 A 10 10 0 0 1 10 -54 L 10 -58 L -10 -58 Z`} fill={hair} />
        )}
        {parts.hairStyle === 1 && (
          <>
            <circle cx={0} cy={-62} r={3.5} fill={hair} />
            <path d={`M -9 -54 A 10 10 0 0 1 9 -54 L 9 -58 L -9 -58 Z`} fill={hair} />
          </>
        )}
        {parts.hairStyle === 2 && (
          <path
            d="M -10 -54 Q -8 -66 0 -66 Q 8 -66 10 -54 L 11 -46 L 6 -52 L 3 -46 L 0 -52 L -3 -46 L -6 -52 L -11 -46 Z"
            fill={hair}
          />
        )}
        {parts.hairStyle === 3 && (
          <rect x={-3} y={-66} width={6} height={12} fill={hair} rx={1.5} />
        )}
        {/* eyes */}
        {parts.eyeShape === 0 && (
          <>
            <circle cx={-3.2} cy={-53} r={1.1} fill="#1a1a1a" />
            <circle cx={3.2} cy={-53} r={1.1} fill="#1a1a1a" />
          </>
        )}
        {parts.eyeShape === 1 && (
          <>
            <rect x={-4.5} y={-53.5} width={2.5} height={1} fill="#1a1a1a" />
            <rect x={2} y={-53.5} width={2.5} height={1} fill="#1a1a1a" />
          </>
        )}
        {parts.eyeShape === 2 && (
          <>
            <path d="M -5 -52 Q -3 -54 -1 -52" stroke="#1a1a1a" strokeWidth={0.9} fill="none" />
            <path d="M 1 -52 Q 3 -54 5 -52" stroke="#1a1a1a" strokeWidth={0.9} fill="none" />
          </>
        )}
        {/* mouth */}
        <path
          d="M -3 -49 Q 0 -47.5 3 -49"
          stroke="#3a2a2a"
          strokeWidth={0.9}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

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

function clothingColor(kind: SimCardModel["sessionType"]) {
  if (kind === "claude")
    return {
      shirt: "hsl(215, 65%, 58%)",
      shirtDark: "hsl(218, 70%, 42%)",
      accent: "hsl(208, 80%, 75%)",
    };
  if (kind === "codex")
    return {
      shirt: "hsl(135, 50%, 48%)",
      shirtDark: "hsl(138, 55%, 32%)",
      accent: "hsl(120, 60%, 75%)",
    };
  if (kind === "antigravity")
    return {
      shirt: "hsl(275, 55%, 58%)",
      shirtDark: "hsl(278, 60%, 40%)",
      accent: "hsl(290, 65%, 78%)",
    };
  return {
    shirt: "hsl(30, 45%, 55%)",
    shirtDark: "hsl(28, 50%, 38%)",
    accent: "hsl(38, 65%, 75%)",
  };
}

// Style block used once per panel to register room-scene-only animations.
// Includes the dynamic-layer keyframes so the parent panel only needs one
// `<style>` import to get the full Room Scene visual vocabulary.
export const ROOM_SCENE_CSS = `
@keyframes relayRoomLampBreathe {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
${ROOM_STATE_CSS}
${ROOM_LIFE_CSS}
${ROOM_TEMPORAL_CSS}
${ROOM_COMPANION_CSS}
${ROOM_CONTAINERS_CSS}
`;
