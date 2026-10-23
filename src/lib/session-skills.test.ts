import { describe, expect, test } from "bun:test";
import { extractAntigravitySkills } from "./session-skills.js";

describe("extractAntigravitySkills", () => {
  test("skips JSON lines that are not objects", () => {
    const text = ["null", "42", JSON.stringify({ type: "USER_INPUT", content: "hi" })].join("\n");
    expect(() => extractAntigravitySkills(text)).not.toThrow();
  });
});
