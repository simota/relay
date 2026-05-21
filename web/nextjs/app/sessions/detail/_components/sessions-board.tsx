"use client";

import { LayoutGrid, Minimize2, Maximize2, Radar } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionType } from "@/lib/api";
import { c } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { MAX_TILES } from "../_constants";
import { sessionKey } from "../_lib/fleet-timeline";
import { buildDetailUrl, parseTileSpecs } from "../_lib/url";
import type { TileSpec } from "../_types";
import { FleetView, type FleetSubview } from "./fleet-view";
// Re-export the Hamlet mode parser so external code (e.g. router-aware
// links) can resolve the current Hamlet sub-mode without reaching into
// the Fleet view tree.
export { parseHamletMode, type HamletMode } from "./fleet-hamlet";
import { SessionTile } from "./session-tile";

type TopView = "board" | "fleet";

function parseTopView(params: URLSearchParams): TopView {
  return params.get("view") === "fleet" ? "fleet" : "board";
}

function parseFleetSubview(params: URLSearchParams): FleetSubview {
  const v = params.get("fv");
  if (v === "pulse") return "pulse";
  if (v === "cosmos") return "cosmos";
  if (v === "hamlet") return "hamlet";
  return "feed";
}

// User-controlled compact toggle: maximizes the message list area by shrinking
// the per-tile header, metadata, ribbon, and chrome. Tri-state preference:
//   null  → no explicit user choice; fall back to "auto-compact when tileCount
//           >= 4" so the 5–6 tile (3×2) board renders compact by default.
//   true  → user explicitly opted in.
//   false → user explicitly opted out (overrides the auto-compact threshold).
// Persisted in localStorage only after a toggle interaction so we can tell
// "never touched" from "explicitly off".
const COMPACT_STORAGE_KEY = "relay.sessions.detail.compact";

function readCompactPref(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(COMPACT_STORAGE_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writeCompactPref(v: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMPACT_STORAGE_KEY, v ? "1" : "0");
  } catch {
    // localStorage may be disabled (Safari private mode etc.). Falling
    // through is fine — the toggle still works for this session.
  }
}

