import { describe, expect, test } from "bun:test";
import type { SessionMessage, SessionToolCall } from "../sessions/types.js";
import { extractPromiseLedger } from "./promise-ledger.js";

const msg = (role: "user" | "assistant", text: string, timestamp: string) =>
  ({ role, text, timestamp }) as SessionMessage;
const bash = (command: string, timestamp: string): SessionToolCall => ({
  name: "Bash",
  args_summary: command,
  args_json: JSON.stringify({ command }),
  timestamp,
});

const T = (n: number) => `2026-10-01T00:00:0${n}.000Z`;

describe("extractPromiseLedger turn windows", () => {
  // Turn 1: user@1, test run @2, claim @3 -> verified.
  // Turn 2: user@4, test run exactly @4 (on the boundary, excluded),
  //         claim @5 -> unmet (turn 1's run doesn't count either).
  // Turn 3: user@6, test run exactly @7 == claim ts (inclusive) -> verified.
  const messages = [
    msg("user", "please test", T(1)),
    msg("assistant", "I've tested the parser.", T(3)),
    msg("user", "again", T(4)),
    msg("assistant", "I've tested the parser.", T(5)),
    msg("user", "once more", T(6)),
    msg("assistant", "I've tested the parser.", T(7)),
    msg("assistant", "Here is the plan.", T(8)),
  ];
  const tools = [bash("bun test", T(2)), bash("bun test", T(4)), bash("bun test", T(7))];

  test("tool calls count only inside (previous user turn, claim]", () => {
    const ledger = extractPromiseLedger(messages, tools);
    expect(ledger.entries.map((e) => [e.message_index, e.status])).toEqual([
      [1, "verified"],
      [3, "unmet"],
      [5, "verified"],
    ]);
  });

  test("out-of-order tool calls give the same verdicts", () => {
    const sorted = extractPromiseLedger(messages, tools);
    const shuffled = extractPromiseLedger(messages, [tools[2]!, tools[0]!, tools[1]!]);
    expect(shuffled).toEqual(sorted);
  });

  test("out-of-order user turns resolve to the latest earlier boundary", () => {
    const reordered = [messages[4]!, messages[2]!, messages[0]!, ...messages.filter((m) => m.role === "assistant")];
    const ledger = extractPromiseLedger(reordered, tools);
    expect(ledger.entries.map((e) => [e.timestamp, e.status])).toEqual([
      [T(3), "verified"],
      [T(5), "unmet"],
      [T(7), "verified"],
    ]);
  });
});
