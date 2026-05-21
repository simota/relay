"use client";

// Fleet Hamlet — Family Tree mode (P4).
//
// Sims-style per-repo "family" clusters. Each cluster is its own tidy tree;
// clusters tile vertically with a dashed separator between them. Lines:
//   - solid: parent → child
//   - dashed: sibling pairs (same parent, drawn between adjacent siblings)
//   - background bands handle housemate/rival (omitted here — see Cards mode
//     for the per-row relationship rollup).

import { DoorOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import {
  agentHueShift,
} from "../_lib/fleet-hamlet-layout";
import {
  buildFamilyClusters,
  type FamilyCluster,
  type FamilyClusterNode,
  TREE_LAYOUT,
} from "../_lib/fleet-hamlet-tree";

const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

type FilterMode = "all" | "active";

interface Props {
  sims: readonly SimCardModel[];
  now: number;
  onEnterHouse: (sim: SimCardModel) => void;
}

export function FleetHamletRelations({ sims, now, onEnterHouse }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const filtered = useMemo<SimCardModel[]>(() => {
    if (filter === "all") return [...sims];
    return sims.filter((s) => now - s.lastActiveAt <= ACTIVE_WINDOW_MS);
  }, [sims, filter, now]);

  const clusters = useMemo(
    () => buildFamilyClusters(filtered),
    [filtered],
  );

  const totalRelationships = useMemo(() => {
    let n = 0;
    for (const c of clusters) {
      for (const node of c.nodes) n += node.children.length;
    }
    return n;
  }, [clusters]);
  const totalGenerations = useMemo(() => {
    let g = 0;
    for (const c of clusters) {
      for (const node of c.nodes) if (node.generation > g) g = node.generation;
    }
    return g + 1;
  }, [clusters]);

  const openSim = useMemo(
    () => sims.find((s) => s.key === openKey) ?? null,
    [sims, openKey],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* HUD */}
      <div className="sticky top-0 z-20 px-6 py-2 flex items-center gap-3 text-[11px] font-mono bg-[var(--color-bg)]/95 backdrop-blur border-b border-[var(--color-border)]">
        <span>
          <span aria-hidden>🌳</span>{" "}
          <span className="text-[var(--color-fg-muted)]">{clusters.length}</span>{" "}
          families
        </span>
        <span className="text-[var(--color-fg-dim)]">·</span>
        <span>
          <span aria-hidden>↕</span>{" "}
          <span className="text-[var(--color-fg-muted)]">{totalGenerations}</span>{" "}
          generations
        </span>
        <span className="text-[var(--color-fg-dim)]">·</span>
        <span>
          <span aria-hidden>🔗</span>{" "}
          <span className="text-[var(--color-fg-muted)]">{totalRelationships}</span>{" "}
          parent-child edges
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <FilterButton
            label="All"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterButton
            label="Active 1h"
            active={filter === "active"}
            onClick={() => setFilter("active")}
          />
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 flex flex-col gap-4">
        {clusters.length === 0 && (
          <div className="text-[12px] font-mono text-[var(--color-fg-dim)]">
            no residents match the current filter.
          </div>
        )}
        {clusters.map((cluster) => (
          <ClusterBlock
            key={cluster.id}
            cluster={cluster}
            now={now}
            openKey={openKey}
            onPickNode={(card) =>
              setOpenKey((prev) => (prev === card.key ? null : card.key))
            }
            onEnterHouse={onEnterHouse}
          />
        ))}
      </div>

      {/* Tiny side rail — last clicked node summary. Kept small so the tree
          stays the focus. */}
      {openSim && (
        <div className="shrink-0 px-6 py-2 border-t border-[var(--color-border)] flex items-center gap-3 text-[11px] font-mono bg-[var(--color-bg)]/95">
          <span className="text-[var(--color-fg-dim)]">selected:</span>
          <span className="text-[var(--color-fg)] truncate">
            {openSim.sessionType[0]}/{openSim.repo ?? "—"}
          </span>
          <span style={{ color: openSim.mood.color }} className="shrink-0">
            {openSim.mood.emoji} {openSim.mood.label}
          </span>
          <span className="shrink-0 text-[var(--color-fg-muted)]">
            {openSim.stage.emoji} {openSim.stage.label}
          </span>
          <button
            type="button"
            onClick={() => onEnterHouse(openSim)}
            className="ml-auto inline-flex items-center gap-1 px-2 h-6 rounded-[var(--radius-sm)] border border-[var(--color-accent)] text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
          >
            <DoorOpen className="w-3 h-3" aria-hidden />
            Enter House
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cluster — one repo's family tree
// ---------------------------------------------------------------------------

function ClusterBlock({
  cluster,
  now,
  openKey,
  onPickNode,
  onEnterHouse,
}: {
  cluster: FamilyCluster;
  now: number;
  openKey: string | null;
  onPickNode: (card: SimCardModel) => void;
  onEnterHouse: (card: SimCardModel) => void;
}) {
  const nodeById = useMemo(() => {
    const m = new Map<string, FamilyClusterNode>();
    for (const n of cluster.nodes) m.set(n.card.sessionId, n);
    return m;
  }, [cluster]);

  // Edges from the laid-out nodes — parent → each child.
  const edges = useMemo(() => {
    type Edge = { id: string; from: FamilyClusterNode; to: FamilyClusterNode };
    const out: Edge[] = [];
    for (const n of cluster.nodes) {
      for (const childId of n.children) {
        const child = nodeById.get(childId);
        if (!child) continue;
        out.push({ id: `${n.card.key}->${child.card.key}`, from: n, to: child });
      }
    }
    return out;
  }, [cluster, nodeById]);

  // Sibling pairs — for each parent with ≥2 children, connect adjacent siblings
  // with a dashed line at the child's vertical level.
  const siblingPairs = useMemo(() => {
    type Pair = { id: string; a: FamilyClusterNode; b: FamilyClusterNode };
    const out: Pair[] = [];
    for (const n of cluster.nodes) {
      if (n.children.length < 2) continue;
      const kids = n.children
        .map((id) => nodeById.get(id))
        .filter((x): x is FamilyClusterNode => x !== undefined)
        .sort((a, b) => a.x - b.x);
      for (let i = 0; i < kids.length - 1; i++) {
        const a = kids[i];
        const b = kids[i + 1];
        if (!a || !b) continue;
        out.push({ id: `${a.card.key}~${b.card.key}`, a, b });
      }
    }
    return out;
  }, [cluster, nodeById]);

  return (
    <section
      className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg)]"
      aria-label={`family cluster ${cluster.repo}`}
    >
      <header className="flex items-baseline gap-2 px-3 py-1.5 border-b border-dashed border-[var(--color-border)]">
        <span
          aria-hidden
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: `hsl(${cluster.hue}, 55%, 50%)` }}
        />
        <h3 className="text-[12px] font-mono text-[var(--color-fg)] truncate">
          {cluster.repo}
        </h3>
        <span className="text-[10px] font-mono text-[var(--color-fg-dim)]">
          {cluster.nodes.length} {cluster.nodes.length === 1 ? "resident" : "residents"}
        </span>
      </header>
      <div
        className="relative mx-auto"
        style={{ width: cluster.width, height: cluster.height }}
      >
        <svg
          className="absolute inset-0 pointer-events-none"
          width={cluster.width}
          height={cluster.height}
          viewBox={`0 0 ${cluster.width} ${cluster.height}`}
          aria-hidden
        >
          {/* Parent → child solid edges */}
          {edges.map((e) => (
            <path
              key={e.id}
              d={parentChildPath(e.from, e.to)}
              fill="none"
              stroke="var(--color-fg-dim)"
              strokeWidth={1.25}
              opacity={0.85}
            />
          ))}
          {/* Sibling dashed connectors */}
          {siblingPairs.map((p) => (
            <line
              key={p.id}
              x1={p.a.x}
              y1={p.a.y}
              x2={p.b.x}
              y2={p.b.y}
              stroke="var(--color-fg-dim)"
              strokeWidth={0.75}
              strokeDasharray="2 4"
              opacity={0.55}
            />
          ))}
        </svg>
        {cluster.nodes.map((n) => (
          <TreeNode
            key={n.card.key}
            node={n}
            cluster={cluster}
            now={now}
            selected={openKey === n.card.key}
            onClick={() => onPickNode(n.card)}
            onDoubleClick={() => onEnterHouse(n.card)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tree node — small house glyph + mood + life-stage
// ---------------------------------------------------------------------------

function TreeNode({
  node,
  cluster,
  now,
  selected,
  onClick,
  onDoubleClick,
}: {
  node: FamilyClusterNode;
  cluster: FamilyCluster;
  now: number;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const w = TREE_LAYOUT.nodeW;
  const h = TREE_LAYOUT.nodeH;
  const left = node.x - w / 2;
  const top = node.y - h / 2;

  const wallHue = (cluster.hue + agentHueShift(node.card.sessionType) + 360) % 360;
  const isRecent = now - node.card.lastActiveAt <= ACTIVE_WINDOW_MS;
  const dim = !isRecent;

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ left, top, width: w, height: h }}
      title={`${node.card.sessionType}/${node.card.repo ?? "—"} · gen ${node.generation} · ${node.card.mood.label} · double-click to enter`}
      aria-pressed={selected}
      className={cn(
        "absolute flex flex-col items-center justify-end gap-0.5 p-0 bg-transparent cursor-pointer",
        "transition-transform duration-150 ease-out",
        "hover:-translate-y-0.5",
        selected && "-translate-y-0.5",
        dim && "opacity-65 hover:opacity-100",
      )}
    >
      <div className="flex items-center gap-1 text-[14px] leading-none">
        <span aria-hidden style={{ color: node.card.mood.color }}>
          {node.card.mood.emoji}
        </span>
        <span aria-hidden className="text-[12px]">
          {node.card.stage.emoji}
        </span>
      </div>
      <MiniHouseSvg roofHue={cluster.hue} wallHue={wallHue} highlight={selected} />
      <div
        className={cn(
          "max-w-full px-0.5 text-[9.5px] font-mono truncate text-center",
          selected ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]",
        )}
      >
        {node.card.sessionType[0]}/{(node.card.agentId ?? node.card.sessionId).slice(0, 6)}
      </div>
    </button>
  );
}

function MiniHouseSvg({
  roofHue,
  wallHue,
  highlight,
}: {
  roofHue: number;
  wallHue: number;
  highlight: boolean;
}) {
  // Soft halo behind the mini-house so per-repo colors read at a glance.
  return (
    <svg
      width={40}
      height={36}
      viewBox="0 0 40 36"
      aria-hidden
      style={{
        filter: highlight
          ? `drop-shadow(0 2px 3px rgba(0,0,0,0.25)) drop-shadow(0 0 4px hsla(${roofHue}, 65%, 60%, 0.55))`
          : `drop-shadow(0 0 3px hsla(${roofHue}, 65%, 60%, 0.28))`,
      }}
    >
      <circle cx="20" cy="20" r="17" fill={`hsla(${roofHue}, 65%, 60%, 0.10)`} />
      <polygon points="5,20 20,8 35,20" fill={`hsl(${roofHue}, 55%, 45%)`} />
      <rect x="8" y="19" width="24" height="15" fill={`hsl(${wallHue}, 30%, 65%)`} />
      <rect x="17" y="24" width="6" height="10" fill="hsl(25, 35%, 25%)" rx={0.5} />
      <rect x="10" y="22" width="4" height="4" fill="hsl(220, 60%, 65%)" />
      <rect x="26" y="22" width="4" height="4" fill="hsl(220, 60%, 65%)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SVG path: parent center → child center via a step bend so multiple
// children fan out cleanly under the parent.
// ---------------------------------------------------------------------------

function parentChildPath(
  from: FamilyClusterNode,
  to: FamilyClusterNode,
): string {
  const fx = from.x;
  const fy = from.y + TREE_LAYOUT.nodeH / 2; // bottom of parent
  const tx = to.x;
  const ty = to.y - TREE_LAYOUT.nodeH / 2; // top of child
  const midY = (fy + ty) / 2;
  return `M ${fx} ${fy} L ${fx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
}

// ---------------------------------------------------------------------------
// Filter pill
// ---------------------------------------------------------------------------

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 h-5 rounded-[var(--radius-sm)] border text-[10px] font-mono",
        active
          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
      )}
    >
      {label}
    </button>
  );
}