// Tile count at which the board flips to a 3×2 grid; each tile loses ~half
// of its width and the per-tile chrome (header, metadata, ribbon) starts to
// wrap onto a second row. Treat this as the auto-compact threshold so users
// land on a tight layout by default for those grids.
const AUTO_COMPACT_TILE_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// SessionsBoard — URL parsing, tile list management, layout
// ---------------------------------------------------------------------------
export function SessionsBoard() {
  const params = useSearchParams();
  const router = useRouter();

  const specs = useMemo(() => parseTileSpecs(params), [params]);

  const removeTile = useCallback(
    (index: number) => {
      const next = specs.filter((_, i) => i !== index);
      router.replace(buildDetailUrl(next));
    },
    [specs, router],
  );

  const replaceTile = useCallback(
    (index: number, newSpec: TileSpec) => {
      const next = specs.map((s, i) => (i === index ? newSpec : s));
      router.push(buildDetailUrl(next));
    },
    [specs, router],
  );

  const addSubagents = useCallback(
    (agentIds: string[], type: SessionType) => {
      const currentCount = specs.length;
      const canAdd = MAX_TILES - currentCount;
      if (canAdd <= 0) return;
      const toAdd = agentIds.slice(0, canAdd);
      if (agentIds.length > canAdd) {
        console.warn(
          `[relay] sessions/detail: ${agentIds.length} subagents to add, only ${canAdd} tile slots remain; truncating`,
        );
      }
      const newSpecs: TileSpec[] = toAdd.map((id) => ({ type, id }));
      router.push(buildDetailUrl([...specs, ...newSpecs]));
    },
    [specs, router],
  );

  // Fleet strip click: open the picked session as a tile. No-op when it's
  // already open (keeps the strip a navigator, not a toggler — closing tiles
  // stays on the existing × button to avoid accidental loss of state).
  const pickFromFleet = useCallback(
    (spec: TileSpec) => {
      const key = `${spec.type}:${spec.id}`;
      if (specs.some((s) => `${s.type}:${s.id}` === key)) return;
      if (specs.length >= MAX_TILES) return;
      router.push(buildDetailUrl([...specs, spec]));
    },
    [specs, router],
  );

  const selectedKeys = useMemo(
    () => new Set(specs.map((s) => sessionKey(s))),
    [specs],
  );

  const tileCount = specs.length;

  // Grid class depending on tile count.
  // 4 tiles → 2×2, 5-6 tiles → 3×2 (avoid 2×3 vertical stacks on `lg` screens).
  // `auto-rows-fr` keeps row heights equal so the bottom row doesn't collapse.
  const gridClass = (() => {
    if (tileCount <= 1) return "";
    if (tileCount === 2) return "grid lg:grid-cols-2 gap-3 auto-rows-fr";
    if (tileCount === 3) return "grid lg:grid-cols-3 md:grid-cols-2 gap-3 auto-rows-fr";
    if (tileCount === 4) return "grid lg:grid-cols-2 md:grid-cols-2 gap-3 auto-rows-fr";
    return "grid lg:grid-cols-3 md:grid-cols-2 gap-3 auto-rows-fr";
  })();

  const topView = parseTopView(params);
  const fleetSubview = parseFleetSubview(params);

  // compactPref = user's explicit preference (null = never touched). SSR-safe:
  // starts null on first render, then hydrates from localStorage on mount so
  // the server and first client paint match.
  const [compactPref, setCompactPref] = useState<boolean | null>(null);
  useEffect(() => {
    setCompactPref(readCompactPref());
  }, []);
  // effectiveCompact resolves the tri-state: explicit user choice wins;
  // otherwise auto-compact when the board would render a 3×2 grid.
  const effectiveCompact =
    compactPref ?? tileCount >= AUTO_COMPACT_TILE_THRESHOLD;
  const toggleCompact = useCallback(() => {
    // Flip relative to the *displayed* state so the click always inverts
    // what the user sees, regardless of whether that came from auto or pref.
    const next = !effectiveCompact;
    setCompactPref(next);
    writeCompactPref(next);
  }, [effectiveCompact]);

  const goTopView = useCallback(
    (v: TopView) => {
      const next = new URLSearchParams(params.toString());
      if (v === "board") {
        next.delete("view");
        next.delete("fv");
      } else {
        next.set("view", "fleet");
        if (!next.get("fv")) next.set("fv", "feed");
      }
      router.push(`/sessions/detail?${next.toString()}`);
    },
    [params, router],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar — Board / Fleet switcher always visible. */}
      <div className="flex-shrink-0 px-6 pt-4 pb-2 flex items-center gap-3 border-b border-[var(--color-border)]">
        <Link
          href="/sessions"
          className="text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          {c("sessions.detail.backToList")}
        </Link>
        <span className="text-[var(--color-fg-dim)] text-[12px]">·</span>
        <div className="flex items-center gap-1">
          <TopTab
            active={topView === "board"}
            onClick={() => goTopView("board")}
            icon={LayoutGrid}
            label="Board"
          />
          <TopTab
            active={topView === "fleet"}
            onClick={() => goTopView("fleet")}
            icon={Radar}
            label="Fleet"
          />
        </div>
        {topView === "board" && (
          <>
            <span className="text-[var(--color-fg-dim)] text-[12px]">·</span>
            <Link
              href="/sessions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              + Add from list ↗
            </Link>
          </>
        )}
        {topView === "board" && (
          <button
            type="button"
            onClick={toggleCompact}
            aria-pressed={effectiveCompact}
            title={
              effectiveCompact
                ? "expand tile chrome (show full header / metadata)"
                : "collapse tile chrome to maximize messages"
            }
            className={cn(
              "ml-auto inline-flex items-center gap-1 px-2 h-6 rounded-[var(--radius-sm)] border text-[11px] font-mono transition-colors",
              effectiveCompact
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
            )}
          >
            {effectiveCompact ? (
              <Maximize2 className="w-3 h-3" aria-hidden />
            ) : (
              <Minimize2 className="w-3 h-3" aria-hidden />
            )}
            <span>{effectiveCompact ? "compact" : "compact off"}</span>
          </button>
        )}
        {topView === "board" && tileCount > 0 && (
          <span className="text-[11px] font-mono text-[var(--color-fg-dim)]">
            {tileCount} tile{tileCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {topView === "fleet" && (
        <div className="flex-1 min-h-0">
          <FleetView
            subview={fleetSubview}
            selectedKeys={selectedKeys}
            onPickSession={pickFromFleet}
            canAdd={tileCount < MAX_TILES}
          />
        </div>
      )}

      {topView === "board" && (
        <BoardArea
          specs={specs}
          tileCount={tileCount}
          gridClass={gridClass}
          forceCompact={effectiveCompact}
          removeTile={removeTile}
          replaceTile={replaceTile}
          addSubagents={addSubagents}
        />
      )}
    </div>
  );
}

interface BoardAreaProps {
  specs: TileSpec[];
  tileCount: number;
  gridClass: string;
  forceCompact: boolean;
  removeTile: (index: number) => void;
  replaceTile: (index: number, spec: TileSpec) => void;
  addSubagents: (agentIds: string[], type: SessionType) => void;
}

function BoardArea({
  specs,
  tileCount,
  gridClass,
  forceCompact,
  removeTile,
  replaceTile,
  addSubagents,
}: BoardAreaProps) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden p-3">
      {tileCount === 0 && (
        <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
          <p className="text-[13px] text-[var(--color-fg-dim)]">
            {c("sessions.detail.notFound")}
          </p>
          <Link
            href="/sessions"
            className="text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] underline"
          >
            {c("sessions.detail.backToList")}
          </Link>
        </div>
      )}

      {tileCount === 1 && specs[0] && (
        <div className="h-full overflow-hidden">
          <SessionTile
            key={`${specs[0].type}:${specs[0].id}`}
            type={specs[0].type}
            id={specs[0].id}
            tileIndex={0}
            onClose={removeTile.bind(null, 0)}
            showClose={false}
            onReplaceTile={replaceTile}
            onAddSubagents={addSubagents}
            currentTileCount={tileCount}
            forceCompact={forceCompact}
          />
        </div>
      )}

      {tileCount > 1 && (
        <div className={cn(gridClass, "h-full")}>
          {specs.map((spec, i) => (
            <div
              key={`${spec.type}:${spec.id}`}
              className="min-h-0 overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]"
            >
              <SessionTile
                type={spec.type}
                id={spec.id}
                tileIndex={i}
                onClose={removeTile.bind(null, i)}
                showClose
                onReplaceTile={replaceTile}
                onAddSubagents={addSubagents}
                currentTileCount={tileCount}
                forceCompact={forceCompact}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 px-2 h-7 rounded-[var(--radius-sm)] border text-[12px] font-mono",
        active
          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {label}
    </button>
  );
}

