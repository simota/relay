import { describe, expect, test } from "bun:test";
import {
  describeRecurrence,
  nextOccurrence,
  normalizeRecurrence,
  occurrenceSourceId,
  recurrenceRoot,
} from "./recurrence.js";

function local(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe("normalizeRecurrence", () => {
  test("canonicalizes the documented spellings", () => {
    expect(normalizeRecurrence("Daily")).toBe("daily");
    expect(normalizeRecurrence("every day")).toBe("daily");
    expect(normalizeRecurrence("weekdays")).toBe("weekdays");
    expect(normalizeRecurrence("1w")).toBe("weekly");
    expect(normalizeRecurrence("2w")).toBe("biweekly");
    expect(normalizeRecurrence("14d")).toBe("biweekly");
    expect(normalizeRecurrence("3d")).toBe("every:3d");
    expect(normalizeRecurrence("every 3 days")).toBe("every:3d");
    expect(normalizeRecurrence("every:6w")).toBe("every:6w");
    expect(normalizeRecurrence("monthly")).toBe("monthly");
    expect(normalizeRecurrence("thu, mon")).toBe("days:mon,thu");
    expect(normalizeRecurrence("mon,tue,wed,thu,fri")).toBe("weekdays");
  });

  test("clear spellings return null, junk returns undefined", () => {
    expect(normalizeRecurrence("none")).toBeNull();
    expect(normalizeRecurrence("")).toBeNull();
    expect(normalizeRecurrence(null)).toBeNull();
    expect(normalizeRecurrence("sometimes")).toBeUndefined();
    expect(normalizeRecurrence("0d")).toBeUndefined();
    expect(normalizeRecurrence("400d")).toBeUndefined();
    expect(normalizeRecurrence(7)).toBeUndefined();
  });

  test("canonical rules round-trip", () => {
    for (const rule of ["daily", "weekdays", "weekly", "biweekly", "monthly", "every:3d", "every:6w", "days:mon,thu"]) {
      expect(normalizeRecurrence(rule)).toBe(rule);
    }
  });

  test("describe", () => {
    expect(describeRecurrence("every:3d")).toBe("every 3 days");
    expect(describeRecurrence("days:mon,thu")).toBe("Mon, Thu");
    expect(describeRecurrence("biweekly")).toBe("every 2 weeks");
  });
});

describe("nextOccurrence", () => {
  test("weekly keeps the time of day of a dated task", () => {
    const due = local(2026, 11, 2, 9, 30).toISOString(); // Mon 09:30
    const now = local(2026, 11, 2, 10);
    expect(nextOccurrence("weekly", due, now)).toBe(local(2026, 11, 9, 9, 30).toISOString());
  });

  test("skips missed periods so the next one is in the future", () => {
    const due = local(2026, 11, 1).toISOString();
    const now = local(2026, 11, 5, 12);
    expect(nextOccurrence("daily", due, now)).toBe(local(2026, 11, 6).toISOString());
  });

  test("undated tasks schedule from today's local midnight", () => {
    const now = local(2026, 11, 6, 15); // Fri
    expect(nextOccurrence("daily", null, now)).toBe(local(2026, 11, 7).toISOString());
    expect(nextOccurrence("weekdays", null, now)).toBe(local(2026, 11, 9).toISOString()); // → Mon
  });

  test("weekday lists pick the next listed day", () => {
    const now = local(2026, 11, 3, 8); // Tue
    expect(nextOccurrence("days:mon,thu", null, now)).toBe(local(2026, 11, 5).toISOString());
  });

  test("monthly clamps to the end of short months and returns to the anchor day", () => {
    const due = local(2027, 1, 31).toISOString();
    expect(nextOccurrence("monthly", due, local(2027, 1, 31, 12))).toBe(local(2027, 2, 28).toISOString());
  });

  test("every N days", () => {
    const due = local(2026, 11, 1).toISOString();
    expect(nextOccurrence("every:10d", due, local(2026, 11, 2))).toBe(local(2026, 11, 11).toISOString());
  });

  test("unknown rule yields null", () => {
    expect(nextOccurrence("bogus", null, new Date())).toBeNull();
  });
});

describe("series keys", () => {
  test("first occurrence is keyed by id, later ones inherit the root", () => {
    expect(recurrenceRoot({ id: 42, source_id: "manual:1:abc" })).toBe("42");
    expect(recurrenceRoot({ id: 77, source_id: "recur:42:2026-11-09" })).toBe("42");
    expect(occurrenceSourceId("42", local(2026, 11, 9, 9).toISOString())).toBe("recur:42:2026-11-09");
  });
});
