"use client";

// Fleet Hamlet — Neighborhood Right Panel ("Interior Panel").
//
// Renders the currently-selected resident as an interior scene: a compact
// header (avatar + name + chips + close), the Room Scene (cutaway view of
// the resident's active room with furniture + window + avatar), the most
// recent chat bubbles (user/assistant exchanges), and a footer with the
// Enter-House button.
//
// The deeper drill-down (8 needs / Skills / Relations / detailed Events /
// Lifetime) lives in the House Plan view; this panel intentionally stays
// scene-first so the village feels lived-in at a glance.

import { DoorOpen, MousePointerClick, X } from "lucide-react";
import { useMemo } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { avatarPartsFromSeed, type SimCardModel } from "../_lib/fleet-hamlet";
import { moodGradient } from "../_lib/fleet-hamlet-decor";
import type { WeatherKind } from "../_lib/fleet-hamlet-layout";
import { deriveAccessories } from "../_lib/fleet-hamlet-particles";
import { statusColor } from "../_lib/fleet-timeline";
import { AvatarBody, DECOR_CSS } from "./fleet-hamlet-decor";
import {
  CHAT_BUBBLE_CSS,
  ChatBubbleStream,
} from "./fleet-hamlet-chat-bubbles";
import { CrownSvg, HatSvg, PARTICLE_CSS } from "./fleet-hamlet-particles";
import { ROOM_SCENE_CSS, RoomScene } from "./fleet-hamlet-room-scene";

interface Props {
  selectedSim: SimCardModel | null;
  allSims: readonly SimCardModel[];
  detailByKey: ReadonlyMap<string, SessionDetail>;
  now: number;
  weather?: WeatherKind;
  /** Drill into House Plan for the *selected* resident (footer button). */
  onEnterHouse: (sim: SimCardModel) => void;
  /**
   * Update the neighborhood selection (URL `sel=`). Used by the empty-state
   * shortcut chips and by the header Close button.
   */
  onSelect: (sim: SimCardModel | null) => void;
}

