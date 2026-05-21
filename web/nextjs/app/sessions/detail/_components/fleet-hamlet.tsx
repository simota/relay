"use client";

import {
  ArrowUpRight,
  DoorOpen,
  Home as HomeIcon,
  LayoutGrid,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSessionDetails } from "../_hooks/use-session-details";
import { buildHueMap } from "../_lib/fleet-activity";
import { isArchived } from "../_lib/fleet-hamlet-cemetery";
import { collectAllEvents } from "../_lib/fleet-hamlet-events";
import {
  type AvatarParts,
  avatarPartsFromSeed,
  buildSimCards,
  needColor,
  needLabel,
  NEED_ORDER,
  type SimCardModel,
} from "../_lib/fleet-hamlet";
import { moodGradient } from "../_lib/fleet-hamlet-decor";
import { AvatarBody, DECOR_CSS } from "./fleet-hamlet-decor";
import { HAMLET_AVATAR_CSS, HeadFace } from "./fleet-hamlet-avatar";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";
import { CrownSvg, HatSvg, PARTICLE_CSS } from "./fleet-hamlet-particles";
import { deriveAccessories } from "../_lib/fleet-hamlet-particles";
import { sessionKey, statusColor } from "../_lib/fleet-timeline";
import type { TileSpec } from "../_types";
import {
  parseHamletSelection,
  readHamletSelectionPref,
  writeHamletSelectionPref,
} from "../_lib/fleet-hamlet-neighborhood-selection";
import { FleetHamletEventsBanner } from "./fleet-hamlet-events-banner";
import { FleetHamletHouse } from "./fleet-hamlet-house";
import { FleetHamletNeighborhood } from "./fleet-hamlet-neighborhood";
import { FleetHamletNeighborhoodPanel } from "./fleet-hamlet-neighborhood-panel";
import { FleetHamletRooms } from "./fleet-hamlet-rooms";
import { RelationshipsPanel } from "./fleet-hamlet-relations-panel";
import { SkillsPanel } from "./fleet-hamlet-skills-panel";
import type { FleetViewData } from "./fleet-view";

export { parseHamletSelection } from "../_lib/fleet-hamlet-neighborhood-selection";

// Re-tick `now` so age-driven needs and moods animate without a refetch.
const NOW_TICK_MS = 15_000;

export type HamletMode = "neighborhood" | "rooms" | "house";

// Modes that can be the "prior" mode we restore when leaving House. House
// itself is intentionally excluded — the back arrow goes to one of the
// browsing modes (Neighborhood or Rooms).
export type HamletPriorMode = "neighborhood" | "rooms";

// LocalStorage key for the mode preference. Mode also lives in the URL
// (?hm=) — localStorage is the fallback that survives a bare `/sessions/detail`
// landing without a query string.
const MODE_STORAGE_KEY = "relay.sessions.detail.hamletMode";
const PRIOR_MODE_STORAGE_KEY = "relay.sessions.detail.hamletPriorMode";

function readModePref(): HamletPriorMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (v === "neighborhood" || v === "rooms") return v;
    return null;
  } catch {
    return null;
  }
}

function writeModePref(v: HamletPriorMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, v);
  } catch {
    // ignore — Safari private mode etc.
  }
}

function readPriorMode(): HamletPriorMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(PRIOR_MODE_STORAGE_KEY);
    if (v === "neighborhood" || v === "rooms") return v;
    return null;
  } catch {
    return null;
  }
}

function writePriorMode(v: HamletPriorMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRIOR_MODE_STORAGE_KEY, v);
  } catch {
    // ignore
  }
}

export function parseHamletMode(params: URLSearchParams): HamletMode {
  const v = params.get("hm");
  if (v === "house") return "house";
  if (v === "rooms") return "rooms";
  return "neighborhood";
}

