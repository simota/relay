import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "@/lib/api";
import {
  bucketizeLatencies,
  bucketizeMessages,
  bucketTotal,
  latencyBucketIndex,
  pulseWindowFor,
} from "./fleet-pulse";

function message(
  role: SessionMessage["role"],
  timestamp: string,
): SessionMessage {
  return { role, timestamp, text: `${role} at ${timestamp}` };
}

describe("fleet pulse", () => {
  test("bucketizes messages inside the selected window only", () => {
    const now = Date.parse("2026-05-24T12:00:00.000Z");
    const win = pulseWindowFor("1h", now);

    const buckets = bucketizeMessages(
      [
        message("user", "2026-05-24T10:59:59.999Z"),
        message("assistant", "2026-05-24T11:00:00.000Z"),
        message("assistant", "2026-05-24T11:00:59.999Z"),
        message("tool", "2026-05-24T11:01:00.000Z"),
        message("assistant", "2026-05-24T12:00:00.000Z"),
        message("user", "not-a-date"),
      ],
      win,
    );

    expect(buckets[0]).toBe(2);
    expect(buckets[1]).toBe(1);
    expect(bucketTotal(buckets)).toBe(3);
  });

  test("counts user-to-assistant response latency in chronological order", () => {
    const now = Date.parse("2026-05-24T12:00:00.000Z");
    const win = pulseWindowFor("1h", now);

    const buckets = bucketizeLatencies(
      [
        message("assistant", "2026-05-24T11:03:30.000Z"),
        message("user", "2026-05-24T11:03:00.000Z"),
        message("user", "2026-05-24T11:10:00.000Z"),
        message("assistant", "2026-05-24T11:21:00.000Z"),
        message("user", "2026-05-24T10:50:00.000Z"),
        message("assistant", "2026-05-24T11:00:01.000Z"),
      ],
      win,
    );

    expect(buckets[latencyBucketIndex(30_000)]).toBe(1);
    expect(buckets[latencyBucketIndex(11 * 60_000)]).toBe(1);
    expect(bucketTotal(buckets)).toBe(2);
  });
});
