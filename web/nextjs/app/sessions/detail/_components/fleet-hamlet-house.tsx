"use client";

// Fleet Hamlet — House Plan (P3).
//
// Drill-down view of a single resident: a cross-section of rooms,
// vitals HUD, action queue, and recent babble.
// All numbers are derived from already-cached SessionDetail — no new
// API surface.

import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import { furnitureForRoom } from "../_lib/fleet-hamlet-decor";
import type { LifeEvent } from "../_lib/fleet-hamlet-events";
import {
  assessRoom,
  computeTrophies,
  computeVitals,
  extractActionQueue,
  extractRecentEdits,
  extractRecentReads,
  getChildSessions,
  getParentSession,
  getRecentBabble,
  type EditEntry,
  type ReadEntry,
  type RoomAssessment,
  ROOM_ORDER,
  roomColorCss,
  roomColorDot,
} from "../_lib/fleet-hamlet-house";
import {
  agentHueShift,
  hashRepoToHue,
} from "../_lib/fleet-hamlet-layout";
import { statusColor } from "../_lib/fleet-timeline";
import type { TileSpec } from "../_types";
import { DECOR_CSS, HeartbeatStrip } from "./fleet-hamlet-decor";
import { MiniAvatar, PARTICLE_CSS } from "./fleet-hamlet-particles";
import {
  deriveAccessories,
  selectActiveRoom,
} from "../_lib/fleet-hamlet-particles";
import { FleetHamletLifetime } from "./fleet-hamlet-lifetime";
import { RelationshipsPanel } from "./fleet-hamlet-relations-panel";
import { SkillsPanel } from "./fleet-hamlet-skills-panel";

interface Props {
  sim: SimCardModel;
  allSims: readonly SimCardModel[];
  detail: SessionDetail | undefined;
  /** Pre-computed events for this resident (newest-first). */
  events: readonly LifeEvent[];
  /** When true, render an "Archived" banner across the top. */
  archived: boolean;
  now: number;
  selected: boolean;
  canAdd: boolean;
  onBack: () => void;
  onPickSession: (spec: TileSpec) => void;
  onEnterHouse: (sim: SimCardModel) => void;
}

