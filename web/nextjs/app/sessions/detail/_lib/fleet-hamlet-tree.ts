// Hamlet — Family Tree layout.
//
// Per-repo cluster, tidy-ish tree. Nodes are placed deterministically:
//   - Repos sorted by hash for stable cluster ordering.
//   - Within a cluster, sessions with no parent (or whose parent isn't in
//     the same cluster) form generation 0; children fan out below them.
//   - Sibling spread is proportional to subtree leaf count so subtrees
//     don't overlap visually.
//
// Pure geometry — caller turns the result into SVG/HTML.

import type { SimCardModel } from "./fleet-hamlet";
import { hashStringToInt } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FamilyClusterNode {
  card: SimCardModel;
  /** 0 = root row, increments per spawn level. */
  generation: number;
  /** X center within the cluster (px). */
  x: number;
  /** Y center within the cluster (px). */
  y: number;
  children: string[];
}

export interface FamilyCluster {
  /** Repo name or "—" for no-repo cluster. */
  repo: string;
  /** Stable id used in React keys. */
  id: string;
  nodes: FamilyClusterNode[];
  width: number;
  height: number;
  /** Cluster-level color hint (matches Neighborhood roof hue). */
  hue: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const NODE_W = 80;
const NODE_H = 88;
const H_GAP = 28; // horizontal gap between sibling subtrees
const V_GAP = 64; // vertical gap between generations
const CLUSTER_PAD_X = 24;
const CLUSTER_PAD_Y = 32;

export const TREE_LAYOUT = {
  nodeW: NODE_W,
  nodeH: NODE_H,
  hGap: H_GAP,
  vGap: V_GAP,
  padX: CLUSTER_PAD_X,
  padY: CLUSTER_PAD_Y,
} as const;

// ---------------------------------------------------------------------------
// Build clusters
// ---------------------------------------------------------------------------

export function buildFamilyClusters(
  cards: readonly SimCardModel[],
): FamilyCluster[] {
  // 1. Group by repo (null → "—").
  const groups = new Map<string, SimCardModel[]>();
  for (const c of cards) {
    const repo = c.repo ?? "—";
    const arr = groups.get(repo);
    if (arr) arr.push(c);
    else groups.set(repo, [c]);
  }

  const clusters: FamilyCluster[] = [];
  for (const [repo, members] of groups) {
    clusters.push(buildCluster(repo, members));
  }
  // Stable cluster order: hash of repo name.
  clusters.sort((a, b) => hashStringToInt(a.repo) - hashStringToInt(b.repo));
  return clusters;
}

function buildCluster(repo: string, members: readonly SimCardModel[]): FamilyCluster {
  // Build local children index — only edges where the parent lives in this
  // cluster count, otherwise the child becomes a generation-0 root.
  const localIds = new Set(members.map((m) => m.sessionId));
  const childrenOf = new Map<string, SimCardModel[]>();
  const parentOf = new Map<string, string | null>();
  for (const m of members) {
    const p = m.parentSessionId && localIds.has(m.parentSessionId)
      ? m.parentSessionId
      : null;
    parentOf.set(m.sessionId, p);
    if (p) {
      const arr = childrenOf.get(p);
      if (arr) arr.push(m);
      else childrenOf.set(p, [m]);
    }
  }
  // Sort children deterministically (by hash) so the same tree always lays out
  // identically across renders.
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => hashStringToInt(a.key) - hashStringToInt(b.key));
  }

  // Roots = members with no in-cluster parent.
  const roots = members
    .filter((m) => parentOf.get(m.sessionId) === null)
    .sort((a, b) => hashStringToInt(a.key) - hashStringToInt(b.key));

  // 2. Tidy-ish layout: assign each subtree a width in "leaf units", then walk
  // depth-first to place each node at the center of its allotted span.
  const subtreeLeaves = new Map<string, number>();
  function countLeaves(id: string): number {
    const memo = subtreeLeaves.get(id);
    if (memo !== undefined) return memo;
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      subtreeLeaves.set(id, 1);
      return 1;
    }
    let n = 0;
    for (const k of kids) n += countLeaves(k.sessionId);
    subtreeLeaves.set(id, n);
    return n;
  }
  for (const r of roots) countLeaves(r.sessionId);

  // Place every root left-to-right at gen 0, then recurse.
  const nodes = new Map<string, FamilyClusterNode>();
  let cursorX = CLUSTER_PAD_X;

  function placeSubtree(
    cardId: string,
    gen: number,
    startX: number,
  ): { node: FamilyClusterNode; widthPx: number } {
    const card = members.find((m) => m.sessionId === cardId);
    if (!card) {
      // Defensive — shouldn't happen because cardId came from members.
      const blank: FamilyClusterNode = {
        card: members[0] as SimCardModel,
        generation: gen,
        x: startX,
        y: gen * (NODE_H + V_GAP) + CLUSTER_PAD_Y + NODE_H / 2,
        children: [],
      };
      return { node: blank, widthPx: NODE_W };
    }
    const kids = childrenOf.get(cardId) ?? [];
    const y = gen * (NODE_H + V_GAP) + CLUSTER_PAD_Y + NODE_H / 2;
    if (kids.length === 0) {
      const node: FamilyClusterNode = {
        card,
        generation: gen,
        x: startX + NODE_W / 2,
        y,
        children: [],
      };
      nodes.set(card.sessionId, node);
      return { node, widthPx: NODE_W };
    }
    let childX = startX;
    const childNodes: FamilyClusterNode[] = [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (!k) continue;
      const { node, widthPx } = placeSubtree(k.sessionId, gen + 1, childX);
      childNodes.push(node);
      childX += widthPx;
      if (i < kids.length - 1) childX += H_GAP;
    }
    const totalW = childX - startX;
    const first = childNodes[0];
    const last = childNodes[childNodes.length - 1];
    const centerX = first && last ? (first.x + last.x) / 2 : startX + NODE_W / 2;
    const node: FamilyClusterNode = {
      card,
      generation: gen,
      x: centerX,
      y,
      children: kids.map((k) => k.sessionId),
    };
    nodes.set(card.sessionId, node);
    return { node, widthPx: Math.max(totalW, NODE_W) };
  }

  let maxGen = 0;
  for (const r of roots) {
    const { widthPx } = placeSubtree(r.sessionId, 0, cursorX);
    cursorX += widthPx + H_GAP;
  }
  for (const n of nodes.values()) {
    if (n.generation > maxGen) maxGen = n.generation;
  }
  const width = Math.max(cursorX - H_GAP + CLUSTER_PAD_X, NODE_W + CLUSTER_PAD_X * 2);
  const height = (maxGen + 1) * NODE_H + maxGen * V_GAP + CLUSTER_PAD_Y * 2;

  // Cluster hue — same logic as Neighborhood roof color but inlined to avoid
  // a dependency cycle.
  const hue =
    repo === "—" ? 210 : hashStringToInt(repo) % 360;

  return {
    repo,
    id: `cluster:${repo}`,
    nodes: [...nodes.values()],
    width,
    height,
    hue,
  };
}
