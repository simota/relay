import "./test-setup.js";
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveTrackedRepos } from "./config.js";
import { RELAY_HOME } from "./paths.js";

describe("saveTrackedRepos", () => {
  test("preserves other settings when updating tracked_repos", () => {
    const path = join(RELAY_HOME, "config-roundtrip.toml");
    writeFileSync(path, `[adapters]\nclaude_session = false\n`);
    saveTrackedRepos(["/x/y"], path);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("claude_session = false");
    expect(text).toContain("/x/y");
  });

  test("refuses to overwrite a config it cannot parse", () => {
    const path = join(RELAY_HOME, "config-broken.toml");
    const original = `[adapters]\nclaude_session = false\nthis is not toml\n`;
    writeFileSync(path, original);
    expect(() => saveTrackedRepos(["/x/y"], path)).toThrow(/unparseable/);
    expect(readFileSync(path, "utf8")).toBe(original);
  });
});