export function FleetHamletHouse({
  sim,
  allSims,
  detail,
  events,
  archived,
  now,
  selected,
  canAdd,
  onBack,
  onPickSession,
  onEnterHouse,
}: Props) {
  const rooms = useMemo<RoomAssessment[]>(
    () => ROOM_ORDER.map((kind) => assessRoom(kind, sim, detail, now, allSims)),
    [sim, detail, now, allSims],
  );
  const vitals = useMemo(
    () => computeVitals(sim, detail, now),
    [sim, detail, now],
  );
  const parent = useMemo(
    () => getParentSession(sim, allSims),
    [sim, allSims],
  );
  const children = useMemo(
    () => getChildSessions(sim, allSims),
    [sim, allSims],
  );
  // 軸3: Action Queue を 20件に拡張
  const actions = useMemo(
    () => extractActionQueue(detail, 20),
    [detail],
  );
  // 軸3: Babble を全件 (上限50件) に拡張
  const babble = useMemo(
    () => getRecentBabble(detail, 50, 200),
    [detail],
  );
  // 軸2: Trophy / Library / Workshop 追加情報
  const trophies = useMemo(
    () => computeTrophies(sim, detail),
    [sim, detail],
  );
  const recentReads = useMemo(
    () => extractRecentReads(detail, 5),
    [detail],
  );
  const recentEdits = useMemo(
    () => extractRecentEdits(detail, 5),
    [detail],
  );

  const canOpenTile = !selected && canAdd;
  const roofHue = hashRepoToHue(sim.repo);
  const wallHue = (roofHue + agentHueShift(sim.sessionType) + 360) % 360;
  const activeRoom = useMemo(
    () => selectActiveRoom(detail, sim, now),
    [detail, sim, now],
  );
  const accessories = useMemo(
    () => deriveAccessories(sim, detail),
    [sim, detail],
  );

  // 軸4: Back ボタンへの autoFocus
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  // 軸4: ESC キーで onBack を発火 (input/textarea 内は除外)
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement;
      const tag = target.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      onBack();
    },
    [onBack],
  );
  useEffect(() => {
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [handleEsc]);

  return (
    <div className="h-full overflow-y-auto">
      {/* 軸1: lg+ で 3カラム grid、xl+ で max-w-[1400px] に拡張 */}
      <div className="max-w-[920px] xl:max-w-[1400px] mx-auto px-4 py-4">
        {archived && (
          <div
            className="px-3 py-1.5 mb-3 rounded-[var(--radius-sm)] border text-[11px] font-mono flex items-center gap-2"
            style={{
              borderColor: "hsl(0, 0%, 45%)",
              background: "hsla(0, 0%, 45%, 0.08)",
              color: "var(--color-fg-muted)",
            }}
            role="status"
          >
            <span aria-hidden>🪦</span>
            <span className="uppercase tracking-wider">Archived</span>
            <span className="text-[var(--color-fg-dim)]">
              read-only · idle &gt; 7d
            </span>
          </div>
        )}

        {/* 軸1: lg+ 3カラム layout — Left rail / Center / Right rail */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[280px_1fr_320px] lg:gap-4 lg:items-start">

          {/* ─── Left Rail (lg+: fixed 280px) ─────────────────────────── */}
          <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
            {/* Title bar */}
            <header className="flex items-center gap-2 lg:flex-col lg:items-start">
              {/* 軸4: Back ボタンに autoFocus + ESC ヒント */}
              <button
                ref={backRef}
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-fg-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                aria-label="back to neighborhood"
              >
                <ArrowLeft className="w-3 h-3" aria-hidden />
                Back
                <kbd className="ml-1 text-[9px] text-[var(--color-fg-dim)] font-mono opacity-70">(esc)</kbd>
              </button>
              <div className="flex items-center gap-2">
                <HouseGlyph roofHue={roofHue} wallHue={wallHue} />
                <h2 className="text-[13px] font-mono text-[var(--color-fg)] leading-tight">
                  {sim.sessionType[0]}/{sim.repo ?? "—"}
                  {sim.agentId && (
                    <span className="block text-[10px] text-[var(--color-fg-dim)]">
                      {sim.agentId}
                    </span>
                  )}
                </h2>
              </div>
              {/* Status chips — horizontal on mobile, vertical on lg+ */}
              <div className="ml-auto flex items-center gap-1.5 lg:ml-0 lg:flex-wrap">
                <Chip
                  emoji={sim.stage.emoji}
                  label={sim.stage.label}
                  borderColor="var(--color-border)"
                  textColor="var(--color-fg-muted)"
                />
                <Chip
                  emoji={sim.mood.emoji}
                  label={sim.mood.label}
                  borderColor={sim.mood.color}
                  textColor={sim.mood.color}
                />
                <span
                  aria-hidden
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: statusColor(sim.status) }}
                  title={`status: ${sim.status ?? "unknown"}`}
                />
                {canOpenTile && (
                  <button
                    type="button"
                    onClick={() =>
                      onPickSession({ type: sim.sessionType, id: sim.sessionId })
                    }
                    className="inline-flex items-center gap-1 px-2 h-6 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]"
                    aria-label="open as tile"
                  >
                    <ArrowUpRight className="w-3 h-3" aria-hidden />
                    Tile
                  </button>
                )}
              </div>
            </header>

            {/* Vitals HUD — 縦並び on lg+, 2x2 grid on md- */}
            <section
              className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-2 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]"
              aria-label="vitals"
            >
              <Vital
                icon="❤"
                label="Heart"
                value={`${vitals.heartRate}`}
                unit="bpm"
                title="Heart rate proxy — messages/minute × 12 (5m window). Higher = busier exchange."
                warn={vitals.heartRate > 60}
                extra={<HeartbeatStrip bpm={vitals.heartRate} warn={vitals.heartRate > 60} />}
              />
              <Vital
                icon="🫁"
                label="Breath"
                value={`${vitals.breathRate}`}
                unit="brm"
                title="Breath rate proxy — tool calls/minute (5m window). Higher = active tool combos."
                warn={vitals.breathRate > 12}
              />
              <Vital
                icon="🌡"
                label="Temp"
                value={vitals.temperature.toFixed(1)}
                unit="°C"
                title="Temperature proxy — 36 + context_usage × 5. Higher = closer to context overflow."
                warn={vitals.temperature >= 39}
              />
              <Vital
                icon="💉"
                label="BP"
                value={`${vitals.bpSystolic}/${vitals.bpDiastolic}`}
                unit=""
                title="Blood pressure proxy — systolic = 100 + error_rate × 100, diastolic = 60 + (1 - comfort) × 50."
                warn={vitals.bpSystolic >= 140}
              />
            </section>
          </aside>

          {/* ─── Center: Room Grid ──────────────────────────────────────── */}
          <main>
            {/* Room grid: xl 3列, lg 2列, sm 2列, default 1列 */}
            <section
              className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
              aria-label="rooms"
            >
              {rooms.map((room, idx) => (
                <RoomCard
                  key={room.kind}
                  room={room}
                  wide={idx === 0}
                  parent={room.kind === "nursery" ? parent : null}
                  children_={room.kind === "nursery" ? children : null}
                  onParentClick={parent ? () => onEnterHouse(parent) : undefined}
                  onChildClick={(child) => onEnterHouse(child)}
                  avatar={
                    room.kind === activeRoom ? (
                      <MiniAvatar sim={sim} accessories={accessories} />
                    ) : null
                  }
                  extra={
                    room.kind === "study" ? (
                      <SkillsPanel card={sim} detail={detail} variant="full" />
                    ) : room.kind === "reception" ? (
                      <RelationshipsPanel
                        card={sim}
                        allCards={allSims}
                        now={now}
                        variant="full"
                        onEnterHouse={onEnterHouse}
                      />
                    ) : room.kind === "trophy" ? (
                      <TrophyPanel trophies={trophies} />
                    ) : room.kind === "library" ? (
                      <RecentReadsPanel reads={recentReads} />
                    ) : room.kind === "workshop" ? (
                      <RecentEditsPanel edits={recentEdits} />
                    ) : null
                  }
                />
              ))}
            </section>
          </main>

          {/* ─── Right Rail (lg+: fixed 320px) ────────────────────────── */}
          <aside className="flex flex-col gap-3">
            {/* 軸3: Recent Babble — 全件スクロール可能 */}
            <section
              className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]"
              aria-label="recent babble"
            >
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-fg-muted)] mb-2">
                💬 Recent Babble {babble.length > 0 && `(${babble.length})`}
              </div>
              {babble.length === 0 && (
                <div className="text-[11px] font-mono text-[var(--color-fg-dim)]">
                  {detail
                    ? "No conversational messages found."
                    : "Loading session detail…"}
                </div>
              )}
              {babble.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-[11px] font-mono max-h-[400px] overflow-y-auto lg:max-h-none lg:overflow-visible">
                  {babble.map((line, i) => (
                    <li
                      key={`${i}-${line.role}`}
                      className="flex gap-2 leading-relaxed"
                    >
                      <span
                        className={cn(
                          "shrink-0 w-[56px] uppercase tracking-wider",
                          line.role === "user"
                            ? "text-[var(--color-accent)]"
                            : "text-[var(--color-fg-muted)]",
                        )}
                      >
                        {line.role}
                      </span>
                      <span className="text-[var(--color-fg)] flex-1 min-w-0 break-words">
                        {line.content}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 軸3: Action Queue — 20件まで、スクロール可能 */}
            <section
              className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]"
              aria-label="action queue"
            >
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-fg-muted)] mb-2">
                📋 Action Queue (inferred)
              </div>
              {actions && actions.length > 0 ? (
                <ol className="text-[11px] font-mono text-[var(--color-fg)] flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                  {actions.map((a, i) => (
                    <li
                      key={`${i}-${a.slice(0, 16)}`}
                      className="flex gap-2"
                    >
                      <span className="text-[var(--color-fg-dim)] shrink-0 w-5 text-right">
                        {i === 0 ? "▶" : `${i + 1}.`}
                      </span>
                      <span className="truncate">{a}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="text-[11px] font-mono text-[var(--color-fg-dim)]">
                  No action queue detected in the latest assistant message.
                </div>
              )}
            </section>
          </aside>

        </div>

        {/* 軸1: Lifetime Timeline — 3カラムをまたぐ full-width strip */}
        <div className="mt-4">
          <FleetHamletLifetime
            bornAt={sim.bornAt}
            now={now}
            events={events}
          />
        </div>
      </div>
      <style>{DECOR_CSS}</style>
      <style>{PARTICLE_CSS}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 軸2: Trophy / Library / Workshop 追加パネル
