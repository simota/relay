import "../test-setup.js";
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RELAY_HOME } from "../paths.js";
import { parseAntigravityTranscript } from "./antigravity-session.js";

describe("parseAntigravityTranscript cwd chain", () => {
  test("prefers the workspace marker over a path mention, like the detail reader", async () => {
    const root = join(RELAY_HOME, "ag-roots");
    mkdirSync(join(root, "foo"), { recursive: true });
    mkdirSync(join(root, "bar", "src"), { recursive: true });
    const transcript = join(RELAY_HOME, "ag-transcript.jsonl");
    const content = `Please fix ${join(root, "bar", "src", "parse.ts")}\n<ADDITIONAL_METADATA>workspace: "${join(root, "foo")}"</ADDITIONAL_METADATA>`;
    writeFileSync(
      transcript,
      `null\n${JSON.stringify({ type: "USER_INPUT", content, created_at: "2026-10-01T00:00:00Z" })}\n`,
    );

    const parsed = await parseAntigravityTranscript(transcript, "conv-1", [root]);
    expect(parsed.cwdHint).toBe(join(root, "foo"));
  });
});
