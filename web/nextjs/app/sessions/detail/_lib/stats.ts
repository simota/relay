import type { SessionMessage, SessionTodo, SessionToolCall } from "@/lib/api";

export interface TodoStats {
  completed: number;
  in_progress: number;
  pending: number;
  total: number;
  percent: number;
}

/**
 * Aggregate todo entries into completion buckets.
 *
 * `percent` is the completed fraction expressed 0..100. Unknown status
 * values are counted toward `pending` so the three buckets always sum to
 * `total`.
 *
 * #TODO(agent): burndown when history available — the DB currently keeps
 * only the latest snapshot, so a per-tick chart isn't computable yet.
 */
export function computeTodoStats(todos: SessionTodo[]): TodoStats {
  const acc: TodoStats = {
    completed: 0,
    in_progress: 0,
    pending: 0,
    total: todos.length,
    percent: 0,
  };
  for (const t of todos) {
    if (t.status === "completed") acc.completed++;
    else if (t.status === "in_progress") acc.in_progress++;
    else acc.pending++;
  }
  acc.percent = acc.total > 0 ? (acc.completed / acc.total) * 100 : 0;
  return acc;
}

export function computeStats(
  messages: SessionMessage[],
): { user: number; assistant: number; tool: number; system: number } {
  const acc = { user: 0, assistant: 0, tool: 0, system: 0 };
  for (const m of messages) {
    if (m.role in acc) acc[m.role as keyof typeof acc]++;
  }
  return acc;
}

export interface ToolStat {
  name: string;
  count: number;
  pct: number;
}

// Top-N tool buckets surfaced as their own slices in the pie; remaining
// names are folded into a single "other" slice so the donut stays legible.
const TOP_N = 6;
const OTHER_LABEL = "other";

/**
 * Aggregate tool_calls into ranked frequency buckets.
 *
 * Returns up to TOP_N + 1 entries (the trailing entry is the rolled-up
 * "other" slice when more than TOP_N distinct tools appear). All `pct`
 * values are 0..100 and sum to 100 when at least one call exists.
 */
export function computeToolStats(toolCalls: SessionToolCall[]): ToolStat[] {
  if (toolCalls.length === 0) return [];
  const counts = new Map<string, number>();
  for (const tc of toolCalls) {
    counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1);
  }
  const sorted = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const head = sorted.slice(0, TOP_N);
  const tail = sorted.slice(TOP_N);
  const tailCount = tail.reduce((s, t) => s + t.count, 0);

  const merged: Array<{ name: string; count: number }> = [...head];
  if (tailCount > 0) merged.push({ name: OTHER_LABEL, count: tailCount });

  const total = toolCalls.length;
  return merged.map((m) => ({
    name: m.name,
    count: m.count,
    pct: total > 0 ? (m.count / total) * 100 : 0,
  }));
}
