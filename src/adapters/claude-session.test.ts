import { describe, expect, test } from "bun:test";
import { extractToolEvents } from "./claude-session.js";

describe("extractToolEvents", () => {
  test("skips malformed TodoWrite items instead of failing the whole adapter", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "TodoWrite",
            input: { todos: [null, "str", { id: "1", content: "real todo", status: "pending" }] },
          },
        ],
      },
    });
    const { events } = extractToolEvents(`${line}\n`);
    expect(events).toEqual([
      { kind: "TodoWrite", todos: [{ id: "1", content: "real todo", status: "pending" }] },
    ]);
  });
});
