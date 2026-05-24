"use client";

// Fleet Hamlet — Rooms grid mode.
//
// Renders every living resident as a compact "room card": small header
// (avatar + name + mood/lifestage chips), the shared RoomScene, and a
// footer with an Enter House action. The grid is responsive via CSS
// auto-fill — cells reflow as the viewport changes. Clicking the cell
// (anywhere outside the footer button) also drills into House Plan.
//
// 軸1: Neighbor Bond — 隣接セル間の手紙鳥アニメ + 隣人バッジ
// 軸2: Room Rankings — 各部屋に称号リボン
// 軸3: Collective Choreography — grid 全体の同期演出 overlay

import { DoorOpen } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  avatarPartsFromSeed,
  type SimCardModel,
} from "../_lib/fleet-hamlet";
import type { WeatherKind } from "../_lib/fleet-hamlet-layout";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";
import { statusColor } from "../_lib/fleet-timeline";
import { collectAllEvents } from "../_lib/fleet-hamlet-events";
import {
  computeRoomNeighbors,
  type RoomNeighborInfo,
} from "../_lib/fleet-hamlet-rooms-neighbor";
import { computeRoomTitles, type RoomTitle } from "../_lib/fleet-hamlet-rooms-titles";
import {
  computeRoomsChoreo,
  type ChoreoState,
} from "../_lib/fleet-hamlet-rooms-choreo";
import {
  HAMLET_AVATAR_CSS,
  HeadFace,
} from "./fleet-hamlet-avatar";
import { DECOR_CSS } from "./fleet-hamlet-decor";
import { PARTICLE_CSS } from "./fleet-hamlet-particles";
import { ROOM_SCENE_CSS, RoomScene } from "./fleet-hamlet-room-scene";
import { CHAT_BUBBLE_CSS, ChatBubbleStream } from "./fleet-hamlet-chat-bubbles";

interface FleetHamletRoomsProps {
  sims: readonly SimCardModel[];
  details: ReadonlyMap<string, SessionDetail>;
  now: number;
  onEnterHouse: (sim: SimCardModel) => void;
  weather?: WeatherKind;
}

