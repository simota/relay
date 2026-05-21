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
      className="relative w-full h-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
      style={{ background: palette.wallBottom, minHeight: 160 }}
      role="img"
      aria-label={`${roomKindLabel(roomKind)} interior view`}
    >
      <svg
        viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
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

function RoomFloor({ palette }: { palette: RoomPalette }) {
  const gradId = "relay-room-floor-grad";
  const beamClip = "relay-room-floor-beam-clip";
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
  // wash out the lit zone.
  return (
    <g aria-hidden>
      <rect
        x="0"
        y="0"
        width={SCENE_W}
        height={SCENE_H}
        fill="rgba(20, 28, 70, 0.18)"
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
    <g>
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

function RoomAvatar({ card }: { card: SimCardModel }) {
  const parts = useMemo(() => avatarPartsFromSeed(card.avatarSeed), [card.avatarSeed]);
  const expression = useMemo(() => getExpressionForMood(card.mood.key), [card.mood.key]);
  const clothes = clothingForAgent(card.sessionType);
  // Stand the avatar at the center-front, slightly off-center to leave
  // room for the sofa / desk / bed on the mid layer.
  const cx = SCENE_W * 0.62;
  const groundY = 200;
  const totalH = 70; // matches the legacy ~60-70px standing figure
  return (
    <g transform={`translate(${cx}, ${groundY - totalH})`}>
      {/* Ground shadow under the feet */}
      <ellipse cx={0} cy={totalH + 1} rx={16} ry={3.5} fill="rgba(0,0,0,0.28)" />
      <HamletAvatar
        parts={parts}
        expression={expression}
        clothing={clothes}
        height={totalH}
        haloColor={card.mood.color}
      />
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
${HAMLET_AVATAR_CSS}
`;
