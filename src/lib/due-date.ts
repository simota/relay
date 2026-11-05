// `due_at` is stored as an ISO8601 instant and compared lexically in SQL
// (`due_at < ?` against `toISOString()` bounds). A bare calendar date such as
// "2026-10-25" (`relay add --due`, ProjectV2 Date fields) breaks both sides of
// that: JS parses it as UTC midnight, which is the previous evening west of
// UTC, and SQL sorts it before every instant on the same day. Calendar dates
// therefore become local midnight, matching agenda's local-day buckets.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/;

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
  const m = ISO_DATE_PREFIX.exec(trimmed);
  if (!m) return null;
  // `new Date("2026-02-31T00:00Z")` rolls over to March 3rd; check the
  // calendar date as written before handing the rest to the parser.
  const [, y, mo, day] = m;
  const written = new Date(Date.UTC(2000, Number(mo) - 1, Number(day)));
  written.setUTCFullYear(Number(y));
  if (written.getUTCMonth() !== Number(mo) - 1 || written.getUTCDate() !== Number(day)) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const WEEKDAYS = [
  ["sun", "sunday"],
  ["mon", "monday"],
  ["tue", "tues", "tuesday"],
  ["wed", "wednesday"],
  ["thu", "thur", "thurs", "thursday"],
  ["fri", "friday"],
  ["sat", "saturday"],
] as const;
const RELATIVE = /^\+?(\d{1,4})\s*([dhw])$/;

function localMidnight(base: Date, addDays: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Parse a human "when" for snooze-until / due dates. On top of everything
 * {@link parseDueInput} accepts, this understands the shorthands people
 * actually type at a prompt:
 *
 *   today | tomorrow | next-week (next Monday) | mon..sun (next occurrence)
 *   +3d / 3d (local midnight N days out) | +2w | +4h (N hours from now)
 *
 * Day-granular forms resolve to local midnight, matching calendar dates.
 * Returns null for anything else so callers can reject the input.
 */
export function parseWhenInput(value: string, now: Date = new Date()): string | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "today") return localMidnight(now, 0);
  if (raw === "tomorrow" || raw === "tmr") return localMidnight(now, 1);
  if (raw === "next-week" || raw === "nextweek" || raw === "next week") {
    // Next Monday, never today: a Monday "next week" is 7 days out.
    const delta = ((8 - now.getDay()) % 7) || 7;
    return localMidnight(now, delta);
  }
  const weekday = WEEKDAYS.findIndex((names) => (names as readonly string[]).includes(raw));
  if (weekday >= 0) {
    const delta = ((weekday - now.getDay() + 7) % 7) || 7;
    return localMidnight(now, delta);
  }
  const rel = RELATIVE.exec(raw);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    if (unit === "h") return new Date(now.getTime() + n * 3_600_000).toISOString();
    return localMidnight(now, unit === "w" ? n * 7 : n);
  }
  return parseDueInput(value);
}

/** Help text shared by CLI flags and API errors. */
export const WHEN_INPUT_HINT =
  "YYYY-MM-DD, an ISO datetime, today, tomorrow, next-week, mon..sun, +3d, +2w, or +4h";
