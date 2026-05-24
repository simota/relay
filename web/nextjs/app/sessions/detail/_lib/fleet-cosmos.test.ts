import { describe, expect, test } from "bun:test";
import type { SessionDetail, SessionSummary } from "@/lib/api";
import { buildCosmos } from "./fleet-cosmos";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    type: "codex",
    id: "s1",
    repo: "relay",
    cwd: "/repo",
    title: "Session 1",
    started_at: "2026-05-24T00:00:00.000Z",
    last_active: "2026-05-24T03:00:00.000Z",
    message_count: 0,
    todos_count: 0,
    ...overrides,
  };
}

function detail(messages: SessionDetail["messages"]): SessionDetail {
  return {
    ...session(),
    messages,
    todos: [],
    tool_calls: [],
    skills: [],
    skill_chains: [],
  };
}

describe("buildCosmos", () => {
  test("caps visible points to the newest messages while preserving total count", () => {
    const sessions = [session()];
    const details = new Map([
      [
        "codex:s1",
        detail([
          {
            role: "user",
            timestamp: "2026-05-24T00:00:00.000Z",
            text: "oldest",
          },
          {
            role: "assistant",
            timestamp: "2026-05-24T01:00:00.000Z",
            text: "middle",
          },
          {
            role: "user",
            timestamp: "2026-05-24T02:00:00.000Z",
            text: "newest",
          },
        ]),
      ],
    ]);

    const cosmos = buildCosmos(sessions, details, {
      now: Date.parse("2026-05-24T03:00:00.000Z"),
      windowMs: 6 * 60 * 60 * 1000,
      maxPoints: 2,
    });

    expect(cosmos.totalMessages).toBe(3);
    expect(cosmos.points.map((p) => p.summary)).toEqual(["newest", "middle"]);
  });

  test("keeps point keys unique for same-role messages with identical timestamps", () => {
    const sessions = [session()];
    const details = new Map([
      [
        "codex:s1",
        detail([
          {
            role: "user",
            timestamp: "2026-05-24T02:00:00.000Z",
            text: "same length A",
          },
          {
            role: "user",
            timestamp: "2026-05-24T02:00:00.000Z",
            text: "same length B",
          },
        ]),
      ],
    ]);

    const cosmos = buildCosmos(sessions, details, {
      now: Date.parse("2026-05-24T03:00:00.000Z"),
      windowMs: 6 * 60 * 60 * 1000,
    });

    expect(new Set(cosmos.points.map((p) => p.key)).size).toBe(2);
  });

  test("ignores non-chat roles and invalid timestamps", () => {
    const sessions = [session()];
    const details = new Map([
      [
        "codex:s1",
        detail([
          { role: "tool", timestamp: "2026-05-24T01:00:00.000Z", text: "tool" },
          { role: "system", timestamp: "2026-05-24T01:00:00.000Z", text: "system" },
          { role: "user", timestamp: "not-a-date", text: "bad timestamp" },
          { role: "assistant", timestamp: "2026-05-24T02:00:00.000Z", text: "kept" },
        ]),
      ],
    ]);

    const cosmos = buildCosmos(sessions, details, {
      now: Date.parse("2026-05-24T03:00:00.000Z"),
      windowMs: 6 * 60 * 60 * 1000,
    });

    expect(cosmos.points.map((p) => p.summary)).toEqual(["kept"]);
    expect(cosmos.totalMessages).toBe(1);
  });

  test("keeps positions and opacity finite for future timestamps and zero windows", () => {
    const sessions = [session()];
    const details = new Map([
      [
        "codex:s1",
        detail([
          {
            role: "assistant",
            timestamp: "2026-05-24T04:00:00.000Z",
            text: "future",
          },
        ]),
      ],
    ]);

    const cosmos = buildCosmos(sessions, details, {
      now: Date.parse("2026-05-24T03:00:00.000Z"),
      windowMs: 0,
    });

    const [point] = cosmos.points;
    expect(point).toBeDefined();
    expect(point?.position.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(point?.opacity)).toBe(true);
  });
});
