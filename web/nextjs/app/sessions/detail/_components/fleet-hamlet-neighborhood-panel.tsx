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
import {
  avatarPartsFromSeed,
  type AvatarParts,
  type SimCardModel,
} from "../_lib/fleet-hamlet";
import { moodGradient } from "../_lib/fleet-hamlet-decor";
import type { WeatherKind } from "../_lib/fleet-hamlet-layout";
import { deriveAccessories } from "../_lib/fleet-hamlet-particles";
import { statusColor } from "../_lib/fleet-timeline";
import { AvatarBody, DECOR_CSS } from "./fleet-hamlet-decor";
import {
  clothingForAgent,
  HAMLET_AVATAR_CSS,
  HamletAvatar,
} from "./fleet-hamlet-avatar";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";
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
      <style>{HAMLET_AVATAR_CSS}</style>
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
    () => avatarPartsFromSeed(sim.avatarSeed, sim.stage.key),
    [sim.avatarSeed, sim.stage.key],
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
      {/* Compact header — avatar is rendered in the Room Scene, so the
          header carries only identity text + mood/lifestage chips. */}
      <header
        className="shrink-0 px-3 py-2 border-b border-[var(--color-border)] flex items-start gap-2.5"
        style={{
          backgroundImage: `${grad.bg}, linear-gradient(0deg, var(--color-bg), var(--color-bg))`,
        }}
      >
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

      {/* Body — compact Room Scene (top, ~42%) + Chat Bubbles (bottom,
          ~58%). The room is decorative context; chat is what scrolls. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          className="px-2 pt-2 pb-2 overflow-hidden"
          style={{ flexBasis: "42%", flexShrink: 0, flexGrow: 0, minHeight: 0 }}
        >
          <div className="w-full h-full overflow-hidden rounded-md flex items-stretch">
            <RoomScene
              card={sim}
              detail={detail}
              allCards={allSims}
              now={now}
              weather={weather}
            />
          </div>
        </div>
        <div
          className="flex-1 min-h-0 border-t border-[var(--color-border)] overflow-hidden flex flex-col bg-[var(--color-bg)]"
        >
          <div className="px-3 pt-1.5 pb-0.5 text-[9px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] shrink-0">
            Recent chatter
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
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
// Header avatar — compact 48px version used in the panel header. Wraps
// the shared HeadFace so the resident's expression / hair / cheeks / ears
// match the Sim Card and Room Scene renderings.
// ---------------------------------------------------------------------------

function HeaderAvatar({
  parts,
  sim,
}: {
  parts: AvatarParts;
  sim: SimCardModel;
}) {
  const expression = useMemo(
    () => getExpressionForMood(sim.mood.key),
    [sim.mood.key],
  );
  const clothes = useMemo(
    () => clothingForAgent(sim.sessionType),
    [sim.sessionType],
  );
  // Single SVG so head + body never visually separate. Height is roughly
  // 60px (head ~22% of height + torso below) which fits the 48px header
  // slot via overflow:visible.
  const totalH = 60;
  const halfW = 22;
  return (
    <svg
      width={halfW * 2}
      height={totalH}
      viewBox={`${-halfW} 0 ${halfW * 2} ${totalH}`}
      aria-hidden
      className="shrink-0"
      overflow="visible"
    >
      <HamletAvatar
        parts={parts}
        expression={expression}
        clothing={clothes}
        height={totalH}
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
