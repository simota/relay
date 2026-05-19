import type { SessionSummary, SessionToolCall } from "@/lib/api";
import { parseTaskCreateArgs } from "./tool-args";

export interface SpawnNode {
  ts: number;
  subagent: string | null;
  description: string | null;
  childId: string | null;
}

export interface SubagentDagModel {
  parentId: string;
  spawnNodes: SpawnNode[];
  children: SessionSummary[];
  /** Children that had no matching TaskCreate (still rendered as orphans). */
  unmatchedChildren: SessionSummary[];
}

function tsMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Pair TaskCreate tool invocations with the actual child sessions that the
 * adapter recorded. The matching is best-effort:
 *   1. Sort children by started_at ascending.
 *   2. Sort TaskCreate calls by timestamp ascending.
 *   3. Walk in lock-step by index; this catches the common case where the
 *      child id from the spawn equals the i-th child in start order.
 *   4. After the index pass, re-match leftovers by `subagent` ~ `agent_id`
 *      so renamed/renumbered children still snap to their spawn record.
 *   5. Anything still unpaired stays as either a description-only spawn
 *      node or an orphan child.
 */
export function computeSubagentDag(
  parentId: string,
  toolCalls: SessionToolCall[],
  children: SessionSummary[],
): SubagentDagModel {
  const spawns: SpawnNode[] = [];
  for (const tc of toolCalls) {
    if (tc.name !== "TaskCreate") continue;
    const ts = tsMs(tc.timestamp);
    if (ts === undefined) continue;
    const parsed = parseTaskCreateArgs(tc.args_json);
    spawns.push({
      ts,
      subagent: parsed?.subagent ?? null,
      description: parsed?.description ?? null,
      childId: null,
    });
  }
  spawns.sort((a, b) => a.ts - b.ts);

  const orderedChildren = children
    .slice()
    .sort(
      (a, b) =>
        (tsMs(a.started_at) ?? 0) - (tsMs(b.started_at) ?? 0),
    );

  const matchedChildIds = new Set<string>();

  // Pass 1: positional pairing.
  const n = Math.min(spawns.length, orderedChildren.length);
  for (let i = 0; i < n; i++) {
    const c = orderedChildren[i];
    const s = spawns[i];
    if (!c || !s) continue;
    s.childId = c.id;
    matchedChildIds.add(c.id);
  }

  // Pass 2: re-match unmatched spawns by subagent name → child.agent_id.
  for (const s of spawns) {
    if (s.childId) continue;
    if (!s.subagent) continue;
    const want = s.subagent.toLowerCase();
    const match = orderedChildren.find(
      (c) =>
        !matchedChildIds.has(c.id) &&
        (c.agent_id ?? "").toLowerCase().includes(want),
    );
    if (match) {
      s.childId = match.id;
      matchedChildIds.add(match.id);
    }
  }

  const unmatchedChildren = orderedChildren.filter(
    (c) => !matchedChildIds.has(c.id),
  );

  return {
    parentId,
    spawnNodes: spawns,
    children: orderedChildren,
    unmatchedChildren,
  };
}