export function FleetHamletNeighborhoodPanel({
  selectedSim,
  allSims,
  detailByKey,
  now,
  weather = "clear",
  onEnterHouse,
  onSelect,
}: Props) {
  return (
    <aside className="h-full w-full flex flex-col overflow-hidden bg-[var(--color-bg)]/95">
      <style>{DECOR_CSS}</style>
      <style>{PARTICLE_CSS}</style>
      <style>{ROOM_SCENE_CSS}</style>
      <style>{CHAT_BUBBLE_CSS}</style>
      {selectedSim ? (
        <InteriorView
          sim={selectedSim}
          allSims={allSims}
          detail={detailByKey.get(selectedSim.key)}
          now={now}
          weather={weather}
          onEnterHouse={onEnterHouse}
          onClose={() => onSelect(null)}
        />
      ) : (
        <EmptyState allSims={allSims} now={now} onSelect={onSelect} />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Interior view — populated when something is selected
// ---------------------------------------------------------------------------

interface InteriorViewProps {
  sim: SimCardModel;
  allSims: readonly SimCardModel[];
  detail: SessionDetail | undefined;
  now: number;
  weather: WeatherKind;
  onEnterHouse: (sim: SimCardModel) => void;
  onClose: () => void;
}

function InteriorView({
  sim,
  allSims,
  detail,
  now,
  weather,
  onEnterHouse,
  onClose,
}: InteriorViewProps) {
  const parts = useMemo(
    () => avatarPartsFromSeed(sim.avatarSeed),
    [sim.avatarSeed],
  );
  const grad = useMemo(() => moodGradient(sim.mood.key), [sim.mood.key]);
  const accessories = useMemo(
    () => deriveAccessories(sim, detail),
    [sim, detail],
  );
  const accentColor = useMemo(
    () => `hsl(${sim.hue}, 60%, 55%)`,
    [sim.hue],
  );

  return (
    <>
      {/* Compact header */}
      <header
        className="shrink-0 px-3 py-2 border-b border-[var(--color-border)] flex items-start gap-2.5"
        style={{
          backgroundImage: `${grad.bg}, linear-gradient(0deg, var(--color-bg), var(--color-bg))`,
        }}
      >
        <div className="shrink-0 flex flex-col items-center relative">
          {accessories.crown && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -6,
                left: "50%",
                marginLeft: -9,
                zIndex: 2,
                animation: "relayHamletTwinkle 2s ease-in-out infinite",
              }}
            >
              <CrownSvg />
            </span>
          )}
          {!accessories.crown && accessories.hat !== "none" && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -4,
                left: "50%",
                marginLeft: -10,
                zIndex: 2,
              }}
            >
              <HatSvg kind={accessories.hat} />
            </span>
          )}
          <HeaderAvatar
            skinHue={parts.skinHue}
            hairHue={parts.hairHue}
            hairStyle={parts.hairStyle}
            eyeShape={parts.eyeShape}
            moodColor={sim.mood.color}
          />
          <AvatarBody agentKind={sim.sessionType} width={42} height={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span
              className="text-[12.5px] font-mono truncate text-[var(--color-fg)]"
              title={sim.repo ?? "—"}
            >
              {sim.repo ?? "—"}
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: accentColor }}
              title={sim.sessionType}
            >
              {sim.sessionType[0]}
            </span>
            {sim.agentId && (
              <span
                className="text-[10px] font-mono text-[var(--color-fg-dim)] truncate"
                title={sim.agentId}
              >
                · {sim.agentId}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[9px] font-mono text-[var(--color-fg-dim)] truncate">
            id: {sim.sessionId.slice(0, 18)}…
          </div>
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            <span
              className="inline-flex items-center gap-0.5 px-1.5 h-4 rounded-[var(--radius-sm)] text-[9.5px] font-mono border"
              style={{
                borderColor: sim.mood.color,
                color: sim.mood.color,
              }}
              title={`mood: ${sim.mood.label}`}
            >
              <span aria-hidden>{sim.mood.emoji}</span>
              <span>{sim.mood.label}</span>
            </span>
            <span
              className="inline-flex items-center gap-0.5 px-1.5 h-4 rounded-[var(--radius-sm)] text-[9.5px] font-mono border border-[var(--color-border)] text-[var(--color-fg-muted)]"
              title={`life-stage: ${sim.stage.label}`}
            >
              <span aria-hidden>{sim.stage.emoji}</span>
              <span>{sim.stage.label}</span>
            </span>
            <span
              aria-hidden
              className="inline-block w-1.5 h-1.5 rounded-full ml-0.5"
              style={{ background: statusColor(sim.status) }}
              title={`status: ${sim.status ?? "—"}`}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close inspector"
          title="clear selection"
          className="shrink-0 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </header>

      {/* Body — Room Scene (top, ~58%) + Chat Bubbles (bottom, ~42%) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          className="shrink-0 px-2 pt-2"
          style={{ flexBasis: "58%", flexGrow: 0, minHeight: 0 }}
        >
          <RoomScene
            card={sim}
            detail={detail}
            allCards={allSims}
            now={now}
            weather={weather}
          />
        </div>
        <div
          className="flex-1 min-h-0 border-t border-[var(--color-border)] mt-2 overflow-hidden flex flex-col"
        >
          <div className="px-3 pt-1.5 pb-0.5 text-[9px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] shrink-0">
            Recent chatter
          </div>
          <div className="flex-1 min-h-0">
            <ChatBubbleStream
              messages={detail?.messages ?? []}
              now={now}
              accentColor={accentColor}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 px-3 py-2 border-t border-[var(--color-border)] flex items-center gap-2">
        <button
          type="button"
          onClick={() => onEnterHouse(sim)}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-[var(--radius-sm)]",
            "border border-[var(--color-accent)] text-[var(--color-accent)] text-[11px] font-mono",
            "hover:bg-[var(--color-accent)]/10",
          )}
          aria-label="enter house plan"
        >
          <DoorOpen className="w-3.5 h-3.5" aria-hidden />
          Enter House →
        </button>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "inline-flex items-center justify-center gap-1 h-7 px-2 rounded-[var(--radius-sm)]",
            "border border-[var(--color-border)] text-[var(--color-fg-muted)] text-[11px] font-mono",
            "hover:text-[var(--color-fg)]",
          )}
          aria-label="clear selection"
        >
          Close
        </button>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  allSims,
  now,
  onSelect,
}: {
  allSims: readonly SimCardModel[];
  now: number;
  onSelect: (sim: SimCardModel) => void;
}) {
  // Surface up to 3 of the most recently active residents as quick picks
  // so the panel is never a true dead-end when the village has life.
  const suggestions = useMemo(() => {
    return [...allSims]
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 3);
  }, [allSims]);

  return (
    <div className="h-full w-full flex flex-col items-center justify-center px-6 py-8 text-center">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center border border-[var(--color-border)] text-[28px] mb-3 text-[var(--color-fg-muted)]"
        aria-hidden
      >
        <MousePointerClick className="w-7 h-7" aria-hidden />
      </div>
      <div className="text-[12px] font-mono text-[var(--color-fg-muted)]">
        Pick a house to peek inside
      </div>
      <div className="mt-1 text-[10.5px] font-mono text-[var(--color-fg-dim)] max-w-[220px] leading-snug">
        Click a resident on the left to enter their room and read their
        latest chatter.
      </div>
      {suggestions.length > 0 && (
        <div className="mt-4 w-full flex flex-col gap-1">
          <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] mb-0.5">
            Most active
          </div>
          {suggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect(s)}
              className={cn(
                "w-full inline-flex items-center justify-between gap-2 px-2 h-7",
                "rounded-[var(--radius-sm)] border border-[var(--color-border)]",
                "text-[10.5px] font-mono text-[var(--color-fg-muted)]",
                "hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]",
              )}
              title={`${s.repo ?? "—"} · ${s.mood.label}`}
            >
              <span className="truncate">
                <span aria-hidden className="mr-1">
                  {s.mood.emoji}
                </span>
                {s.repo ?? "—"}
              </span>
              <span
                className="text-[9px] text-[var(--color-fg-dim)] shrink-0"
                title={s.sessionType}
              >
                {s.sessionType[0]} · {formatRelative(now - s.lastActiveAt)} ago
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header avatar — compact 48px version used in the panel header
// ---------------------------------------------------------------------------

function HeaderAvatar({
  skinHue,
  hairHue,
  hairStyle,
  eyeShape,
  moodColor,
}: {
  skinHue: number;
  hairHue: number;
  hairStyle: number;
  eyeShape: number;
  moodColor: string;
}) {
  const skin = `hsl(${skinHue}, 45%, 70%)`;
  const hair = `hsl(${hairHue}, 50%, 30%)`;
  return (
    <svg
      width={48}
      height={48}
      viewBox="0 0 48 48"
      aria-hidden
      className="shrink-0"
    >
      <circle
        cx={24}
        cy={24}
        r={22}
        fill="none"
        stroke={moodColor}
        strokeOpacity={0.55}
        strokeWidth={1.4}
      />
      <circle cx={24} cy={26} r={13} fill={skin} />
      {hairStyle === 0 && (
        <path d={`M11 24 A 13 13 0 0 1 37 24 L 37 19 L 11 19 Z`} fill={hair} />
      )}
      {hairStyle === 1 && (
        <>
          <circle cx={24} cy={12} r={4.5} fill={hair} />
          <path
            d={`M12 22 A 13 13 0 0 1 36 22 L 36 19 L 12 19 Z`}
            fill={hair}
          />
        </>
      )}
      {hairStyle === 2 && (
        <path
          d="M11 22 Q 13 7 24 7 Q 35 7 37 22 L 38 36 L 33 28 L 30 34 L 27 28 L 24 34 L 21 28 L 18 34 L 15 28 L 10 36 Z"
          fill={hair}
        />
      )}
      {hairStyle === 3 && (
        <rect x={21} y={7} width={6} height={15} fill={hair} rx={2} />
      )}
      {eyeShape === 0 && (
        <>
          <circle cx={19.5} cy={27} r={1.5} fill="#1a1a1a" />
          <circle cx={28.5} cy={27} r={1.5} fill="#1a1a1a" />
        </>
      )}
      {eyeShape === 1 && (
        <>
          <rect
            x={18}
            y={26.5}
            width={3}
            height={1.3}
            fill="#1a1a1a"
            rx={0.6}
          />
          <rect
            x={27}
            y={26.5}
            width={3}
            height={1.3}
            fill="#1a1a1a"
            rx={0.6}
          />
        </>
      )}
      {eyeShape === 2 && (
        <>
          <path
            d="M17.5 27 Q 19.5 25 21.5 27"
            stroke="#1a1a1a"
            strokeWidth={1.1}
            fill="none"
          />
          <path
            d="M26.5 27 Q 28.5 25 30.5 27"
            stroke="#1a1a1a"
            strokeWidth={1.1}
            fill="none"
          />
        </>
      )}
      <path
        d="M20 31 Q 24 33 28 31"
        stroke="#3a2a2a"
        strokeWidth={1.1}
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatRelative(ms: number): string {
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
