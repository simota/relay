import { beforeEach, describe, expect, test } from "bun:test";
import { type GhAuthProbe, ghAuthStatus, resetGhAuthStatusCache } from "./gh-auth.js";

describe("ghAuthStatus", () => {
  let calls = 0;
  const fake = (): GhAuthProbe => {
    calls += 1;
    return { status: 0, stdout: "", stderr: `probe ${calls}` };
  };

  beforeEach(() => {
    resetGhAuthStatusCache();
    calls = 0;
  });

  test("reuses one probe within the window and re-probes after it", () => {
    const first = ghAuthStatus(1_000_000, fake);
    expect(ghAuthStatus(1_000_000 + 4_999, fake)).toBe(first);
    expect(calls).toBe(1);
    const later = ghAuthStatus(1_000_000 + 5_000, fake);
    expect(later).not.toBe(first);
    expect(later.stderr).toBe("probe 2");
  });

  test("re-probes when the clock moves backwards", () => {
    const first = ghAuthStatus(2_000_000, fake);
    expect(ghAuthStatus(1_999_000, fake)).not.toBe(first);
    expect(calls).toBe(2);
  });

  test("caches failed probes the same way", () => {
    const failing = (): GhAuthProbe => {
      calls += 1;
      return { status: 1, stdout: "", stderr: "not logged in" };
    };
    const first = ghAuthStatus(3_000_000, failing);
    expect(ghAuthStatus(3_000_100, failing)).toBe(first);
    expect(calls).toBe(1);
  });
});