// ---------------------------------------------------------------------------

function TrophyPanel({ trophies }: { trophies: ReturnType<typeof computeTrophies> }) {
  if (trophies.length === 0) {
    return (
      <div className="text-[10px] font-mono text-[var(--color-fg-dim)]">
        No achievements yet
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {trophies.slice(0, 5).map((t, i) => (
        <li key={i} className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-[var(--color-fg-muted)] truncate flex-1">{t.label}</span>
          <span className="text-[var(--color-fg)] shrink-0 tabular">{t.value}</span>
        </li>
      ))}
    </ul>
  );
}

function RecentReadsPanel({ reads }: { reads: ReadEntry[] }) {
  if (reads.length === 0) {
    return (
      <div className="text-[10px] font-mono text-[var(--color-fg-dim)]">
        No reads recorded yet
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {reads.map((r, i) => (
        <li key={i} className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-[10px] text-[var(--color-fg-dim)] shrink-0" aria-hidden>📄</span>
          <span className="text-[var(--color-fg)] truncate flex-1" title={r.path}>{r.path}</span>
          {r.count > 1 && (
            <span className="text-[var(--color-fg-dim)] shrink-0 tabular">×{r.count}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function RecentEditsPanel({ edits }: { edits: EditEntry[] }) {
  if (edits.length === 0) {
    return (
      <div className="text-[10px] font-mono text-[var(--color-fg-dim)]">
        No edits recorded yet
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {edits.map((e, i) => (
        <li key={i} className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-[10px] text-[var(--color-fg-dim)] shrink-0" aria-hidden>✏️</span>
          <span className="text-[var(--color-fg)] truncate flex-1" title={e.path}>{e.path}</span>
          <span className="text-[var(--color-fg-dim)] shrink-0 text-[9px]">{e.tool}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Chip({
  emoji,
  label,
  borderColor,
  textColor,
}: {
  emoji: string;
  label: string;
  borderColor: string;
  textColor: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1 h-5 rounded-[var(--radius-sm)] text-[10px] font-mono border"
      style={{ borderColor, color: textColor }}
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
    </span>
  );
}

function Vital({
  icon,
  label,
  value,
  unit,
  title,
  warn,
  extra,
}: {
  icon: string;
  label: string;
  value: string;
  unit: string;
  title: string;
  warn: boolean;
  extra?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 px-2 py-1.5 rounded-[var(--radius-sm)] border"
      style={{
        borderColor: warn ? "hsl(0, 70%, 55%)" : "var(--color-border)",
      }}
      title={title}
    >
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] flex items-center gap-1">
        <span aria-hidden>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            "text-[16px] font-mono tabular",
            warn ? "text-[hsl(0,70%,55%)]" : "text-[var(--color-fg)]",
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[10px] font-mono text-[var(--color-fg-dim)]">
            {unit}
          </span>
        )}
      </div>
      {extra}
    </div>
  );
}

function RoomCard({
  room,
  wide,
  parent,
  children_,
  onParentClick,
  onChildClick,
  extra,
  avatar,
}: {
  room: RoomAssessment;
  wide: boolean;
  parent: SimCardModel | null;
  children_: readonly SimCardModel[] | null;
  onParentClick?: () => void;
  onChildClick: (child: SimCardModel) => void;
  /** Optional richer body (e.g. SkillsPanel/RelationshipsPanel). */
  extra?: ReactNode;
  /** When the resident is "in" this room, render a mini avatar marker. */
  avatar?: ReactNode;
}) {
  const color = roomColorCss(room.color);
  const dot = roomColorDot(room.color);
  const furniture = furnitureForRoom(room.kind);
  // Pastel wash that matches room.color so each card whispers its state.
  const wash =
    room.color === "green"
      ? "linear-gradient(135deg, hsla(140, 60%, 80%, 0.18), transparent 60%)"
      : room.color === "yellow"
      ? "linear-gradient(135deg, hsla(50, 90%, 75%, 0.22), transparent 60%)"
      : room.color === "orange"
      ? "linear-gradient(135deg, hsla(28, 90%, 70%, 0.22), transparent 60%)"
      : room.color === "red"
      ? "linear-gradient(135deg, hsla(0, 80%, 70%, 0.22), transparent 60%)"
      : "linear-gradient(135deg, hsla(220, 12%, 60%, 0.12), transparent 60%)";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-1.5 p-3 rounded-[var(--radius-md)] border overflow-hidden",
        // wide (living room) spans 2 cols on sm/xl, but NOT on lg
        // (lg uses 2-col for center grid → col-span-2 would break)
        wide && "sm:col-span-2 xl:col-span-2",
      )}
      style={{
        borderColor: room.color === "gray" ? "var(--color-border)" : color,
        backgroundImage: `${wash}, linear-gradient(0deg, var(--color-bg), var(--color-bg))`,
      }}
      role="group"
      aria-label={room.title}
    >
      {/* Mini avatar — only the currently-active room shows the resident
          standing inside. Sits above-right of the furniture cluster. */}
      {avatar && (
        <span
          className="absolute right-2 top-2 pointer-events-none"
          aria-hidden
          title="Resident is here"
        >
          {avatar}
        </span>
      )}
      {/* Furniture emoji cluster, lower-right, slight tilt — gives each room
          a "lived-in" feel without dominating the assessment text. */}
      {furniture.length > 0 && (
        <span
          aria-hidden
          className="absolute right-2 bottom-2 select-none pointer-events-none flex gap-1 opacity-70"
          style={{ fontSize: "14px", lineHeight: 1 }}
        >
          {furniture.map((f, i) => (
            <span
              key={i}
              style={{ transform: `rotate(${(i - 1) * 6}deg)`, display: "inline-block" }}
            >
              {f}
            </span>
          ))}
        </span>
      )}
      <div className="flex items-center gap-2 text-[12px] font-mono">
        <span aria-hidden>{room.emoji}</span>
        <span className="text-[var(--color-fg)]">{room.title}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px]">
          <span aria-hidden>{dot}</span>
          <span style={{ color }}>{room.label}</span>
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 text-[11px] font-mono text-[var(--color-fg-muted)]">
        {room.details.map((d, i) => (
          <li key={i} className="truncate">
            {d}
          </li>
        ))}
      </ul>
      {extra && (
        <div className="pt-1 border-t border-[var(--color-border)]/70">
          {extra}
        </div>
      )}
      {/* Nursery — parent / children navigation */}
      {room.kind === "nursery" && (
        <div className="flex flex-col gap-1 pt-1 border-t border-[var(--color-border)]/70">
          {parent && (
            <button
              type="button"
              onClick={onParentClick}
              className="text-[10px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] text-left truncate"
            >
              ↑ Parent: {parent.sessionType}@{parent.sessionId.slice(0, 10)}…
            </button>
          )}
          {children_ && children_.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {children_.slice(0, 4).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onChildClick(c)}
                  className="text-[10px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] text-left truncate"
                >
                  ↓ {c.sessionType}@{c.sessionId.slice(0, 10)}… · {c.mood.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tiny "house" glyph for the title bar — mirrors Neighborhood's color logic
// without re-rendering the full HouseSvg footprint.
function HouseGlyph({ roofHue, wallHue }: { roofHue: number; wallHue: number }) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <polygon points="2,12 12,3 22,12" fill={`hsl(${roofHue}, 55%, 45%)`} />
      <rect x="4" y="11" width="16" height="10" fill={`hsl(${wallHue}, 30%, 65%)`} />
      <rect x="10" y="14" width="4" height="7" fill="hsl(25, 35%, 25%)" />
    </svg>
  );
}
