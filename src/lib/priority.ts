// Priority decay — implements SPEC.md §12 comment:
//   "14日触らないタスクは priority -10" (progressive, applied every decay window).
//
// Pure functions; no I/O. Used by `relay show` for display (commands/list.ts
// `runShow`) and by `db.today()` for ranking via the SQL expression builder
// below (`effectivePrioritySqlExpr`).

const DECAY_STEP = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

export function daysBetween(fromIso: string, now: Date = new Date()): number {
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
}

export function effectivePriority(
  rawPriority: number,
  updatedAtIso: string,
  decayDays: number,
  now: Date = new Date(),
): number {
  if (decayDays <= 0) return rawPriority;
  const days = daysBetween(updatedAtIso, now);
  const steps = Math.floor(days / decayDays);
  return Math.max(0, rawPriority - steps * DECAY_STEP);
}

export interface PriorityHistoryPoint {
  weeksAgo: number;
  priority: number;
}

export function priorityHistory(
  rawPriority: number,
  updatedAtIso: string,
  decayDays: number,
  now: Date = new Date(),
  weeks: number = 8,
): PriorityHistoryPoint[] {
  const out: PriorityHistoryPoint[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const at = new Date(now.getTime() - w * 7 * MS_PER_DAY);
    out.push({
      weeksAgo: w,
      priority: effectivePriority(rawPriority, updatedAtIso, decayDays, at),
    });
  }
  return out;
}

/**
 * Build a SQLite expression that computes the effective (decayed) priority
 * for a task row, mirroring {@link effectivePriority}. Returns the literal
 * SQL fragment to splice into ORDER BY clauses.
 *
 * Behaviour:
 * - `decayDays <= 0` → returns `priority` (no decay, ranking degrades to the
 *   v0.1 behaviour of raw priority ordering).
 * - Otherwise → `MAX(0, priority - floor(idle_seconds / (decayDays * 86400)) * 10)`,
 *   where `idle_seconds` is computed from `strftime('%s', ...)` so it stays
 *   robust against `updated_at` formats produced by `bun:sqlite` and Node.
 *
 * The function-form (`MAX(a, b)` with two scalar args) was added in
 * SQLite 3.42; bun:sqlite ships a newer build so this is safe.
 *
 * `decayDays` is consumed as a TypeScript number and validated as a
 * non-negative integer in the config schema (`src/config.ts`), so direct
 * interpolation into the SQL string is safe — no user-controlled input
 * reaches this function.
 */
export function effectivePrioritySqlExpr(decayDays: number): string {
  if (!Number.isFinite(decayDays) || decayDays <= 0) {
    return "priority";
  }
  const windowSeconds = Math.floor(decayDays) * SECONDS_PER_DAY;
  return (
    "MAX(0, priority - " +
    "(CAST(strftime('%s', 'now') AS INTEGER) - " +
    "CAST(strftime('%s', updated_at) AS INTEGER)) / " +
    `${windowSeconds} * ${DECAY_STEP})`
  );
}

export function priorityAsciiGraph(
  history: PriorityHistoryPoint[],
  width: number = 30,
): string[] {
  const max = Math.max(100, ...history.map((p) => p.priority));
  const lines: string[] = [];
  for (const point of history) {
    const filled = Math.round((point.priority / max) * width);
    const bar = "█".repeat(filled) + "·".repeat(Math.max(0, width - filled));
    const label = point.weeksAgo === 0 ? "now" : `${point.weeksAgo}w ago`;
    lines.push(`${label.padStart(7)}  ${bar}  ${String(point.priority).padStart(3)}`);
  }
  return lines;
}
