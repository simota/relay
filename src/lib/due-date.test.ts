import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeDueAt, parseDueInput } from "./due-date.js";

// West of UTC, UTC midnight is the previous local evening, which is exactly
// where calendar dates used to land.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("normalizeDueAt", () => {
  test("stores a calendar date as local midnight of that day", () => {
    const stored = normalizeDueAt("2026-10-25");
    expect(stored).toBe("2026-10-25T07:00:00.000Z");
    const local = new Date(stored);
    expect([local.getFullYear(), local.getMonth() + 1, local.getDate(), local.getHours()]).toEqual([
      2026, 10, 25, 0,
    ]);
  });

  test("leaves datetimes, non-existent dates, and other strings unchanged", () => {
    expect(normalizeDueAt("2026-10-25T12:00:00.000Z")).toBe("2026-10-25T12:00:00.000Z");
    expect(normalizeDueAt("2026-02-31")).toBe("2026-02-31");
    expect(normalizeDueAt("someday")).toBe("someday");
  });

  test("keeps two-digit years as written", () => {
    expect(new Date(normalizeDueAt("0099-01-01")).getFullYear()).toBe(99);
  });
});

describe("parseDueInput", () => {
  test("accepts calendar dates and ISO datetimes", () => {
    expect(parseDueInput(" 2026-10-25 ")).toBe("2026-10-25T07:00:00.000Z");
    expect(parseDueInput("2026-10-25T09:30:00Z")).toBe("2026-10-25T09:30:00.000Z");
  });

  test("rejects values Date.parse would accept loosely", () => {
    expect(parseDueInput("1")).toBeNull();
    expect(parseDueInput("Oct 25")).toBeNull();
    expect(parseDueInput("not a date")).toBeNull();
    expect(parseDueInput("2026-02-31")).toBeNull();
    expect(parseDueInput("2026-13-01T00:00:00Z")).toBeNull();
  });
});