/** Decode the URL-encoded session id selected for House Plan, if any. */
export function parseHamletHouseId(params: URLSearchParams): string | null {
  const raw = params.get("hid");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

interface Props {
  data: FleetViewData;
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
}

export function FleetHamlet({
  data,
  selectedKeys,
  onPickSession,
  canAdd,
}: Props) {
  const { sessions, streamStatus, error } = data;
  const router = useRouter();
  const params = useSearchParams();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Mode resolution: URL wins; otherwise localStorage preference; otherwise
  // default to "neighborhood". On first paint we trust the URL (or default).
  // After mount we may upgrade the URL with the localStorage preference if
  // the user had no `hm=` set in the URL — keeps deep links predictable while
  // restoring last-used mode for naive `/sessions/detail?view=fleet&fv=hamlet`
  // landings.
  const urlMode: HamletMode = parseHamletMode(
    new URLSearchParams(params.toString()),
  );
  const urlHouseId: string | null = parseHamletHouseId(
    new URLSearchParams(params.toString()),
  );
  const urlSelectionId: string | null = parseHamletSelection(
    new URLSearchParams(params.toString()),
  );
  const [hydratedMode, setHydratedMode] = useState<HamletMode>(urlMode);

  // Neighborhood-mode selection ("which house is open in the right panel").
  // URL wins → localStorage fallback → auto-pick most active (resolved later
  // once we have `livingSims`). We start with whatever the URL says so the
  // first paint matches a refresh.
  const [hydratedSelection, setHydratedSelection] = useState<string | null>(
    urlSelectionId,
  );

  useEffect(() => {
    // On mount, if the URL didn't pin a mode and the user has a stored
    // preference, lift it into the URL so refreshes are stable. We only do
    // this once on mount — otherwise the URL change loop would clobber any
    // subsequent user toggle.
    if (!params.get("hm")) {
      const stored = readModePref();
      if (stored && stored !== urlMode) {
        const next = new URLSearchParams(params.toString());
        next.set("hm", stored);
        router.replace(`/sessions/detail?${next.toString()}`);
        setHydratedMode(stored);
        return;
      }
    }
    setHydratedMode(urlMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep `hydratedMode` in sync with later URL changes (e.g. user clicks
  // the toggle, which calls router.replace).
  useEffect(() => {
    setHydratedMode(urlMode);
  }, [urlMode]);

  // On mount, if URL didn't pin a selection, lift the localStorage value
  // into the URL so refreshes are stable. Done once — later toggles update
  // both the URL and storage explicitly via `setSelection`.
  useEffect(() => {
    if (!params.get("sel")) {
      const stored = readHamletSelectionPref();
      if (stored) {
        const next = new URLSearchParams(params.toString());
        next.set("sel", encodeURIComponent(stored));
        router.replace(`/sessions/detail?${next.toString()}`);
        setHydratedSelection(stored);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror later URL changes into hydratedSelection.
  useEffect(() => {
    setHydratedSelection(urlSelectionId);
  }, [urlSelectionId]);

  const setSelection = useCallback(
    (sessionId: string | null) => {
      writeHamletSelectionPref(sessionId);
      const qs = new URLSearchParams(params.toString());
      if (sessionId === null) {
        qs.delete("sel");
      } else {
        qs.set("sel", encodeURIComponent(sessionId));
      }
      router.replace(`/sessions/detail?${qs.toString()}`);
    },
    [params, router],
  );

  const setBrowseMode = useCallback(
    (next: HamletPriorMode) => {
      writeModePref(next);
      const qs = new URLSearchParams(params.toString());
      qs.set("hm", next);
      qs.delete("hid");
      router.replace(`/sessions/detail?${qs.toString()}`);
    },
    [params, router],
  );

  const enterHouse = useCallback(
    (target: SimCardModel) => {
      // Remember the mode we're leaving so the back arrow can restore it.
      if (hydratedMode === "neighborhood" || hydratedMode === "rooms") {
        writePriorMode(hydratedMode);
      }
      const qs = new URLSearchParams(params.toString());
      qs.set("hm", "house");
      qs.set("hid", encodeURIComponent(target.sessionId));
      // 軸4: push で history エントリを積み、ブラウザ back で戻れるようにする
      router.push(`/sessions/detail?${qs.toString()}`);
    },
    [hydratedMode, params, router],
  );

  const exitHouse = useCallback(() => {
    const prior = readPriorMode() ?? "neighborhood";
    writeModePref(prior);
    const qs = new URLSearchParams(params.toString());
    qs.set("hm", prior);
    qs.delete("hid");
    router.replace(`/sessions/detail?${qs.toString()}`);
  }, [params, router]);

  // Sim cards need per-session detail for Fun / Hygiene / Comfort. Reuse
  // the shared hook so all four Fleet tabs share the same detail cache.
  const details = useSessionDetails(sessions);
  const hueMap = useMemo(() => buildHueMap(sessions), [sessions]);

  const sims = useMemo(
    () => buildSimCards(sessions, { now, hueMap, detailByKey: details }),
    [sessions, now, hueMap, details],
  );

  // Sort newest first so just-spawned residents land in the top-left tile
  // (Cards mode). Neighborhood does its own deterministic placement.
  const sortedSims = useMemo(
    () => [...sims].sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [sims],
  );

  // Living vs archived split. Neighborhood / Cards / Relations only show
  // the living; Cemetery shows the archived. House Plan can be entered for
  // either — the "Archived" banner makes the read-only intent clear.
  const livingSims = useMemo(
    () => sortedSims.filter((s) => !isArchived(s, now)),
    [sortedSims, now],
  );

  const allEvents = useMemo(
    () => collectAllEvents(sortedSims, details, now),
    [sortedSims, details, now],
  );

  // House Plan resolution: only meaningful when mode === "house". If the
  // requested session id no longer exists in the fleet (e.g. it ended and
  // dropped off), we fall back to the prior browsing mode automatically.
  const houseSim = useMemo(() => {
    if (hydratedMode !== "house" || !urlHouseId) return null;
    return sortedSims.find((s) => s.sessionId === urlHouseId) ?? null;
  }, [hydratedMode, urlHouseId, sortedSims]);

  useEffect(() => {
    if (hydratedMode === "house" && (!urlHouseId || (sortedSims.length > 0 && !houseSim))) {
      // Stale `hid` or missing param — drop back to a browse mode.
      exitHouse();
    }
  }, [hydratedMode, urlHouseId, houseSim, sortedSims.length, exitHouse]);

  const houseDetail =
    houseSim !== null ? details.get(houseSim.key) : undefined;

  const archivedCount = sortedSims.length - livingSims.length;

  // Auto-pick the most-active living sim when Neighborhood mode is open
  // and the user has no URL/localStorage selection. Runs once per mount
  // after data is ready — kept to neighborhood so other modes are
  // untouched by the right panel.
  const didAutoPickRef = useRef(false);
  useEffect(() => {
    if (didAutoPickRef.current) return;
    if (hydratedMode !== "neighborhood") return;
    if (livingSims.length === 0) return;
    if (hydratedSelection !== null) {
      didAutoPickRef.current = true;
      return;
    }
    if (readHamletSelectionPref() !== null) return; // mount effect will lift it
    const first = livingSims[0];
    if (!first) return;
    didAutoPickRef.current = true;
    setSelection(first.sessionId);
  }, [hydratedMode, livingSims, hydratedSelection, setSelection]);

  // Resolve the panel target from the current selection. Falls back to null
  // (empty state) when the id no longer matches a known sim (e.g. archived
  // out from under us). We hand the *living* set to the right panel — peers
  // for relationships still come from the broader fleet snapshot below.
  const neighborhoodSelected = useMemo(() => {
    if (hydratedMode !== "neighborhood") return null;
    if (!hydratedSelection) return null;
    return sortedSims.find((s) => s.sessionId === hydratedSelection) ?? null;
  }, [hydratedMode, hydratedSelection, sortedSims]);

  // If the selected id ceased to exist (e.g. resident archived away), drop
  // it cleanly so the empty state re-appears instead of a stale highlight.
  useEffect(() => {
    if (hydratedMode !== "neighborhood") return;
    if (!hydratedSelection) return;
    if (sortedSims.length === 0) return;
    const found = sortedSims.some((s) => s.sessionId === hydratedSelection);
    if (!found) {
      setSelection(null);
    }
  }, [hydratedMode, hydratedSelection, sortedSims, setSelection]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <FleetHamletEventsBanner
        events={allEvents}
        cards={sortedSims}
        now={now}
        onEnterHouse={enterHouse}
      />
      <div className="flex-shrink-0 px-6 py-1.5 flex items-center gap-3 text-[11px] font-mono text-[var(--color-fg-dim)] border-b border-[var(--color-border)]">
        <span>
          <span className="text-[var(--color-fg-muted)]">
            {livingSims.length}
          </span>{" "}
          residents
          {archivedCount > 0 && (
            <span className="ml-1 text-[var(--color-fg-dim)]">
              · 🪦 {archivedCount}
            </span>
          )}
        </span>
        <span>·</span>
        <span>{streamStatus}</span>
        <span className="mx-2 text-[var(--color-fg-dim)]">·</span>
        <ModeToggle mode={hydratedMode} onChange={setBrowseMode} />
        <span className="ml-auto text-[10px]">
          {hydratedMode === "neighborhood" &&
            "isometric village · click a house for details · double-click to enter"}
          {hydratedMode === "rooms" &&
            "rooms grid · per-session interior · click to enter"}
          {hydratedMode === "house" &&
            "house plan · vitals + rooms · prototype data"}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {error && (
          <div className="px-6 py-3 text-[12px] text-[var(--color-danger,#dc2626)]">
            hamlet load failed: {error}
          </div>
        )}
        {!error && sortedSims.length === 0 && (
          <div className="px-6 py-4 text-[12px] text-[var(--color-fg-dim)]">
            no residents yet. open sessions as tiles in the Board tab to
            populate Hamlet.
          </div>
        )}

        {!error && livingSims.length > 0 && hydratedMode === "rooms" && (
          <FleetHamletRooms
            sims={livingSims}
            details={details}
            now={now}
            onEnterHouse={enterHouse}
          />
        )}

        {!error && livingSims.length > 0 && hydratedMode === "neighborhood" && (
          <NeighborhoodLayout
            sims={livingSims}
            allSims={sortedSims}
            details={details}
            now={now}
            selectedKeys={selectedKeys}
            onPickSession={onPickSession}
            canAdd={canAdd}
            onEnterHouse={enterHouse}
            selection={hydratedSelection}
            onSelectionChange={setSelection}
            selectedSim={neighborhoodSelected}
          />
        )}

        {!error && hydratedMode === "house" && houseSim && (
          <FleetHamletHouse
            sim={houseSim}
            allSims={sortedSims}
            detail={houseDetail}
            archived={isArchived(houseSim, now)}
            events={allEvents.filter((e) => e.sessionId === houseSim.sessionId)}
            now={now}
            selected={selectedKeys.has(
              sessionKey({ type: houseSim.sessionType, id: houseSim.sessionId }),
            )}
            canAdd={canAdd}
            onBack={exitHouse}
            onPickSession={onPickSession}
            onEnterHouse={enterHouse}
          />
        )}

        {!error && hydratedMode === "house" && !houseSim && sortedSims.length > 0 && (
          <div className="px-6 py-4 text-[12px] text-[var(--color-fg-dim)]">
            house not found · returning to neighborhood…
          </div>
        )}

        {!error &&
          livingSims.length === 0 &&
          sortedSims.length > 0 &&
          hydratedMode !== "house" && (
            <div className="px-6 py-4 text-[12px] text-[var(--color-fg-dim)]">
              all residents are resting.
            </div>
          )}
      </div>
    </div>
  );
}

// Neighborhood mode wrapper — handles the 2-column grid (street + rich
// panel) and the mobile single-column fallback. The street + panel are
// presentational; selection state lives in FleetHamlet so it can be
// mirrored to the URL + localStorage.
interface NeighborhoodLayoutProps {
  sims: readonly SimCardModel[];
  /** Broader fleet snapshot (living + archived) — drives relationship peers. */
  allSims: readonly SimCardModel[];
  details: ReadonlyMap<string, SessionDetail>;
  now: number;
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
  onEnterHouse: (sim: SimCardModel) => void;
  selection: string | null;
  onSelectionChange: (sessionId: string | null) => void;
  selectedSim: SimCardModel | null;
}

function NeighborhoodLayout({
  sims,
  allSims,
  details,
  now,
  selectedKeys,
  onPickSession,
  canAdd,
  onEnterHouse,
  selection,
  onSelectionChange,
  selectedSim,
}: NeighborhoodLayoutProps) {
  // On mobile (single-column), gently scroll the panel into view when a
  // new selection lands so the user immediately sees their choice. We
  // gate on a media query so the desktop grid never auto-scrolls.
  useEffect(() => {
    if (!selection) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) return;
    const el = document.getElementById("relay-hamlet-panel");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selection]);

  // Mobile (<768px): stack — street capped at 50vh on top, panel below.
  // md/lg: 2-column grid at a 3:2 ratio. Both columns flex so the interior
  // scene (right) gets enough breathing room for furniture + chat bubbles
  // without crushing the street view (left). The explicit
  // grid-template-columns avoids reflow during selection animations on
  // the house cells.
  return (
    <div
      className="h-full w-full flex flex-col md:grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] overflow-hidden"
    >
      {/* Street pane */}
      <div className="min-w-0 h-[50vh] md:h-full overflow-hidden">
        <FleetHamletNeighborhood
          sims={sims}
          detailByKey={details}
          now={now}
          selectedKeys={selectedKeys}
          onPickSession={onPickSession}
          canAdd={canAdd}
          onEnterHouse={onEnterHouse}
          selectedSessionId={selection}
          onSelectSession={onSelectionChange}
        />
      </div>
      {/* Rich Sim panel */}
      <div
        id="relay-hamlet-panel"
        className="min-w-0 flex-1 md:flex-none md:h-full overflow-hidden border-t md:border-t-0 md:border-l border-[var(--color-border)]"
      >
        <FleetHamletNeighborhoodPanel
          selectedSim={selectedSim}
          allSims={allSims}
          detailByKey={details}
          now={now}
          onEnterHouse={onEnterHouse}
          onSelect={(sim) => onSelectionChange(sim ? sim.sessionId : null)}
        />
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: HamletMode;
  onChange: (m: HamletPriorMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange("neighborhood")}
        aria-pressed={mode === "neighborhood"}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 h-5 rounded-[var(--radius-sm)] border text-[10px] font-mono",
          mode === "neighborhood"
            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
            : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
        )}
        title="isometric neighborhood view"
      >
        <HomeIcon className="w-2.5 h-2.5" aria-hidden />
        Neighborhood
      </button>
      <button
        type="button"
        onClick={() => onChange("rooms")}
        aria-pressed={mode === "rooms"}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 h-5 rounded-[var(--radius-sm)] border text-[10px] font-mono",
          mode === "rooms"
            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
            : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
        )}
        title="Per-session Room Scenes in a grid"
      >
        <LayoutGrid className="w-2.5 h-2.5" aria-hidden />
        Rooms
      </button>
    </div>
  );
}

interface SimCardProps {
  sim: SimCardModel;
  selected: boolean;
  canAdd: boolean;
  onPickSession: (spec: TileSpec) => void;
  /** When provided, render an "Enter House" button that drills into House Plan. */
  onEnterHouse?: (sim: SimCardModel) => void;
  /** Optional — when present, render compact Skills + Relations strips. */
  detail?: SessionDetail | undefined;
  allSims?: readonly SimCardModel[];
  now?: number;
}

export function SimCard({
  sim,
  selected,
  canAdd,
  onPickSession,
  onEnterHouse,
  detail,
  allSims,
  now,
}: SimCardProps) {
  const parts = useMemo(
    () => avatarPartsFromSeed(sim.avatarSeed, sim.stage.key),
    [sim.avatarSeed, sim.stage.key],
  );
  const canOpen = !selected && canAdd;
  const grad = useMemo(() => moodGradient(sim.mood.key), [sim.mood.key]);
  const accessories = useMemo(() => deriveAccessories(sim, detail), [sim, detail]);

  return (
    <li
      className={cn(
        "relative flex flex-col gap-2 p-3 rounded-[var(--radius-md)] border overflow-hidden",
        selected
          ? "border-[var(--color-accent)]"
          : "border-[var(--color-border)]",
      )}
      style={{
        backgroundImage: `${grad.bg}, linear-gradient(0deg, var(--color-bg), var(--color-bg))`,
        boxShadow: `inset 3px 0 0 0 hsl(${sim.hue}, 65%, 55%), 0 1px 2px rgba(0,0,0,0.12), 0 4px 14px rgba(0,0,0,0.10)`,
        animation: grad.pulse ? "relayHamletMoodPulse 2.4s ease-in-out infinite" : undefined,
        borderRadius: "var(--radius-md)",
      }}
    >
      <style>{DECOR_CSS}</style>
      <style>{PARTICLE_CSS}</style>
      <style>{HAMLET_AVATAR_CSS}</style>
      <div className="flex items-start gap-2.5 relative z-[1]">
        <div className="shrink-0 flex flex-col items-center relative">
          {accessories.crown && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -6,
                left: "50%",
                marginLeft: -7,
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
                marginLeft: -8,
                zIndex: 2,
              }}
            >
              <HatSvg kind={accessories.hat} />
            </span>
          )}
          <SimAvatar parts={parts} mood={sim.mood} accessories={accessories} />
          <AvatarBody agentKind={sim.sessionType} width={44} height={18} mood={sim.mood.key} />
          {accessories.badge && (
            <span
              className="mt-0.5 px-1 text-[8px] font-mono rounded border"
              style={{
                background: "var(--color-bg)",
                borderColor: "var(--color-border)",
                color: "var(--color-fg-muted)",
                lineHeight: 1.2,
              }}
              aria-hidden
            >
              {accessories.badge}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span
              className={cn(
                "text-[12px] font-mono truncate",
                selected ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]",
              )}
              title={sim.repo ?? "—"}
            >
              {sim.repo ?? "—"}
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: `hsl(${sim.hue}, 60%, 60%)` }}
            >
              {sim.sessionType[0]}
            </span>
            {sim.agentId && (
              <span className="text-[9.5px] font-mono text-[var(--color-fg-dim)] truncate">
                · {sim.agentId}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            <span
              className="inline-flex items-center gap-0.5 px-1 h-5 rounded-[var(--radius-sm)] text-[10px] font-mono border"
              style={{ borderColor: sim.mood.color, color: sim.mood.color }}
              title={`mood: ${sim.mood.label}`}
            >
              <span aria-hidden>{sim.mood.emoji}</span>
              <span>{sim.mood.label}</span>
            </span>
            <span
              className="inline-flex items-center gap-0.5 px-1 h-5 rounded-[var(--radius-sm)] text-[10px] font-mono border border-[var(--color-border)] text-[var(--color-fg-muted)]"
              title={`life-stage: ${sim.stage.label}`}
            >
              <span aria-hidden>{sim.stage.emoji}</span>
              <span>{sim.stage.label}</span>
            </span>
          </div>
        </div>
        {canOpen && (
          <button
            type="button"
            onClick={() =>
              onPickSession({ type: sim.sessionType, id: sim.sessionId })
            }
            aria-label="open as tile"
            className="text-[var(--color-fg-dim)] hover:text-[var(--color-accent)]"
          >
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}
      </div>

      {/* Status dot — top-right corner */}
      <span
        aria-hidden
        className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
        style={{ background: statusColor(sim.status) }}
      />

      {/* 8 needs grid — two columns of four. */}
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 mt-1">
        {NEED_ORDER.map((needKey) => {
          const need = sim.needs.find((n) => n.key === needKey);
          if (!need) return null;
          return (
            <NeedBar
              key={need.key}
              label={needLabel(need.key)}
              value={need.value}
            />
          );
        })}
      </div>

      {/* Skills strip — top 3, compact. Only renders when detail is wired in. */}
      {detail !== undefined && (
        <div className="mt-1">
          <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] mb-0.5">
            Skills
          </div>
          <SkillsPanel card={sim} detail={detail} variant="compact" limit={3} />
        </div>
      )}

      {/* Relations strip — top 3, compact. Only renders when peer list +
          tick are wired in (i.e. the Cards mode container). */}
      {allSims && now !== undefined && (
        <div className="mt-1">
          <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] mb-0.5">
            Relations
          </div>
          <RelationshipsPanel
            card={sim}
            allCards={allSims}
            now={now}
            variant="compact"
            limit={3}
            onEnterHouse={onEnterHouse}
          />
        </div>
      )}

      {onEnterHouse && (
        <button
          type="button"
          onClick={() => onEnterHouse(sim)}
          className="mt-1 inline-flex items-center justify-center gap-1 h-6 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]"
          aria-label="enter house plan"
        >
          <DoorOpen className="w-3 h-3" aria-hidden />
          Enter House
        </button>
      )}
    </li>
  );
}

function NeedBar({ label, value }: { label: string; value: number }) {
  const color = needColor(value);
  // Glow when extreme (≤25 red, ≥80 green) — a subtle indicator.
  const glow = value <= 25 || value >= 80;
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="text-[9.5px] font-mono uppercase tracking-wide text-[var(--color-fg-dim)] w-[52px] shrink-0 leading-none"
        title={`${label}: ${value}`}
      >
        {label.slice(0, 4)}
      </span>
      <span
        aria-hidden
        className="relative flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--color-border)]/40"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${value}%`,
            background: color,
            boxShadow: glow ? `0 0 4px ${color}` : undefined,
          }}
        />
      </span>
      <span className="text-[9.5px] font-mono tabular text-[var(--color-fg-muted)] w-[20px] text-right leading-none">
        {value}
      </span>
    </div>
  );
}

// Refined avatar head: egg-shaped face, 6 hair styles, ears, cheek blush,
// mood-driven eyes / mouth / brows, idle blink, sweat / Zzz overlays. The
// face is centered in a 48×48 box. Body is rendered separately by the
// caller via AvatarBody.
function SimAvatar({
  parts,
  mood,
  accessories,
}: {
  parts: AvatarParts;
  mood: SimCardModel["mood"];
  accessories?: {
    glasses: import("../_lib/fleet-hamlet-particles").GlassesKind;
    mustache: import("../_lib/fleet-hamlet-particles").MustacheKind;
    beard: import("../_lib/fleet-hamlet-particles").BeardKind;
    earring: import("../_lib/fleet-hamlet-particles").EarringKind;
  };
}) {
  const expression = useMemo(() => getExpressionForMood(mood.key), [mood.key]);
  return (
    <svg
      width={48}
      height={48}
      viewBox="0 0 48 48"
      aria-hidden
      className="shrink-0"
      overflow="visible"
    >
      <g
        transform={`translate(24, 26) rotate(${expression.leanDeg})`}
        style={{
          animation: `relayHamletIdleBreathe 4s ease-in-out ${parts.breatheDelay}s infinite`,
          transformOrigin: "24px 26px",
        }}
      >
        <HeadFace
          parts={parts}
          expression={expression}
          radius={14}
          haloColor={mood.color}
          glasses={accessories?.glasses}
          mustache={accessories?.mustache}
          beard={accessories?.beard}
          earring={accessories?.earring}
        />
      </g>
    </svg>
  );
}
