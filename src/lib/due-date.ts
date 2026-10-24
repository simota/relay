// `due_at` is stored as an ISO8601 instant and compared lexically in SQL
// (`due_at < ?` against `toISOString()` bounds). A bare calendar date such as
// "2026-10-25" (`relay add --due`, ProjectV2 Date fields) breaks both sides of
// that: JS parses it as UTC midnight, which is the previous evening west of
// UTC, and SQL sorts it before every instant on the same day. Calendar dates
// therefore become local midnight, matching agenda's local-day buckets.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

/**
 * Normalize a due value for storage. Calendar dates become local midnight;
 * other strings pass through unchanged.
 */
export function normalizeDueAt(value: string): string {
  const m = DATE_ONLY.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  // setFullYear, unlike the Date constructor, keeps years 0-99 as written.
  const local = new Date(0);
  local.setFullYear(Number(y), Number(mo) - 1, Number(d));
  local.setHours(0, 0, 0, 0);
  // Reject roll-overs such as 2026-02-31 instead of storing March 3rd.
  if (local.getMonth() !== Number(mo) - 1 || local.getDate() !== Number(d)) return value;
  return local.toISOString();
}

/**
 * Parse user input (`--due`, `POST /api/tasks`, bulk snooze `until`) into a
 * stored due value, or null unless it is a real YYYY-MM-DD date or ISO
 * datetime. `Date.parse` alone accepts "1" (year 2001) and the like.
 */
export function parseDueInput(value: string): string | null {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    const normalized = normalizeDueAt(trimmed);
    // Unchanged means the calendar date does not exist (e.g. 2026-02-31).
    return normalized === trimmed ? null : normalized;
  }
  if (!ISO_DATE_PREFIX.test(trimmed)) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
