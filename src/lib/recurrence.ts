// Recurring tasks (schema v13: tasks.recurrence).
//
// A recurring task is closed like any other; closing it spawns the next
// occurrence as a fresh manual task that is snoozed until its due date, so
// it reappears on its own (snooze auto-wake) while the closed occurrence
// stays in Done / standup / digest history.
//
// Canonical rule strings (what tasks.recurrence stores):
//   daily | weekdays | weekly | biweekly | monthly
//   every:<N>d | every:<N>w          (1 ≤ N ≤ 365 / 52)
//   days:mon,thu                     (fixed weekdays, sorted)

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

export const RECURRENCE_HINT =
  "daily, weekdays, weekly, biweekly, monthly, <N>d, <N>w, or weekdays like mon,thu";

/** Max `-n` occurrences a single advance loop may skip (missed periods). */
const MAX_STEPS = 2000;

/**
 * Parse user input into a canonical rule. Returns null for "clear"
 * spellings (`none`, `off`, empty) and undefined when the input is invalid.
 */
export function normalizeRecurrence(input: unknown): string | null | undefined {
  if (input === null) return null;
  if (typeof input !== "string") return undefined;
  const raw = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (raw === "" || raw === "none" || raw === "off" || raw === "never") return null;
  const simple: Record<string, string> = {
    daily: "daily", "every day": "daily", "1d": "daily", "every:1d": "daily",
    weekdays: "weekdays", workdays: "weekdays", "every weekday": "weekdays",
    weekly: "weekly", "every week": "weekly", "1w": "weekly", "every:1w": "weekly",
    biweekly: "biweekly", fortnightly: "biweekly", "2w": "biweekly", "every:2w": "biweekly",
    monthly: "monthly", "every month": "monthly",
  };
  const direct = simple[raw];
  if (direct) return direct;

  const every = /^(?:every[: ]?)?(\d{1,3}) ?(d|day|days|w|week|weeks)$/.exec(raw);
  if (every) {
    const n = Number(every[1]);
    const unit = (every[2] ?? "d").startsWith("w") ? "w" : "d";
    if (!Number.isInteger(n) || n < 1 || (unit === "d" ? n > 365 : n > 52)) return undefined;
    return canonicalEvery(n, unit);
  }

  const daysPart = raw.startsWith("days:") ? raw.slice(5) : raw.startsWith("every ") ? raw.slice(6) : raw;
  const tokens = daysPart.split(/[,\s/]+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const days = new Set<number>();
  for (const token of tokens) {
    const day = DAY_ALIASES[token];
    if (day === undefined) return undefined;
    days.add(day);
  }
  if (days.size === 7) return "daily";
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join(",") === "1,2,3,4,5") return "weekdays";
  return `days:${sorted.map((d) => DAY_NAMES[d]).join(",")}`;
}

function canonicalEvery(n: number, unit: "d" | "w"): string {
  if (unit === "d" && n === 1) return "daily";
  if (unit === "d" && n % 7 === 0 && n / 7 <= 52) return canonicalEvery(n / 7, "w");
  if (unit === "w" && n === 1) return "weekly";
  if (unit === "w" && n === 2) return "biweekly";
  return `every:${n}${unit}`;
}

/** Short human label, e.g. "every 3 days", "Mon, Thu". */
export function describeRecurrence(rule: string): string {
  switch (rule) {
    case "daily": return "daily";
    case "weekdays": return "weekdays";
    case "weekly": return "weekly";
    case "biweekly": return "every 2 weeks";
    case "monthly": return "monthly";
  }
  const every = /^every:(\d+)([dw])$/.exec(rule);
  if (every) return `every ${every[1]} ${every[2] === "w" ? "weeks" : "days"}`;
  if (rule.startsWith("days:")) {
    return rule
      .slice(5)
      .split(",")
      .map((d) => d.charAt(0).toUpperCase() + d.slice(1))
      .join(", ");
  }
  return rule;
}

function addDays(date: Date, n: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  return out;
}

function addMonthsClamped(date: Date, n: number, dayOfMonth: number): Date {
  const out = new Date(date);
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(dayOfMonth, last));
  return out;
}

/** One step forward from `from` (exclusive) according to `rule`. */
function step(rule: string, from: Date, monthDay: number): Date | null {
  switch (rule) {
    case "daily": return addDays(from, 1);
    case "weekly": return addDays(from, 7);
    case "biweekly": return addDays(from, 14);
    case "monthly": return addMonthsClamped(from, 1, monthDay);
    case "weekdays": {
      let next = addDays(from, 1);
      while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1);
      return next;
    }
  }
  const every = /^every:(\d+)([dw])$/.exec(rule);
  if (every) {
    const n = Number(every[1]);
    return addDays(from, every[2] === "w" ? n * 7 : n);
  }
  if (rule.startsWith("days:")) {
    const days = new Set(
      rule
        .slice(5)
        .split(",")
        .map((d) => DAY_ALIASES[d])
        .filter((d): d is number => d !== undefined),
    );
    if (days.size === 0) return null;
    let next = addDays(from, 1);
    for (let i = 0; i < 7 && !days.has(next.getDay()); i++) next = addDays(next, 1);
    return next;
  }
  return null;
}

/**
 * Due date of the occurrence after one that was due at `dueAt` (or, for an
 * undated task, after `now`'s local day). Missed periods are skipped so the
 * next occurrence is always in the future: closing a daily chore three days
 * late schedules tomorrow, not three overdue copies. Undated tasks are
 * scheduled at local midnight; dated ones keep their time of day.
 */
export function nextOccurrence(rule: string, dueAt: string | null, now: Date = new Date()): string | null {
  let anchor: Date;
  if (dueAt && !Number.isNaN(Date.parse(dueAt))) {
    anchor = new Date(dueAt);
  } else {
    anchor = new Date(now);
    anchor.setHours(0, 0, 0, 0);
  }
  const monthDay = anchor.getDate();
  let next = step(rule, anchor, monthDay);
  for (let i = 0; next && next.getTime() <= now.getTime() && i < MAX_STEPS; i++) {
    next = step(rule, next, monthDay);
  }
  if (!next || next.getTime() <= now.getTime()) return null;
  return next.toISOString();
}

/**
 * Stable key that ties every occurrence of a series together. The first
 * occurrence is whatever task the user marked recurring (keyed by its id);
 * spawned occurrences carry `recur:<root>:<date>` source ids.
 */
export function recurrenceRoot(task: { id: number; source_id: string }): string {
  const m = /^recur:([^:]+):/.exec(task.source_id);
  return m?.[1] ?? String(task.id);
}

/** source_id of the spawned occurrence due at `dueAt` (local calendar day). */
export function occurrenceSourceId(root: string, dueAt: string): string {
  const d = new Date(dueAt);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `recur:${root}:${day}`;
}
