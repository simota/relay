"use client";

import { LayoutGrid, Radar } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { SessionType } from "@/lib/api";
import { c } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { MAX_TILES } from "../_constants";
import { sessionKey } from "../_lib/fleet-timeline";
import { buildDetailUrl, parseTileSpecs } from "../_lib/url";
import type { TileSpec } from "../_types";
import { FleetView, type FleetSubview } from "./fleet-view";
import { SessionTile } from "./session-tile";

type TopView = "board" | "fleet";

function parseTopView(params: URLSearchParams): TopView {
  return params.get("view") === "fleet" ? "fleet" : "board";
}

function parseFleetSubview(params: URLSearchParams): FleetSubview {
  const v = params.get("fv");
  if (v === "pulse") return "pulse";
  if (v === "cosmos") return "cosmos";
  return "feed";
}

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
        {topView === "board" && tileCount > 0 && (
          <span className="ml-auto text-[11px] font-mono text-[var(--color-fg-dim)]">
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
  removeTile: (index: number) => void;
  replaceTile: (index: number, spec: TileSpec) => void;
  addSubagents: (agentIds: string[], type: SessionType) => void;
}

function BoardArea({
  specs,
  tileCount,
  gridClass,
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

