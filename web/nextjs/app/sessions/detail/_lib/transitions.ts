import type { SessionToolCall } from "@/lib/api";

export interface TransitionMatrix {
  tools: string[];
  matrix: number[][];
}

const MAX_TOOLS = 8;
const OTHER_LABEL = "other";

export function computeTransitions(calls: SessionToolCall[]): TransitionMatrix {
  const empty: TransitionMatrix = { tools: [], matrix: [] };
  if (calls.length < 2) return empty;

  const sorted = [...calls].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  // Build the unique tool list in first-seen order so the diagonal of the
  // matrix preserves a stable reading direction.
  const firstSeen: string[] = [];
  const seen = new Set<string>();
  for (const tc of sorted) {
    if (!seen.has(tc.name)) {
      seen.add(tc.name);
      firstSeen.push(tc.name);
    }
  }
  if (firstSeen.length < 2) return empty;

  // Roll up the long tail into a single "other" bucket so the matrix
  // never exceeds MAX_TOOLS × MAX_TOOLS cells.
  let tools: string[];
  let mapTool: (name: string) => string;
  if (firstSeen.length > MAX_TOOLS) {
    // Frequency-rank the tools so the kept names are the most active ones.
    const counts = new Map<string, number>();
    for (const tc of sorted) counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1);
    const ranked = firstSeen
      .slice()
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
    const kept = new Set(ranked.slice(0, MAX_TOOLS - 1));
    // Preserve the first-seen ordering among the kept names so the layout
    // still reads like a chronological hint.
    const orderedKept = firstSeen.filter((n) => kept.has(n));
    tools = [...orderedKept, OTHER_LABEL];
    mapTool = (name) => (kept.has(name) ? name : OTHER_LABEL);
  } else {
    tools = firstSeen;
    mapTool = (name) => name;
  }

  const index = new Map<string, number>();
  tools.forEach((t, i) => index.set(t, i));

  const N = tools.length;
  const matrix: number[][] = [];
  for (let i = 0; i < N; i++) {
    matrix.push(new Array<number>(N).fill(0));
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (!from || !to) continue;
    const fi = index.get(mapTool(from.name));
    const ti = index.get(mapTool(to.name));
    if (fi === undefined || ti === undefined) continue;
    const row = matrix[fi];
    if (!row) continue;
    row[ti] = (row[ti] ?? 0) + 1;
  }

  return { tools, matrix };
}