export function FleetHamletRooms({
  sims,
  details,
  now,
  onEnterHouse,
  weather = "clear",
}: FleetHamletRoomsProps) {
  // Freeze the display order while the tab is mounted so live mood /
  // activity churn doesn't constantly reshuffle the cells (which is
  // visually jarring). Existing keys keep their slot; new sessions get
  // appended at the end; removed sessions drop out.
  const orderRef = useRef<string[]>([]);
  const frozenSims = useMemo(() => {
    const byKey = new Map(sims.map((s) => [s.key, s] as const));
    const result: SimCardModel[] = [];
    const seen = new Set<string>();
    for (const key of orderRef.current) {
      const s = byKey.get(key);
      if (s) {
        result.push(s);
        seen.add(key);
      }
    }
    for (const s of sims) {
      if (!seen.has(s.key)) {
        result.push(s);
        seen.add(s.key);
      }
    }
    return result;
  }, [sims]);
  useEffect(() => {
    orderRef.current = frozenSims.map((s) => s.key);
  }, [frozenSims]);

  // Layout target: up to 4 sessions per row, distributed evenly to fill
  // the browser width. Fewer than 4 sessions stretch to fill; more than
  // 4 wrap to the next row at 4 cells wide.
  const colCount = Math.min(Math.max(1, frozenSims.length), 4);

  // 軸1: 隣人情報
  const neighborMap = useMemo(
    () => computeRoomNeighbors(frozenSims),
    [frozenSims],
  );

  // 軸2: 称号バッジ
  const titleMap = useMemo(
    () => computeRoomTitles(frozenSims, details, now),
    [frozenSims, details, now],
  );

  // 軸3: 集合行動 — events は collectAllEvents で集計
  const choreoState = useMemo(() => {
    const events = collectAllEvents(frozenSims, details, now);
    return computeRoomsChoreo(frozenSims, events, now);
  }, [frozenSims, details, now]);

  return (
    <div className="h-full overflow-y-auto">
      <style>{DECOR_CSS}</style>
      <style>{PARTICLE_CSS}</style>
      <style>{HAMLET_AVATAR_CSS}</style>
      <style>{ROOM_SCENE_CSS}</style>
      <style>{CHAT_BUBBLE_CSS}</style>
      <style>{ROOMS_CHOREO_CSS}</style>
      <div className="relative">
        <ul
          className="grid gap-3 px-6 pt-4 pb-24"
          style={{
            gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
          }}
        >
          {frozenSims.map((sim) => (
            <RoomGridCell
              key={sim.key}
              sim={sim}
              allSims={sims}
              detail={details.get(sim.key)}
              now={now}
              weather={weather}
              neighbor={neighborMap.get(sim.key) ?? null}
              title={titleMap.get(sim.key) ?? null}
              workingSync={choreoState.workingSync}
              onEnterHouse={onEnterHouse}
            />
          ))}
        </ul>
        <RoomsChoreoOverlay state={choreoState} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell
// ---------------------------------------------------------------------------

interface RoomGridCellProps {
  sim: SimCardModel;
  allSims: readonly SimCardModel[];
  detail: SessionDetail | undefined;
  now: number;
  weather: WeatherKind;
  neighbor: RoomNeighborInfo | null;
  title: RoomTitle | null;
  workingSync: boolean;
  onEnterHouse: (sim: SimCardModel) => void;
}

function RoomGridCell({
  sim,
  allSims,
  detail,
  now,
  weather,
  neighbor,
  title,
  workingSync,
  onEnterHouse,
}: RoomGridCellProps) {
  const parts = useMemo(
    () => avatarPartsFromSeed(sim.avatarSeed, sim.stage.key),
    [sim.avatarSeed, sim.stage.key],
  );
  const expression = useMemo(
    () => getExpressionForMood(sim.mood.key),
    [sim.mood.key],
  );
  const accentColor = `hsl(${sim.hue}, 60%, 55%)`;

  return (
    <li
      className={cn(
        "group relative flex flex-col rounded-[var(--radius-md)] border border-[var(--color-border)]",
        "bg-[var(--color-bg)] overflow-hidden cursor-pointer",
        "transition-shadow shadow-[0_1px_2px_rgba(0,0,0,0.10)]",
        "hover:shadow-[0_4px_14px_rgba(0,0,0,0.16)] hover:border-[var(--color-fg-muted)]",
        workingSync && "rooms-working-sync",
      )}
      style={{ boxShadow: `inset 3px 0 0 0 ${accentColor}` }}
      onClick={(e) => {
        // Skip drill-down if the click was on the footer button itself —
        // the button stops propagation, but defensively also bail when
        // the closest interactive element is a button.
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        onEnterHouse(sim);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEnterHouse(sim);
        }
      }}
      aria-label={`enter house for ${sim.repo ?? sim.sessionId}`}
    >
      {/* 軸2: 称号リボン — 左上の絶対配置バッジ */}
      {title && (
        <div
          className="rooms-title-ribbon"
          title={title.label}
          aria-label={title.label}
        >
          <span aria-hidden>{title.emoji}</span>
          <span>{title.label}</span>
        </div>
      )}

      {/* Header */}
      <header className="shrink-0 flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--color-border)]">
        <span
          aria-hidden
          className="shrink-0 inline-block w-[28px] h-[28px]"
          style={{ lineHeight: 0 }}
        >
          <svg
            width={28}
            height={28}
            viewBox="0 0 48 48"
            aria-hidden
            overflow="visible"
          >
            <g transform="translate(24, 26)">
              <HeadFace
                parts={parts}
                expression={expression}
                radius={14}
                haloColor={sim.mood.color}
                enableBlink={false}
                enableCheeks={false}
              />
            </g>
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1 flex-wrap">
            <span
              className="text-[11.5px] font-mono text-[var(--color-fg)] truncate"
              title={sim.repo ?? "—"}
            >
              {sim.repo ?? "—"}
            </span>
            <span
              className="text-[9.5px] font-mono"
              style={{ color: accentColor }}
              title={sim.sessionType}
            >
              {sim.sessionType[0]}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 flex-wrap">
            <span
              className="inline-flex items-center gap-0.5 px-1 h-4 rounded-[var(--radius-sm)] text-[9px] font-mono border"
              style={{ borderColor: sim.mood.color, color: sim.mood.color }}
              title={`mood: ${sim.mood.label}`}
            >
              <span aria-hidden>{sim.mood.emoji}</span>
              <span>{sim.mood.label}</span>
            </span>
            <span
              className="inline-flex items-center gap-0.5 px-1 h-4 rounded-[var(--radius-sm)] text-[9px] font-mono border border-[var(--color-border)] text-[var(--color-fg-muted)]"
              title={`life-stage: ${sim.stage.label}`}
            >
              <span aria-hidden>{sim.stage.emoji}</span>
              <span>{sim.stage.label}</span>
            </span>
            {/* 軸1: 隣人バッジ */}
            {neighbor?.neighborNext && (
              <span
                className="inline-flex items-center gap-0.5 px-1 h-4 rounded-[var(--radius-sm)] text-[9px] font-mono border border-[var(--color-border)] text-[var(--color-fg-muted)]"
                title={neighbor.isRoommate
                  ? `ルームメイト: ${neighbor.neighborNext.repo ?? neighbor.neighborNext.sessionId}`
                  : `Next door: ${neighbor.neighborNext.repo ?? neighbor.neighborNext.sessionId}`}
                aria-label={neighbor.isRoommate ? "ルームメイト" : "隣人あり"}
              >
                <span aria-hidden>{neighbor.isRoommate ? "🏠" : "👋"}</span>
                {neighbor.isRoommate && <span>ルームメイト</span>}
              </span>
            )}
          </div>
        </div>
        <span
          aria-hidden
          className="shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ background: statusColor(sim.status) }}
          title={`status: ${sim.status ?? "—"}`}
        />
      </header>

      {/* 軸1: 手紙鳥 — 隣人がいる場合、セル右端から飛び出す演出 */}
      {neighbor?.neighborNext && (
        <div className="rooms-letter-bird" aria-hidden>
          ✉
        </div>
      )}

      {/* Room scene — fixed height so cells line up regardless of header
          text length. RoomScene preserves its internal aspect via SVG
          viewBox + preserveAspectRatio so the interior stays readable. */}
      <div
        className="w-full overflow-hidden shrink-0"
        style={{ height: 180 }}
      >
        <RoomScene
          card={sim}
          detail={detail}
          allCards={allSims}
          now={now}
          weather={weather}
        />
      </div>

      {/* Message Room — recent chatter, scoped to this resident. Fixed
          height so the cell always shows the Enter House footer
          on-screen; ChatBubbleStream owns the vertical scroll inside. */}
      <div
        className="flex flex-col border-t border-[var(--color-border)] bg-[var(--color-bg)] shrink-0"
        style={{ height: 360 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="px-2.5 pt-1 pb-0.5 text-[9px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] shrink-0">
          Message room
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatBubbleStream
            messages={detail?.messages ?? []}
            skills={detail?.skills ?? []}
            toolCalls={detail?.tool_calls ?? []}
            now={now}
            accentColor={accentColor}
          />
        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 px-2.5 py-1.5 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEnterHouse(sim);
          }}
          className={cn(
            "w-full inline-flex items-center justify-center gap-1 h-6 rounded-[var(--radius-sm)]",
            "border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-fg-muted)]",
            "hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]",
          )}
          aria-label="enter house"
        >
          <DoorOpen className="w-3 h-3" aria-hidden />
          Enter House →
        </button>
      </footer>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 軸3: Collective Choreography Overlay
// ---------------------------------------------------------------------------

interface RoomsChoreoOverlayProps {
  state: ChoreoState;
}

function RoomsChoreoOverlay({ state }: RoomsChoreoOverlayProps) {
  const { workingSync, restingCloud } = state;
  // moodSync / festivalActive intentionally not rendered — descending
  // emoji rain / confetti were too noisy and blocked the room cells.
  if (!workingSync && !restingCloud) return null;

  return (
    <div
      className="rooms-choreo-overlay"
      aria-hidden
      aria-live="off"
    >
      {/* workingSync: stretch banner */}
      {workingSync && (
        <div className="rooms-choreo-stretch">
          🧘 一斉ストレッチタイム
        </div>
      )}

      {/* restingCloud: shared 💤 cloud */}
      {restingCloud && (
        <div className="rooms-choreo-cloud">
          💤💤💤
        </div>
      )}

      {/* Top-down rains (moodSync emoji shower + festivalActive confetti)
          were removed — readers found them visually noisy and they
          obscured the room cells. The state is still computed and could
          be surfaced via a quieter non-descending indicator in future. */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS — choreography + neighbor bond + room titles
// ---------------------------------------------------------------------------

const ROOMS_CHOREO_CSS = `
/* reduced-motion: disable all choreography animations */
@media (prefers-reduced-motion: reduce) {
  .rooms-letter-bird,
  .rooms-choreo-stretch,
  .rooms-choreo-cloud {
    animation: none !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
}

/* workingSync border glow */
.rooms-working-sync {
  animation: rooms-sync-glow 2s ease-in-out infinite alternate;
}
@keyframes rooms-sync-glow {
  from { box-shadow: inset 3px 0 0 0 var(--rooms-accent, #888), 0 0 0 0 transparent; }
  to   { box-shadow: inset 3px 0 0 0 var(--rooms-accent, #888), 0 0 8px 2px rgba(120,200,255,0.25); }
}

/* 軸1: 手紙鳥 */
.rooms-letter-bird {
  position: absolute;
  right: -6px;
  top: 40%;
  font-size: 12px;
  animation: rooms-letter-fly 8s linear infinite;
  pointer-events: none;
  z-index: 10;
}
@keyframes rooms-letter-fly {
  0%   { transform: translateX(0) translateY(0) scale(0.7); opacity: 0; }
  10%  { opacity: 1; }
  50%  { transform: translateX(12px) translateY(-6px) scale(1); opacity: 0.9; }
  90%  { opacity: 0.3; }
  100% { transform: translateX(28px) translateY(2px) scale(0.5); opacity: 0; }
}

/* 軸2: 称号リボン */
.rooms-title-ribbon {
  position: absolute;
  top: 0;
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 5px;
  font-size: 10px;
  line-height: 1.4;
  background: rgba(0,0,0,0.55);
  color: #fff;
  border-bottom-left-radius: 6px;
  z-index: 5;
  pointer-events: none;
  backdrop-filter: blur(4px);
}

/* 軸3: overlay wrapper */
.rooms-choreo-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 20;
  overflow: hidden;
}

/* stretch banner */
.rooms-choreo-stretch {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(120, 200, 255, 0.15);
  border: 1px solid rgba(120, 200, 255, 0.3);
  border-radius: 99px;
  padding: 2px 12px;
  font-size: 11px;
  color: rgba(120, 200, 255, 0.9);
  animation: rooms-fade-pulse 3s ease-in-out infinite;
}
@keyframes rooms-fade-pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}

/* resting cloud */
.rooms-choreo-cloud {
  position: absolute;
  top: 6px;
  right: 12px;
  font-size: 16px;
  animation: rooms-cloud-float 4s ease-in-out infinite;
}
@keyframes rooms-cloud-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-4px); }
}

`;
