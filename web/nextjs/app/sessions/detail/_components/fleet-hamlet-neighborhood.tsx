"use client";

// Fleet Hamlet — Neighborhood View.
//
// An isometric-ish village rendered with pure CSS + SVG. Each session is
// one house; houses are colored by repo (roof hue), tinted by agent kind
// (wall hue shift), sized by activity, and topped by their moodlet emoji.
// Spawn relationships (parent → child sessions) draw a curved road between
// the parent and child houses. Idle households (>1h silence) drop into a
// park footer band.
//
// No new deps — react-three-fiber etc. are intentionally avoided so this
// stays lightweight relative to the Cosmos tab.

import { DoorOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import {
  skyPalette,
  timeOfDay,
  yardDecorFor,
} from "../_lib/fleet-hamlet-decor";
import {
  detectEvents,
  type LifeEvent,
  severityColor,
  severityWeight,
} from "../_lib/fleet-hamlet-events";
import {
  agentHueShift,
  assignGridSlots,
  assignHouseholdZones,
  computeWeather,
  dominantMood,
  hashRepoToHue,
  houseSizeFromActivity,
  type HouseSize,
} from "../_lib/fleet-hamlet-layout";
import { computeFitLayout } from "../_lib/fleet-hamlet-fit-layout";
import { sessionKey } from "../_lib/fleet-timeline";
import type { TileSpec } from "../_types";
import {
  BirdSvg,
  ButterflySvg,
  ConfettiBurst,
  DECOR_CSS,
  GroundBand,
  SkyBand,
  StreetlampSvg,
  YardLayer,
} from "./fleet-hamlet-decor";
import {
  currentSeason,
  lightningBolts,
} from "../_lib/fleet-hamlet-particles";
import {
  countWalkingState,
  isAtHome,
  isOut,
  pickOutingSims,
} from "../_lib/fleet-hamlet-outing";
import {
  type Bustle,
  bustleSpriteCount,
  computeBustle,
} from "../_lib/fleet-hamlet-bustle";
import {
  BUSTLE_CSS,
  BustleChimneySmoke,
  HouseAura,
  MultiWindowGlow,
  RoofMusicNotes,
} from "./fleet-hamlet-bustle";
import {
  PARK_RESIDENT_CSS,
  ParkResidentLayer,
} from "./fleet-hamlet-park-residents";
import { HOUSE_CHAT_CSS, HouseChatLayer } from "./fleet-hamlet-house-chat";
import { HamletDioramaDefs } from "./fleet-hamlet-diorama-defs";
import { DIORAMA_DEFS } from "../_lib/fleet-hamlet-diorama-tokens";
import { pickHousesWithBubbles } from "../_lib/fleet-hamlet-last-message";
import { useHamletMessageNotify } from "../_hooks/use-hamlet-message-notify";
import {
  EventBurst,
  LightningOverlay,
  MountainRange,
  PARTICLE_CSS,
  RainLayer,
  SeasonParticleLayer,
  WalkingSimLayer,
  seedFromCards,
} from "./fleet-hamlet-particles";
import {
  pickStreetProps,
  streetPropSeedFromKeys,
} from "../_lib/fleet-hamlet-street-props";
import { StreetPropsLayer } from "./fleet-hamlet-street-props";
import { TinyHouseSvg } from "./fleet-hamlet-tiny-house";
import {
  composeVillageHeadlines,
  type Headline,
} from "../_lib/fleet-hamlet-news";
import { collectAllEvents } from "../_lib/fleet-hamlet-events";

// Fit-All layout (see _lib/fleet-hamlet-fit-layout.ts) sizes cells
// dynamically so every house + park resident is visible without scroll
// regardless of viewport. The "labels for moodlet bubble + house +
// nameplate" overhead is now folded into the cellH aspect inside
// computeFitLayout.

// Recently-active window for "active households" HUD chip (matches the
// social peer window in fleet-hamlet.ts).
const RECENT_WINDOW_MS = 60 * 60 * 1000;

interface Props {
  sims: readonly SimCardModel[];
  /** Per-key SessionDetail map — drives event overlays. Optional so callers
   *  that haven't wired the hook yet still render. */
  detailByKey?: ReadonlyMap<string, SessionDetail>;
  now: number;
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
  /** Drill-down to House Plan for this resident. */
  onEnterHouse: (sim: SimCardModel) => void;
  /**
   * `sim.sessionId` currently selected for the right-hand inspector panel.
   * When null, no house is highlighted. The neighborhood doesn't render
   * the panel itself — it just lifts the selection up so the parent can
   * mirror it to the URL.
   */
  selectedSessionId?: string | null;
  /** Single-click handler that the parent uses to update the URL/panel. */
  onSelectSession?: (sessionId: string | null) => void;
}

export function FleetHamletNeighborhood({
  sims,
  detailByKey,
  now,
  selectedKeys,
  onPickSession,
  canAdd,
  onEnterHouse,
  selectedSessionId = null,
  onSelectSession,
}: Props) {
  // Resize-observed container — drives the dynamic fit-all layout. We
  // track both width AND height so the village always fits its pane
  // (Cards / Relations / Cemetery don't need this because they scroll;
  // Neighborhood is overflow-hidden by design).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        const h = e.contentRect.height;
        // Round to nearest 10px to avoid micro-thrashing reflows during
        // browser resize animations.
        setContainerSize({
          w: Math.max(0, Math.floor(w / 10) * 10),
          h: Math.max(0, Math.floor(h / 10) * 10),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zones = useMemo(() => assignHouseholdZones(sims, now), [sims, now]);

  // Top-priority event per resident — drives the over-house emoji overlay.
  const eventByKey = useMemo(() => {
    const m = new Map<string, LifeEvent>();
    if (!detailByKey) return m;
    for (const sim of sims) {
      const evs = detectEvents(sim, detailByKey.get(sim.key), sims, now);
      if (evs.length === 0) continue;
      // Pick most severe; tie-break by newest.
      let best: LifeEvent | null = null;
      for (const ev of evs) {
        if (
          !best ||
          severityWeight(ev.severity) > severityWeight(best.severity) ||
          (severityWeight(ev.severity) === severityWeight(best.severity) &&
            ev.timestamp > best.timestamp)
        ) {
          best = ev;
        }
      }
      if (best) m.set(sim.key, best);
    }
    return m;
  }, [sims, detailByKey, now]);

  // Reserve ~36px from the container height for the sticky HUD strip so
  // the fit solver doesn't push houses behind it.
  const HUD_RESERVE = 40;
  const fit = useMemo(
    () =>
      computeFitLayout(
        containerSize.w,
        Math.max(0, containerSize.h - HUD_RESERVE),
        zones.active.length,
        zones.park.length,
      ),
    [containerSize.w, containerSize.h, zones.active.length, zones.park.length],
  );

  // Compute visible vs overflow lists. Hash-sorted order in assignHouseholdZones
  // is stable so the same residents always make the cut across renders.
  const visibleActive = useMemo(
    () => zones.active.slice(0, fit.activeVisible),
    [zones.active, fit.activeVisible],
  );
  const visiblePark = useMemo(
    () => zones.park.slice(0, fit.parkVisible),
    [zones.park, fit.parkVisible],
  );
  const cols = Math.max(1, fit.activeCols);
  const parkCols = Math.max(1, fit.parkCols);
  const activeSlots = useMemo(
    () => assignGridSlots(visibleActive, cols),
    [visibleActive, cols],
  );
  const parkSlots = useMemo(
    () => assignGridSlots(visiblePark, parkCols),
    [visiblePark, parkCols],
  );

  const weather = useMemo(() => computeWeather(sims), [sims]);
  const dom = useMemo(() => dominantMood(sims), [sims]);
  const activeCount = useMemo(
    () => sims.filter((s) => now - s.lastActiveAt <= RECENT_WINDOW_MS).length,
    [sims, now],
  );

  // Selection is now lifted to the parent (URL `sel=` + localStorage). We
  // just resolve the currently-selected sessionId to a card for the
  // highlight + auto-scroll effects below.
  const selectedSim = useMemo(
    () => (selectedSessionId
      ? sims.find((s) => s.sessionId === selectedSessionId) ?? null
      : null),
    [sims, selectedSessionId],
  );
  // Toggle helper — clicking the already-selected house clears it.
  const toggleSelect = (sim: SimCardModel) => {
    if (!onSelectSession) return;
    onSelectSession(
      selectedSessionId === sim.sessionId ? null : sim.sessionId,
    );
  };

  // Active / park box dimensions from the fit solver. These drive every
  // backdrop layer (sky / mountains / ground) and SVG overlay so the
  // village fills the container without scroll.
  const activeCellW = fit.activeCellW || 1;
  const activeCellH = fit.activeCellH || 1;
  const parkCellW = fit.parkCellW || 1;
  const parkCellH = fit.parkCellH || 1;

  const activeRows = fit.activeRows;
  const activeH = Math.max(activeCellH, activeRows * activeCellH);
  const activeW = Math.max(activeCellW, cols * activeCellW);

  const parkRows = fit.parkRows;
  const parkH = Math.max(parkCellH, parkRows * parkCellH);
  const parkW = Math.max(parkCellW, parkCols * parkCellW);

  // Compute spawn-road endpoints. We need each child's absolute (x,y) and
  // its parent's, both inside the active grid (parents in the park don't
  // get roads — keeps the lines visually meaningful, focused on live work).
  // Roads only render between *visible* active sims; the overflow chip
  // doesn't claim grid slots.
  const roads = useMemo(() => {
    type Road = { id: string; from: { x: number; y: number }; to: { x: number; y: number } };
    const out: Road[] = [];
    const byId = new Map<string, SimCardModel>();
    for (const s of sims) byId.set(s.sessionId, s);
    for (const child of visibleActive) {
      const parentId = child.parentSessionId;
      if (!parentId) continue;
      const parent = byId.get(parentId);
      if (!parent) continue;
      const parentSlot = activeSlots.get(parent.key);
      const childSlot = activeSlots.get(child.key);
      if (!parentSlot || !childSlot) continue;
      out.push({
        id: `${parent.key}->${child.key}`,
        from: slotCenter(parentSlot, activeCellW, activeCellH),
        to: slotCenter(childSlot, activeCellW, activeCellH),
      });
    }
    return out;
  }, [sims, visibleActive, activeSlots, activeCellW, activeCellH]);

  // House overhead chat bubbles — last user/assistant message per active
  // house within a 60s freshness window. We only feed visible active sims
  // so park residents (silent by definition) stay quiet, and we cap to 8
  // simultaneous bubbles to keep the scene readable. Tiny mode is the
  // information-overload tier so we suppress the whole layer there.
  const houseBubbles = useMemo(() => {
    if (fit.useTiny) return new Map();
    return pickHousesWithBubbles(visibleActive, detailByKey, now, 8, {
      selectedKey: selectedSessionId
        ? visibleActive.find((s) => s.sessionId === selectedSessionId)?.key ?? null
        : null,
    });
  }, [fit.useTiny, visibleActive, detailByKey, now, selectedSessionId]);

  // Ping a short two-tone bell whenever a new bubble appears (LINE-like
  // "ピロン"). First render is the baseline so pre-existing messages don't
  // chime on page open; subsequent additions do until the user mutes.
  const { muted: chimeMuted, toggleMute: toggleChime } =
    useHamletMessageNotify(houseBubbles);

  // Sky + ground scenery layers. Time-of-day is re-evaluated on each
  // `now` tick so dusk → night transitions appear without a reload.
  const sky = useMemo(() => skyPalette(timeOfDay(new Date(now))), [now]);
  // Full-scene mode: sky covers the entire active zone (HUD-offset down to
  // park top). The sun/moon + clouds layer paints the upper third; the
  // lower portion gets a soft fade to the grass color. We pick a "sky
  // ceiling" (upper region depth) so birds/sun stay above the houses.
  const sceneH = Math.max(activeCellH, fit.activeZoneH);
  const skyHeight = sceneH;
  const skyCeilingY = Math.min(140, Math.max(96, Math.floor(sceneH * 0.4)));

  // Season is derived from the local month; particle layer paints the
  // village with sakura / leaves / snow.
  const season = useMemo(() => currentSeason(new Date(now)), [now]);

  // Walking sims — prefer residents currently in the "walking" outing
  // state (silence 5m..1h). We sample from the full sim set rather than
  // just the visible active slice so a resident who's about to head to
  // the park can still appear on the road, leaving their house.
  //
  // The count scales with how many residents are *currently* walking:
  // base 3, plus ~1.5× the walking-state population, capped at 6 so the
  // street never overflows. When the village is quiet (no one mid-stride)
  // we still draw 3 so the road never feels empty.
  const walkerCount = useMemo(() => {
    const walking = countWalkingState(sims, now);
    return Math.min(6, Math.max(3, Math.ceil(walking * 1.5)));
  }, [sims, now]);
  const walkers = useMemo(
    () => pickOutingSims(sims, now, walkerCount, Math.max(80, activeH * 0.6)),
    [sims, now, walkerCount, activeH],
  );

  // Lightning bolts for stormy weather — keyed off a stable card seed.
  const bolts = useMemo(
    () => (weather.kind === "stormy" ? lightningBolts(seedFromCards(sims), 1) : []),
    [weather.kind, sims],
  );

  // Street props — utility poles, billboards, benches, vending machines, etc.
  // Density scales with the active grid; tiny mode skips them so the village
  // doesn't drown in clutter at 30+ households. Seeded by the visible card
  // keys so the layout is stable across renders within a session.
  const streetProps = useMemo(() => {
    if (fit.useTiny) return [];
    const seed = streetPropSeedFromKeys(visibleActive.map((s) => s.key));
    return pickStreetProps(visibleActive.length, cols, activeRows, seed, {
      weather: weather.kind,
      season,
    });
  }, [fit.useTiny, visibleActive, cols, activeRows, weather.kind, season]);

  // Whether the night-window glow should run. Active sims at evening/night
  // light up their windows; this also drives streetlamp visibility logic.
  const isNightish = sky.tod === "evening" || sky.tod === "night";

  // --- Axis A: Village news ticker -------------------------------------------
  // Collect all events once (detailByKey may be undefined; guard inside).
  const allEvents = useMemo(() => {
    if (!detailByKey) return [];
    return collectAllEvents(sims, detailByKey, now);
  }, [sims, detailByKey, now]);

  const headlines = useMemo(
    () => composeVillageHeadlines(sims, allEvents, now, season),
    [sims, allEvents, now, season],
  );

  // Rotate every 6 seconds.
  const [headlineIdx, setHeadlineIdx] = useState(0);
  useEffect(() => {
    if (headlines.length <= 1) return;
    const id = setInterval(() => {
      setHeadlineIdx((i) => (i + 1) % headlines.length);
    }, 6000);
    return () => clearInterval(id);
  }, [headlines.length]);

  const currentHeadline: Headline | null = headlines[headlineIdx % Math.max(1, headlines.length)] ?? null;

  // --- Axis D: Founder crown --------------------------------------------------
  // Oldest non-archived sim (lastActiveAt within 7 days) by bornAt.
  const founderKey = useMemo(() => {
    const ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000;
    let oldest: SimCardModel | null = null;
    for (const s of sims) {
      if (now - s.lastActiveAt > ARCHIVE_MS) continue;
      if (!oldest || s.bornAt < oldest.bornAt) oldest = s;
    }
    return oldest?.key ?? null;
  }, [sims, now]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden relative bg-[var(--color-bg)]"
    >
      {/* Cinematic diorama shared `<defs>` — must be mounted before any SVG
          that references the gradients / filters by id. */}
      <HamletDioramaDefs />
      {/* HUD — overlay on the scene, semi-transparent so the village shows
          through. Wraps when the pane is narrow to avoid overflow. */}
      <div
        className={cn(
          "absolute top-0 inset-x-0 z-20 px-4 py-1.5",
          "flex flex-wrap items-center gap-x-3 gap-y-1",
          "text-[11px] font-mono",
          "bg-[var(--color-bg)]/70 backdrop-blur-md",
          "border-b border-[var(--color-border)]/60",
        )}
        style={{
          minHeight: 32,
          boxShadow: "0 4px 8px -2px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.12)",
        }}
      >
        <span className="inline-flex items-center gap-1" title={`weather: ${weather.label}`}>
          <span aria-hidden className="text-[14px] leading-none">{weather.emoji}</span>
          <span className="text-[var(--color-fg-muted)]">{weather.label}</span>
        </span>
        <span className="text-[var(--color-fg-dim)]">·</span>
        <span>
          <span aria-hidden>👥</span>{" "}
          <span className="text-[var(--color-fg-muted)]">{sims.length}</span> households
        </span>
        <span className="text-[var(--color-fg-dim)]">·</span>
        <span>
          <span aria-hidden>🎯</span>{" "}
          <span className="text-[var(--color-fg-muted)]">{activeCount}</span> active
        </span>
        {dom && (
          <>
            <span className="text-[var(--color-fg-dim)]">·</span>
            <span title={`dominant mood: ${dom.label}`}>
              <span aria-hidden className="text-[14px] leading-none">{dom.emoji}</span>{" "}
              <span className="text-[var(--color-fg-muted)]">{dom.label}</span>
            </span>
          </>
        )}
        {/* New-message chime toggle — pinned to the right edge of the HUD. */}
        <button
          type="button"
          onClick={toggleChime}
          className={cn(
            "ml-auto inline-flex items-center gap-1 px-1.5 h-5",
            "rounded-[var(--radius-sm)] border border-[var(--color-border)]",
            "bg-[var(--color-bg)]/80 hover:bg-[var(--color-bg)]",
            "text-[10px] font-mono transition-colors duration-150",
          )}
          title={
            chimeMuted
              ? "Click to enable new-message chime"
              : "Click to mute new-message chime"
          }
          aria-pressed={!chimeMuted}
          aria-label={
            chimeMuted ? "Enable new-message chime" : "Mute new-message chime"
          }
        >
          <span aria-hidden className="text-[12px] leading-none">
            {chimeMuted ? "🔕" : "🔔"}
          </span>
          <span
            className={
              chimeMuted
                ? "text-[var(--color-fg-dim)]"
                : "text-[var(--color-fg-muted)]"
            }
          >
            {chimeMuted ? "muted" : "chime"}
          </span>
        </button>
      </div>

      {/* Axis A — News ticker: single rotating headline strip.
          Height 18–20px, sits between HUD and the active scene (z-10 so it
          floats above the sky layer but below the HUD overlay).
          Hidden when container width < 320px (tiny mode). */}
      {currentHeadline && (containerSize.w === 0 || containerSize.w >= 320) && (
        <div
          aria-live="polite"
          aria-label="Village news"
          className={cn(
            "absolute inset-x-0 z-10 overflow-hidden",
            "flex items-center px-3 h-[18px]",
            "bg-[var(--color-bg)]/60 backdrop-blur-sm",
            "border-b border-[var(--color-border)]/40",
            "text-[10px] font-mono text-[var(--color-fg-muted)]",
            "pointer-events-none select-none",
            "relay-news-ticker",
          )}
          style={{ top: HUD_RESERVE }}
        >
          <span className="truncate">{currentHeadline.text}</span>
        </div>
      )}

      {/* Active scene zone — fills the container minus HUD + park. Every
          backdrop layer (sky / mountains / ground / weather / particles)
          spans the full container width so the village reads as a single
          framed scene rather than a stacked column. Houses sit on top as
          the main subject and are centered horizontally via mx-auto. */}
      <div
        className="absolute left-0 right-0 overflow-hidden"
        style={{
          top: HUD_RESERVE,
          height: fit.activeZoneH,
        }}
      >
        {/* z=0 — Sky covers entire scene height. Lower portion fades to the
            grass color via an overlay so houses sit on "ground". */}
        <SkyBand
          palette={sky}
          width={containerSize.w || activeW}
          height={skyHeight}
          weather={weather.kind}
          season={season}
        />
        {/* Ground-fade overlay — bottom 45% of the scene blends to grass so
            houses don't float against pure sky. */}
        <div
          aria-hidden
          className="absolute inset-x-0 pointer-events-none"
          style={{
            bottom: 0,
            height: Math.max(120, Math.floor(sceneH * 0.55)),
            background: `linear-gradient(to bottom, transparent 0%, ${sky.grass} 55%, ${sky.grassDark} 100%)`,
          }}
        />
        {/* z=1 — Distant mountain range as backdrop, sat low + faded so
            houses pop in front. Only when the pane is big enough. */}
        {(containerSize.w || activeW) > 320 && sceneH > 180 && (
          <div
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              left: 0,
              top: Math.floor(sceneH * 0.35),
              width: containerSize.w || activeW,
              height: Math.max(60, Math.floor(sceneH * 0.22)),
              opacity: 0.7,
            }}
          >
            <MountainRange
              width={containerSize.w || activeW}
              height={Math.max(60, Math.floor(sceneH * 0.22))}
              season={season}
            />
          </div>
        )}
        {/* Axis C — Shooting star: only at night, random interval 20–40s.
            Rendered above the sky band but below the mountain + house layers.
            Suppressed by reduced-motion and in containers narrower than 320px. */}
        {sky.tod === "night" && (containerSize.w === 0 || containerSize.w >= 320) && (
          <ShootingStar
            width={containerSize.w || activeW}
            height={skyCeilingY}
          />
        )}

        {/* Ground band — bottom strip with pastel grass + dots. */}
        <GroundBand
          palette={sky}
          width={containerSize.w || activeW}
          height={Math.max(40, Math.floor(sceneH * 0.18))}
        />
        {/* Weather overlays — rain + occasional lightning, full scene. */}
        {weather.kind === "stormy" && (
          <>
            <RainLayer
              width={containerSize.w || activeW}
              height={sceneH}
              count={32}
            />
            <LightningOverlay
              bolts={bolts}
              width={containerSize.w || activeW}
              height={skyCeilingY + 40}
            />
          </>
        )}
        {/* Season particles — petals / leaves / snow drift across full scene. */}
        {season !== "summer" && (
          <SeasonParticleLayer
            season={season}
            width={containerSize.w || activeW}
            height={sceneH}
            count={16}
            seed={seedFromCards(sims)}
          />
        )}
        {/* Lone butterfly drifting across — only during daytime + non-stormy. */}
        {sky.tod !== "night" && weather.kind !== "stormy" && (containerSize.w || activeW) > 240 && (
          <span
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              top: Math.max(40, skyCeilingY - 28),
              left: 0,
              width: containerSize.w || activeW,
            }}
          >
            <ButterflySvg delay={-3} hue={320} />
          </span>
        )}
        {/* Extra birds when weather is clear */}
        {weather.kind === "clear" && sky.tod !== "night" && (containerSize.w || activeW) > 320 && (
          <>
            <span
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                top: Math.max(20, skyCeilingY - 56),
                left: (containerSize.w || activeW) * 0.2,
              }}
            >
              <BirdSvg delay={0.4} />
            </span>
            <span
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                top: Math.max(10, skyCeilingY - 70),
                left: (containerSize.w || activeW) * 0.6,
              }}
            >
              <BirdSvg delay={1.1} />
            </span>
          </>
        )}
        {/* Walking sims — overlay on the road, anchored to the bottom of
            the house grid so they always walk in front of the houses
            rather than floating at the scene bottom. The grid uses the
            same vertical centering offset below, so the two stay in
            sync as the pane resizes. */}
        <WalkingSimLayer
          specs={walkers}
          width={containerSize.w || activeW}
          yBase={Math.max(
            60,
            Math.floor((sceneH - Math.max(activeH, activeCellH)) * 0.45) +
              Math.max(activeH, activeCellH) +
              4,
          )}
        />

        {/* House grid — centered horizontally AND vertically inside the
            active zone. */}
        <div
          className="relative mx-auto"
          style={{
            width: Math.min(activeW, containerSize.w || activeW),
            height: Math.max(activeH, activeCellH),
            maxWidth: "100%",
            marginTop: Math.max(
              0,
              Math.floor((sceneH - Math.max(activeH, activeCellH)) * 0.45),
            ),
          }}
        >
          {/* Road layer (under the houses) */}
          {roads.length > 0 && (
            <svg
              className="absolute inset-0 pointer-events-none"
              width={activeW}
              height={activeH}
              viewBox={`0 0 ${activeW} ${activeH}`}
              aria-hidden
            >
              {roads.map((r) => (
                <path
                  key={r.id}
                  d={roadPath(r.from, r.to)}
                  fill="none"
                  stroke="var(--color-border)"
                  strokeWidth={6}
                  strokeLinecap="round"
                  opacity={0.55}
                />
              ))}
              {roads.map((r) => (
                <path
                  key={`${r.id}-dash`}
                  d={roadPath(r.from, r.to)}
                  fill="none"
                  stroke="var(--color-fg-dim)"
                  strokeWidth={1}
                  strokeDasharray="3 6"
                  strokeLinecap="round"
                  opacity={0.6}
                />
              ))}
              {/* Axis B — Letter birds: ✉ emoji flying from parent → child.
                  Suppressed in tiny mode and by reduced-motion preference. */}
              {!fit.useTiny && roads.map((r) => (
                <LetterBird key={`bird-${r.id}`} road={r} activeW={activeW} activeH={activeH} />
              ))}
            </svg>
          )}

          {/* Street props — utility poles / billboards / benches / vending
              machines / bus stops / trash cans / signs scattered into the
              gaps between houses (Codrops Generative CSS Worlds inspired,
              but pure SVG, no 3D transforms). Sits behind streetlamps and
              chat bubbles but in front of the road. */}
          {!fit.useTiny && streetProps.length > 0 && (
            <StreetPropsLayer
              props={streetProps}
              cellW={activeCellW}
              cellH={activeCellH}
              totalW={activeW}
              totalH={activeH}
              litLamps={sky.lampsLit}
            />
          )}

          {/* Streetlamps — between each pair of cells along the top row of
              the grid, only drawn when dusk/night and there are ≥2 columns. */}
          {sky.lampsLit && cols >= 2 && activeRows >= 1 && !fit.useTiny && (
            <div aria-hidden className="absolute inset-0 pointer-events-none">
              {Array.from({ length: cols - 1 }).map((_, i) => (
                <span
                  key={`lamp-${i}`}
                  style={{
                    position: "absolute",
                    left: (i + 1) * activeCellW - 8,
                    top: activeCellH - 50,
                  }}
                >
                  <StreetlampSvg lit={sky.lampsLit} />
                </span>
              ))}
            </div>
          )}

          {/* House overhead chat bubbles — fresh messages float above active
              houses. Suppressed in tiny mode. */}
          {!fit.useTiny && houseBubbles.size > 0 && (
            <HouseChatLayer
              bubbles={houseBubbles}
              cards={visibleActive}
              slots={activeSlots}
              cellW={activeCellW}
              cellH={activeCellH}
              width={activeW}
              height={activeH}
            />
          )}

          {/* Houses — only the *visible* slice from the fit solver. */}
          {visibleActive.map((sim) => {
            const slot = activeSlots.get(sim.key);
            if (!slot) return null;
            const left = slot.col * activeCellW;
            const top = slot.row * activeCellH;
            const size = houseSizeFromActivity(sim);
            const selected = selectedKeys.has(
              sessionKey({ type: sim.sessionType, id: sim.sessionId }),
            );
            const isOpen = selectedSim?.key === sim.key;
            const isRecent = now - sim.lastActiveAt <= RECENT_WINDOW_MS;
            const event = eventByKey.get(sim.key);
            const decor = yardDecorFor(sim);
            const bustle = computeBustle(sim, sims, now);
            // Out-of-house signals (gimmick A.3) — silence <5m = resident in
            // the yard, silence >30m = Out placard on the door. Tiny mode
            // skips both to avoid clutter when the village has 30+ households.
            const homeNow = !fit.useTiny && isAtHome(sim, now);
            const outNow = !fit.useTiny && !homeNow && isOut(sim, now);
            // Night windows only glow when the resident is actually home —
            // a 10-minute-silent house looks dark even at dusk so the user
            // can tell at a glance which lights are *currently* on.
            const liveWindows = isRecent && isNightish && homeNow;
            return (
              <div
                key={sim.key}
                className={cn(
                  "group absolute flex flex-col items-center justify-end",
                  "transition-transform duration-150 ease-out",
                  "hover:-translate-y-1 hover:drop-shadow-lg",
                  isOpen && "-translate-y-1.5 scale-[1.05]",
                )}
                style={{
                  left,
                  top,
                  width: activeCellW,
                  height: activeCellH,
                  filter: isOpen
                    ? "drop-shadow(0 0 8px var(--color-accent))"
                    : undefined,
                }}
              >
                {/* Yard decoration — only at full size; tiny mode skips yards. */}
                {!fit.useTiny && (
                  <YardLayer
                    decor={decor}
                    cellW={activeCellW}
                    cellH={activeCellH}
                    nightLamps={sky.lampsLit}
                    resident={
                      homeNow
                        ? {
                            kind: "home",
                            agentKind: sim.sessionType,
                            hue: sim.hue,
                            sim,
                          }
                        : outNow
                          ? { kind: "out" }
                          : undefined
                    }
                  />
                )}
                <button
                  type="button"
                  onClick={() => toggleSelect(sim)}
                  onDoubleClick={() => onEnterHouse(sim)}
                  className="flex flex-col items-center justify-end p-0 m-0 bg-transparent border-0 cursor-pointer w-full h-full relative"
                  title={
                    event
                      ? `${sim.repo ?? "—"} · ${sim.mood.label} · ${event.label}: ${event.message}`
                      : `${sim.repo ?? "—"} · ${sim.mood.label} · double-click to enter`
                  }
                  aria-pressed={isOpen}
                >
                  {!fit.useTiny && <MoodletBubble sim={sim} />}
                  {fit.useTiny ? (
                    <TinyHouseSvg
                      sim={sim}
                      size={Math.min(activeCellW, activeCellH * 0.85)}
                      chimneyActive={isRecent}
                      highlight={selected || isOpen}
                      event={event}
                      windowsLit={isRecent && isNightish}
                      bustle={bustle}
                    />
                  ) : (
                    <HouseSvg
                      sim={sim}
                      size={size}
                      chimneyActive={isRecent}
                      highlight={selected || isOpen}
                      event={event}
                      windowsLit={liveWindows}
                      bustle={bustle}
                    />
                  )}
                  {!fit.useTiny && <HouseLabel sim={sim} selected={selected} />}
                  {!fit.useTiny && event && <EventOverlay event={event} />}
                  {!fit.useTiny && event && <EventBurst kind={event.kind} />}
                  {!fit.useTiny &&
                    event &&
                    (event.kind === "birthday" ||
                      event.kind === "wedding" ||
                      event.kind === "baby") && <ConfettiBurst />}
                </button>
                {/* Axis D — Founder crown: 👑 on the oldest active sim's roof.
                    Tiny mode skips it to avoid clutter. */}
                {!fit.useTiny && founderKey === sim.key && (
                  <FounderCrown
                    sim={sim}
                    now={now}
                    cellW={activeCellW}
                    cellH={activeCellH}
                  />
                )}
                {/* Hover-only Enter House overlay — full mode only. */}
                {!fit.useTiny && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEnterHouse(sim);
                    }}
                    className={cn(
                      "absolute top-1 left-1/2 -translate-x-1/2",
                      "inline-flex items-center gap-1 px-1.5 h-5 rounded-[var(--radius-sm)]",
                      "border border-[var(--color-accent)] bg-[var(--color-bg)]",
                      "text-[9.5px] font-mono text-[var(--color-accent)]",
                      "opacity-0 group-hover:opacity-100 focus:opacity-100",
                      "transition-opacity duration-150",
                    )}
                    aria-label="enter house plan"
                  >
                    <DoorOpen className="w-2.5 h-2.5" aria-hidden />
                    Enter
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Park (silent residents) — anchored to the bottom of the pane.
          A dashed border-top spans the full container width so the scene
          reads as a single street with a clear boundary between the
          active block and the quiet grove below. */}
      {zones.park.length > 0 && fit.parkZoneH > 0 && (
        <div
          className="absolute left-0 right-0 bottom-0 overflow-hidden border-t border-dashed border-[var(--color-border)]/70"
          style={{
            height: fit.parkZoneH,
            // Continue the grass into the park band so the active scene
            // doesn't end on the user's UI bg color. Dusk → night feel.
            background:
              "linear-gradient(to bottom, hsl(95, 38%, 52%), hsl(110, 30%, 32%) 60%, hsl(120, 28%, 22%))",
          }}
        >
          <div
            className="relative mx-auto py-2 h-full"
            style={{ width: Math.min(parkW + 24, fit.innerW + 24), maxWidth: "100%" }}
          >
            <div className="absolute top-1 left-3 text-[10px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] pointer-events-none">
              🌳 Park
            </div>
            <div
              className="relative mx-auto mt-3"
              style={{ width: parkW, height: Math.max(parkH, parkCellH) }}
            >
              {/* Park residents — mini-avatars next to each house plus a
                  few strollers / bench sitters scattered across the zone. */}
              <ParkResidentLayer
                cards={visiblePark}
                cellW={parkCellW}
                cellH={parkCellH}
                rows={parkRows}
                cols={parkCols}
                totalW={parkW}
                totalH={Math.max(parkH, parkCellH)}
              />
              {visiblePark.map((sim) => {
                const slot = parkSlots.get(sim.key);
                if (!slot) return null;
                const left = slot.col * parkCellW;
                const top = slot.row * parkCellH;
                const isOpen = selectedSim?.key === sim.key;
                return (
                  <button
                    key={sim.key}
                    type="button"
                    onClick={() => toggleSelect(sim)}
                    onDoubleClick={() => onEnterHouse(sim)}
                    className={cn(
                      "absolute flex flex-col items-center justify-end p-0 m-0 bg-transparent border-0",
                      "transition-transform duration-150 ease-out cursor-pointer opacity-70 hover:opacity-100",
                      "hover:-translate-y-1",
                      isOpen && "-translate-y-1 opacity-100 scale-[1.05]",
                    )}
                    style={{
                      left,
                      top,
                      width: parkCellW,
                      height: parkCellH,
                      filter: isOpen
                        ? "drop-shadow(0 0 6px var(--color-accent))"
                        : undefined,
                    }}
                    title={`${sim.repo ?? "—"} · sleeping`}
                    aria-pressed={isOpen}
                  >
                    <TinyHouseSvg
                      sim={sim}
                      size={Math.min(parkCellW, parkCellH * 0.85)}
                      chimneyActive={false}
                      dim
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Overflow chip — surfaces residents we couldn't render so the count
          stays honest. Links the user toward the Cards mode which scrolls. */}
      {fit.overflowCount > 0 && (
        <div
          className="absolute bottom-2 right-3 z-20 px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)]/90 text-[10px] font-mono text-[var(--color-fg-muted)] pointer-events-none"
          title={`${fit.overflowCount} more residents — switch to Cards mode to see them`}
        >
          +{fit.overflowCount} more
        </div>
      )}

      {/* Chimney smoke keyframes — local style, scoped via .relay-smoke class */}
      <style>{SMOKE_CSS}</style>
      <style>{DECOR_CSS}</style>
      <style>{PARTICLE_CSS}</style>
      <style>{BUSTLE_CSS}</style>
      <style>{PARK_RESIDENT_CSS}</style>
      <style>{HOUSE_CHAT_CSS}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moodlet bubble — emoji floating above the house
// ---------------------------------------------------------------------------

function MoodletBubble({ sim }: { sim: SimCardModel }) {
  return (
    <span
      className="inline-flex items-center justify-center text-[16px] leading-none mb-1"
      style={{
        filter: `drop-shadow(0 1px 1px rgba(0,0,0,0.35))`,
      }}
      title={`mood: ${sim.mood.label}`}
      aria-hidden
    >
      {sim.mood.emoji}
    </span>
  );
}

// ---------------------------------------------------------------------------
// House label
// ---------------------------------------------------------------------------

function HouseLabel({
  sim,
  selected,
  compact = false,
}: {
  sim: SimCardModel;
  selected: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "mt-1 max-w-full text-[10px] font-mono truncate text-center px-1",
        compact ? "text-[9px]" : "",
        selected ? "font-bold" : "",
      )}
      style={{ color: "#0a0a0a" }}
      title={sim.repo ?? "—"}
    >
      <span className="truncate inline-block max-w-full align-bottom">
        {sim.repo ?? "—"}
      </span>
      {sim.agentId && !compact && (
        <span
          className="ml-1 text-[9px] truncate"
          style={{ color: "#374151" }}
        >
          {sim.agentId.slice(0, 6)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// House SVG — isometric-ish silhouette
// ---------------------------------------------------------------------------

interface HouseSvgProps {
  sim: SimCardModel;
  size: HouseSize;
  chimneyActive: boolean;
  /** When true, render windows lit + a slight glow. */
  highlight?: boolean;
  /** Park houses are dimmed and lose their chimney + window glow. */
  dim?: boolean;
  /** Active event — used for achievement aura glow. */
  event?: LifeEvent;
  /** When true (active sim + dusk/night), windows pulse with warm light. */
  windowsLit?: boolean;
  /** Subagent-driven liveliness overlay. `quiet` = no overlay. */
  bustle?: Bustle;
}

function HouseSvg({ sim, size, chimneyActive, highlight, dim, event, windowsLit, bustle }: HouseSvgProps) {
  // House box geometry — picked so all three sizes share the same base
  // line so the village footprint stays flat.
  const dim_ = sizeToDims(size);

  const roofHue = hashRepoToHue(sim.repo);
  const wallHueShift = agentHueShift(sim.sessionType);
  const wallHue = (roofHue + wallHueShift + 360) % 360;

  const roofColor = `hsl(${roofHue}, 55%, 45%)`;
  const roofShadow = `hsl(${roofHue}, 60%, 35%)`;
  const wallFront = `hsl(${wallHue}, 30%, 65%)`;
  const wallSide = `hsl(${wallHue}, 30%, 50%)`;

  const winLit = chimneyActive && !dim;
  const nightGlow = !!windowsLit && !dim;
  const winFill = nightGlow
    ? "hsl(48, 95%, 65%)"
    : winLit
    ? `hsl(${(roofHue + 50) % 360}, 90%, 65%)`
    : "hsl(220, 15%, 30%)";
  const winGlowStyle = nightGlow
    ? {
        color: "#FFD27E",
        animation: "relayHamletWindowGlow 3.2s ease-in-out infinite",
      }
    : undefined;

  const W = dim_.w;
  const H = dim_.h;

  // Anchor: the front-face quad has its bottom-left at (0, H) so the same
  // ground line is shared across sizes.
  const eaveY = H - dim_.wallH;
  const ridgeY = eaveY - dim_.roofH;
  const sideX = W * 0.7;

  const achievementGlow = event?.kind === "achievement";
  const bustleActive = !!bustle && bustle.intensity !== "quiet" && !dim;
  const bustleCfg = bustle ? bustleSpriteCount(bustle.intensity) : null;
  // Where multi-window glow sits — centered on the front wall, replacing
  // the default static windows when bustle is active.
  const winCellW = dim_.wallH * 0.22;
  const winCellH = dim_.wallH * 0.22;
  const winRowY = eaveY + dim_.wallH * 0.18;
  const winRowX = W * 0.38; // center of the front wall window strip
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden
      style={{
        filter: achievementGlow
          ? "drop-shadow(0 0 4px hsla(45, 95%, 60%, 0.45))"
          : highlight
          ? "drop-shadow(0 4px 6px rgba(0,0,0,0.25))"
          : undefined,
        animation: achievementGlow
          ? "relayHamletAura 2.6s ease-in-out infinite"
          : undefined,
      }}
    >
      {/* Ground shadow */}
      <ellipse
        cx={W / 2}
        cy={H - 2}
        rx={W * 0.42}
        ry={4}
        fill="var(--color-fg-dim)"
        opacity={0.35}
      />

      <HouseAura intensity={bustleActive && bustle ? bustle.intensity : "quiet"}>
      {/* Side wall (right) — gives it the isometric tilt + darker shadow band */}
      <polygon
        points={`${W * 0.55},${eaveY} ${sideX},${eaveY - 4} ${sideX},${H - 4} ${W * 0.55},${H}`}
        fill={wallSide}
      />
      {/* Side wall vertical edge highlight where it meets the front face */}
      <rect x={W * 0.55} y={eaveY} width={1.2} height={dim_.wallH} fill={`hsl(${wallHue}, 35%, 78%)`} opacity={0.85} />

      {/* Front wall — base mid-tone */}
      <rect
        x={W * 0.18}
        y={eaveY}
        width={W * 0.37}
        height={dim_.wallH}
        fill={wallFront}
      />
      {/* Wall highlight band (left ~22%) */}
      <rect
        x={W * 0.18}
        y={eaveY}
        width={W * 0.08}
        height={dim_.wallH}
        fill={`hsl(${wallHue}, 38%, 78%)`}
        opacity={0.7}
      />
      {/* Wall shadow band (right ~22%) */}
      <rect
        x={W * 0.47}
        y={eaveY}
        width={W * 0.08}
        height={dim_.wallH}
        fill={`hsl(${wallHue}, 28%, 48%)`}
        opacity={0.55}
      />

      {/* Roof — shadow half (right) drawn first so the lit half sits on top */}
      <polygon
        points={`${W * 0.365},${eaveY} ${W * 0.365},${ridgeY} ${W * 0.61},${eaveY}`}
        fill={roofShadow}
      />
      {/* Roof lit half (left) */}
      <polygon
        points={`${W * 0.12},${eaveY} ${W * 0.365},${ridgeY} ${W * 0.365},${eaveY}`}
        fill={`hsl(${roofHue}, 60%, 58%)`}
      />
      {/* Roof ridge — bright sliver along the top edge */}
      <line
        x1={W * 0.365}
        y1={ridgeY}
        x2={W * 0.5}
        y2={eaveY - dim_.roofH * 0.1}
        stroke={`hsl(${roofHue}, 70%, 75%)`}
        strokeWidth={1.2}
        opacity={0.8}
      />
      {/* Tile pattern — vertical dashes on the lit half */}
      <g stroke={`hsl(${roofHue}, 50%, 38%)`} strokeWidth="0.5" opacity="0.55">
        <line x1={W * 0.18} y1={eaveY} x2={W * 0.21} y2={eaveY - dim_.roofH * 0.55} />
        <line x1={W * 0.24} y1={eaveY} x2={W * 0.26} y2={eaveY - dim_.roofH * 0.7} />
        <line x1={W * 0.3} y1={eaveY} x2={W * 0.31} y2={eaveY - dim_.roofH * 0.85} />
        <line x1={W * 0.36} y1={eaveY} x2={W * 0.36} y2={ridgeY + 1} />
      </g>
      {/* Horizontal shingle bands */}
      <g stroke={roofShadow} strokeWidth="0.5" opacity="0.7">
        <line x1={W * 0.16} y1={eaveY - dim_.roofH * 0.25} x2={W * 0.57} y2={eaveY - dim_.roofH * 0.25} />
        <line x1={W * 0.2} y1={eaveY - dim_.roofH * 0.5} x2={W * 0.53} y2={eaveY - dim_.roofH * 0.5} />
        <line x1={W * 0.24} y1={eaveY - dim_.roofH * 0.75} x2={W * 0.49} y2={eaveY - dim_.roofH * 0.75} />
      </g>
      {/* Roof side (darker) — already shadowed isometric face */}
      <polygon
        points={`${W * 0.61},${eaveY} ${W * 0.365},${ridgeY} ${sideX + 4},${ridgeY + 4} ${sideX},${eaveY - 4}`}
        fill={roofShadow}
      />
      {/* Eave shadow line under the roof — drops a thin dark stripe so the
          roof reads as casting onto the wall. */}
      <rect x={W * 0.18} y={eaveY} width={W * 0.37} height={1.2} fill="rgba(0,0,0,0.35)" />

      {/* Door frame (outer) */}
      <rect
        x={W * 0.32 - 1}
        y={H - dim_.wallH * 0.55 - 1}
        width={dim_.wallH * 0.22 + 2}
        height={dim_.wallH * 0.55 + 1}
        fill="hsl(25, 35%, 15%)"
        rx={1.2}
      />
      {/* Door panel */}
      <rect
        x={W * 0.32}
        y={H - dim_.wallH * 0.55}
        width={dim_.wallH * 0.22}
        height={dim_.wallH * 0.55}
        fill="hsl(25, 35%, 25%)"
        rx={1}
      />
      {/* F-3 — wood-grain texture on the door panel. */}
      <rect
        x={W * 0.32}
        y={H - dim_.wallH * 0.55}
        width={dim_.wallH * 0.22}
        height={dim_.wallH * 0.55}
        fill="hsl(25, 50%, 18%)"
        filter={`url(#${DIORAMA_DEFS.woodGrain})`}
        opacity={0.35}
        rx={1}
      />
      {/* Door inner recessed plate */}
      <rect
        x={W * 0.32 + dim_.wallH * 0.04}
        y={H - dim_.wallH * 0.55 + dim_.wallH * 0.08}
        width={dim_.wallH * 0.14}
        height={dim_.wallH * 0.35}
        fill="hsl(25, 38%, 32%)"
        rx={0.6}
      />
      {/* Door shadow side (right edge) */}
      <rect
        x={W * 0.32 + dim_.wallH * 0.18}
        y={H - dim_.wallH * 0.55}
        width={dim_.wallH * 0.04}
        height={dim_.wallH * 0.55}
        fill="rgba(0,0,0,0.32)"
        rx={0.5}
      />
      {/* Door knob + tiny highlight */}
      <circle cx={W * 0.32 + dim_.wallH * 0.18} cy={H - dim_.wallH * 0.28} r={0.9} fill="hsl(45, 75%, 55%)" />
      <circle cx={W * 0.32 + dim_.wallH * 0.17} cy={H - dim_.wallH * 0.29} r={0.35} fill="hsl(45, 95%, 85%)" />

      {/* Windows (1 or 2 depending on size) — replaced by a MultiWindowGlow
          row when bustle is active and we have hues to color them. */}
      {bustleActive && bustleCfg && bustleCfg.windows > 0 && bustle ? (
        <MultiWindowGlow
          x={winRowX}
          y={winRowY}
          cellW={winCellW}
          cellH={winCellH}
          count={bustleCfg.windows}
          hues={bustle.subagentHues}
          baseFill={winFill}
          period={bustle.intensity === "party" ? 0.9 : bustle.intensity === "busy" ? 1.3 : 1.7}
        />
      ) : (
        <>
          <DioramaWindow
            x={W * 0.21}
            y={eaveY + dim_.wallH * 0.18}
            size={dim_.wallH * 0.22}
            fill={winFill}
            lit={winLit || nightGlow}
            glowStyle={winGlowStyle}
          />
          {size !== "sm" && (
            <DioramaWindow
              x={W * 0.45}
              y={eaveY + dim_.wallH * 0.18}
              size={dim_.wallH * 0.22}
              fill={winFill}
              lit={winLit || nightGlow}
              glowStyle={winGlowStyle}
            />
          )}
        </>
      )}

      {/* Chimney — dark base with brick highlights */}
      <rect
        x={W * 0.5}
        y={ridgeY + dim_.roofH * 0.2}
        width={W * 0.07}
        height={dim_.roofH * 0.55}
        fill="hsl(15, 30%, 35%)"
      />
      {/* Brick pattern — three horizontal courses with offset half-bricks */}
      <g stroke="hsl(15, 20%, 22%)" strokeWidth={0.35} opacity={0.85}>
        <line x1={W * 0.5} y1={ridgeY + dim_.roofH * 0.34} x2={W * 0.57} y2={ridgeY + dim_.roofH * 0.34} />
        <line x1={W * 0.5} y1={ridgeY + dim_.roofH * 0.48} x2={W * 0.57} y2={ridgeY + dim_.roofH * 0.48} />
        <line x1={W * 0.5} y1={ridgeY + dim_.roofH * 0.62} x2={W * 0.57} y2={ridgeY + dim_.roofH * 0.62} />
        <line x1={W * 0.535} y1={ridgeY + dim_.roofH * 0.2} x2={W * 0.535} y2={ridgeY + dim_.roofH * 0.34} />
        <line x1={W * 0.505} y1={ridgeY + dim_.roofH * 0.34} x2={W * 0.505} y2={ridgeY + dim_.roofH * 0.48} />
        <line x1={W * 0.565} y1={ridgeY + dim_.roofH * 0.34} x2={W * 0.565} y2={ridgeY + dim_.roofH * 0.48} />
        <line x1={W * 0.535} y1={ridgeY + dim_.roofH * 0.48} x2={W * 0.535} y2={ridgeY + dim_.roofH * 0.62} />
      </g>
      {/* Chimney lit edge */}
      <rect x={W * 0.5} y={ridgeY + dim_.roofH * 0.2} width={0.8} height={dim_.roofH * 0.55} fill="hsl(15, 40%, 55%)" opacity={0.7} />
      {/* Chimney cap */}
      <rect
        x={W * 0.495}
        y={ridgeY + dim_.roofH * 0.18}
        width={W * 0.08}
        height={1.4}
        fill="hsl(15, 22%, 22%)"
      />

      {/* Chimney smoke — uses the colorful bustle variant whenever the
          house has recently-active subagents; otherwise falls back to the
          default 3-puff monochrome plume. */}
      {chimneyActive && !dim && bustleActive && bustle && bustleCfg && bustleCfg.smoke > 0 ? (
        <BustleChimneySmoke
          cx={W * 0.535}
          cy={ridgeY + dim_.roofH * 0.05}
          colors={bustle.subagentHues.length > 0 ? bustle.subagentHues : [roofHue]}
          density={bustleCfg.smoke}
        />
      ) : (
        chimneyActive && !dim && (
          <g
            className="relay-smoke"
            style={{
              transformOrigin: `${W * 0.535}px ${ridgeY + dim_.roofH * 0.2}px`,
            }}
          >
            <circle
              cx={W * 0.535}
              cy={ridgeY + dim_.roofH * 0.05}
              r={3}
              fill={`hsl(${roofHue}, 30%, 80%)`}
              opacity={0.75}
              style={{ animation: "relayHamletSmoke 2.4s ease-out infinite" }}
            />
            <circle
              cx={W * 0.535}
              cy={ridgeY + dim_.roofH * 0.05}
              r={2.2}
              fill={`hsl(${roofHue}, 30%, 85%)`}
              opacity={0.65}
              style={{ animation: "relayHamletSmoke 2.4s ease-out 0.6s infinite" }}
            />
            <circle
              cx={W * 0.535}
              cy={ridgeY + dim_.roofH * 0.05}
              r={1.6}
              fill={`hsl(${roofHue}, 25%, 88%)`}
              opacity={0.55}
              style={{ animation: "relayHamletSmoke 2.4s ease-out 1.2s infinite" }}
            />
          </g>
        )
      )}

      {/* Roof music notes — only at lively+ intensity. */}
      {bustleActive && bustle && bustleCfg && bustleCfg.notes > 0 && (
        <RoofMusicNotes
          count={bustleCfg.notes}
          hues={bustle.subagentHues.length > 0 ? bustle.subagentHues : [roofHue]}
          ridgeX={W * 0.365}
          ridgeY={ridgeY - 1}
          intensity={bustle.intensity}
        />
      )}
      </HouseAura>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// DioramaWindow — multi-layer frame (outer dark frame + white inner sash +
// glass with vertical/horizontal cross grid + top-left reflection).
// ---------------------------------------------------------------------------

function DioramaWindow({
  x,
  y,
  size,
  fill,
  lit,
  glowStyle,
}: {
  x: number;
  y: number;
  size: number;
  fill: string;
  lit: boolean;
  glowStyle?: { color?: string; animation?: string };
}) {
  // Outer frame thickness ~ 8% of the size; sash ~ 6%.
  const frameOuter = Math.max(0.6, size * 0.08);
  const sashOffset = Math.max(0.4, size * 0.14);
  return (
    <g style={glowStyle}>
      {/* Outer dark frame */}
      <rect
        x={x - frameOuter * 0.5}
        y={y - frameOuter * 0.5}
        width={size + frameOuter}
        height={size + frameOuter}
        fill="hsl(20, 30%, 18%)"
        rx={1}
      />
      {/* Inner white sash */}
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        fill="hsl(30, 25%, 88%)"
        rx={0.6}
      />
      {/* Glass — colored fill */}
      <rect
        x={x + sashOffset * 0.5}
        y={y + sashOffset * 0.5}
        width={size - sashOffset}
        height={size - sashOffset}
        fill={fill}
        stroke="hsl(0, 0%, 15%)"
        strokeWidth={0.4}
      />
      {/* Cross grid — vertical + horizontal mullion */}
      <line
        x1={x + size * 0.5}
        y1={y + sashOffset * 0.5}
        x2={x + size * 0.5}
        y2={y + size - sashOffset * 0.5}
        stroke="hsl(30, 25%, 78%)"
        strokeWidth={0.5}
      />
      <line
        x1={x + sashOffset * 0.5}
        y1={y + size * 0.5}
        x2={x + size - sashOffset * 0.5}
        y2={y + size * 0.5}
        stroke="hsl(30, 25%, 78%)"
        strokeWidth={0.5}
      />
      {/* Reflection — slim white triangle in the top-left pane (only when
          not strongly lit — avoids washing out warm interior glow). */}
      {!lit && (
        <polygon
          points={`${x + sashOffset * 0.7},${y + sashOffset * 0.7} ${x + size * 0.45},${y + sashOffset * 0.7} ${x + sashOffset * 0.7},${y + size * 0.4}`}
          fill="rgba(255,255,255,0.45)"
        />
      )}
    </g>
  );
}

function sizeToDims(size: HouseSize): { w: number; h: number; wallH: number; roofH: number } {
  switch (size) {
    case "sm":
      return { w: 70, h: 78, wallH: 30, roofH: 22 };
    case "md":
      return { w: 86, h: 94, wallH: 38, roofH: 28 };
    case "lg":
      return { w: 100, h: 108, wallH: 46, roofH: 34 };
  }
}

// ---------------------------------------------------------------------------
// Event overlay — emoji floats / bounces / hovers around the house
// ---------------------------------------------------------------------------

function EventOverlay({ event }: { event: LifeEvent }) {
  // Each kind gets its own placement + animation so overlays don't collide
  // with the moodlet bubble. fire = above the roof, baby/birthday = head,
  // reaper = right side, wedding = head heart, achievement is handled by
  // the HouseSvg glow.
  if (event.kind === "achievement") {
    // Pure glow on the house; we still surface a tiny ⭐ at top-right.
    return (
      <span
        className="absolute top-0 right-2 text-[13px] leading-none pointer-events-none"
        style={{
          color: severityColor(event.severity),
          animation: "relayHamletTwinkle 1.8s ease-in-out infinite",
        }}
        aria-hidden
      >
        ⭐
      </span>
    );
  }
  if (event.kind === "reaper") {
    return (
      <span
        className="absolute top-6 right-0 text-[18px] leading-none pointer-events-none"
        style={{ animation: "relayHamletHover 3.2s ease-in-out infinite" }}
        aria-hidden
      >
        💀
      </span>
    );
  }
  if (event.kind === "fire") {
    return (
      <span
        className="absolute top-4 left-1/2 -translate-x-1/2 text-[18px] leading-none pointer-events-none"
        style={{
          animation: "relayHamletPulse 0.9s ease-in-out infinite",
          filter: "drop-shadow(0 0 6px hsla(15, 95%, 55%, 0.85))",
        }}
        aria-hidden
      >
        🔥
      </span>
    );
  }
  if (event.kind === "birthday") {
    return (
      <span
        className="absolute top-1 left-1/2 -translate-x-1/2 text-[16px] leading-none pointer-events-none"
        style={{ animation: "relayHamletBounce 1.4s ease-in-out infinite" }}
        aria-hidden
      >
        🎂
      </span>
    );
  }
  if (event.kind === "baby") {
    return (
      <span
        className="absolute top-1 left-1/2 -translate-x-1/2 text-[15px] leading-none pointer-events-none"
        style={{ animation: "relayHamletBounce 1.6s ease-in-out infinite" }}
        aria-hidden
      >
        👶
      </span>
    );
  }
  if (event.kind === "wedding") {
    return (
      <span
        className="absolute top-1 left-1/2 -translate-x-1/2 text-[15px] leading-none pointer-events-none"
        style={{ animation: "relayHamletPulse 1.6s ease-in-out infinite" }}
        aria-hidden
      >
        💍
      </span>
    );
  }
  if (event.kind === "quest") {
    return (
      <span
        className="absolute top-1 left-1/2 -translate-x-1/2 text-[15px] leading-none pointer-events-none"
        style={{ animation: "relayHamletTwinkle 1.8s ease-in-out infinite" }}
        aria-hidden
      >
        🎯
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Road path — curve from parent to child
// ---------------------------------------------------------------------------

function slotCenter(slot: { col: number; row: number }, w: number, h: number): { x: number; y: number } {
  return { x: slot.col * w + w / 2, y: slot.row * h + h * 0.85 };
}

function roadPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  // Quadratic curve via the midpoint nudged toward the road's broader axis
  // so the path "bends" through the village rather than cutting straight.
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  // Perpendicular offset proportional to horizontal travel — long-distance
  // roads bow out, short ones stay nearly straight.
  const off = Math.min(40, Math.abs(dx) * 0.2);
  const cx = mx;
  const cy = my + off;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

// ---------------------------------------------------------------------------
// Axis B — Letter bird: ✉ flies from parent → child along the road path
// ---------------------------------------------------------------------------

function hashRoadId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h) ^ id.charCodeAt(i);
  }
  return (h >>> 0);
}

function LetterBird({
  road,
  activeW,
  activeH,
}: {
  road: { id: string; from: { x: number; y: number }; to: { x: number; y: number } };
  activeW: number;
  activeH: number;
}) {
  const seed = hashRoadId(road.id);
  // Delay: 6–12s based on seed; duration: 4–5s.
  const delayS = 6 + (seed % 7);
  const durationS = 4 + (seed % 2);

  // The bird travels the same quadratic-curve path as the road.
  // We use a CSS `offset-path` motion path on a <text> element inside the SVG.
  // `offset-distance` keyframes go 0% → 100%.
  const pathId = `bird-path-${road.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const d = roadPath(road.from, road.to);

  return (
    <>
      <defs>
        <path id={pathId} d={d} />
      </defs>
      <text
        fontSize={12}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          offsetPath: `path('${d}')`,
          offsetDistance: "0%",
          animation: `relayLetterBird ${durationS}s ease-in-out ${delayS}s infinite`,
        } as React.CSSProperties}
      >
        ✉️
      </text>
    </>
  );
}

// ---------------------------------------------------------------------------
// Axis C — Shooting star: diagonal streak across the night sky
// ---------------------------------------------------------------------------

function ShootingStar({ width, height }: { width: number; height: number }) {
  // Static — the animation is purely CSS, no JS state needed.
  // The star starts top-right and moves to lower-left over 3–4s.
  // Interval between shots: 20–40s handled by a long animation cycle.
  const starLen = Math.min(width * 0.22, 80);
  // Position: start at ~80% from left, top 10% of the ceiling.
  const x1 = width * 0.80;
  const y1 = height * 0.08;
  const x2 = x1 - starLen * 1.3;
  const y2 = y1 + starLen * 0.7;

  return (
    <svg
      className="absolute inset-0 pointer-events-none relay-shooting-star"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ top: 0, left: 0 }}
    >
      <g style={{ animation: "relayShootingStar 30s linear infinite" }}>
        {/* Streak tail */}
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="white"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.9}
        />
        {/* Leading star dot */}
        <circle cx={x2} cy={y2} r={2} fill="white" opacity={0.95} />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Axis D — Founder crown: 👑 badge above the oldest resident's roof
// ---------------------------------------------------------------------------

function FounderCrown({
  sim,
  now,
  cellW,
  cellH,
}: {
  sim: SimCardModel;
  now: number;
  cellW: number;
  cellH: number;
}) {
  const daysAlive = Math.floor((now - sim.bornAt) / (1000 * 60 * 60 * 24));
  const label = `👑 Founder · ${daysAlive}日連続在住`;

  // Position: roof's left shoulder. The house SVG is bottom-aligned inside
  // the cell, so the crown sits near the top of the cell.
  return (
    <span
      aria-label={label}
      title={label}
      className="absolute pointer-events-auto select-none"
      style={{
        // Left shoulder of the roof — roughly left: 18% of cellW, top: 16% of cellH.
        left: Math.max(2, Math.floor(cellW * 0.16)),
        top: Math.max(2, Math.floor(cellH * 0.14)),
        fontSize: 14,
        lineHeight: 1,
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
        zIndex: 5,
      }}
    >
      👑
    </span>
  );
}

// ---------------------------------------------------------------------------
// Keyframes — chimney smoke + panel slide
// ---------------------------------------------------------------------------

const SMOKE_CSS = `
@keyframes relayHamletSmoke {
  0%   { transform: translate(0, 0) scale(0.7); opacity: 0; }
  20%  { opacity: 0.75; }
  100% { transform: translate(-4px, -28px) scale(1.4); opacity: 0; }
}
@keyframes relayHamletBounce {
  0%, 100% { transform: translate(-50%, 0) scale(1); }
  50%      { transform: translate(-50%, -4px) scale(1.08); }
}
@keyframes relayHamletPulse {
  0%, 100% { transform: translate(-50%, 0) scale(1); opacity: 0.85; }
  50%      { transform: translate(-50%, 0) scale(1.18); opacity: 1; }
}
@keyframes relayHamletHover {
  0%, 100% { transform: translate(0, 0); opacity: 0.7; }
  50%      { transform: translate(2px, -3px); opacity: 1; }
}
@keyframes relayHamletTwinkle {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50%      { transform: scale(1.15); opacity: 1; }
}
@keyframes relayHamletAura {
  0%, 100% { filter: drop-shadow(0 0 4px hsla(45, 95%, 60%, 0.5)); }
  50%      { filter: drop-shadow(0 0 10px hsla(45, 95%, 60%, 0.95)); }
}

/* Axis B — Letter bird travels along offset-path */
@keyframes relayLetterBird {
  0%   { offset-distance: 0%;   opacity: 0; }
  8%   { opacity: 1; }
  80%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}

/* Axis C — Shooting star: flash in, streak across, fade out in a 30s cycle */
@keyframes relayShootingStar {
  0%    { opacity: 0; transform: translateX(0)   translateY(0); }
  2%    { opacity: 1; }
  8%    { opacity: 0; transform: translateX(-18%) translateY(10%); }
  8.01% { opacity: 0; transform: translateX(0)   translateY(0); }
  100%  { opacity: 0; transform: translateX(0)   translateY(0); }
}

/* Axis A — News ticker fade in/out (applied via CSS class swap) */
@keyframes relayNewsFadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Reduced-motion: freeze all hamlet extras */
@media (prefers-reduced-motion: reduce) {
  .relay-shooting-star,
  .relay-news-ticker { animation: none !important; }
  [style*="relayLetterBird"]  { animation: none !important; }
}
`;
