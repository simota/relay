import "./test-setup.js";
import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { RELAY_HOME } from "./paths.js";
import { resolveRepoPath } from "./repo-resolver.js";

const root = join(RELAY_HOME, "resolver-root", "github.com");
mkdirSync(join(root, "demo"), { recursive: true });
const defaults = loadConfig(join(RELAY_HOME, "no-such-config.toml"));
const cfg = { ...defaults, scan: { ...defaults.scan, roots: [root] } };

describe("resolveRepoPath", () => {
  test("resolves a bare repo name under a scan root", () => {
    expect(resolveRepoPath("demo", cfg)).toBe(join(root, "demo"));
  });

  test("rejects names that escape the scan root", () => {
    // `..` resolves to an existing directory (the root's parent) — it must
    // not be reported as a repo, nor may nested/absolute paths be.
    for (const name of ["..", "../..", ".", "", "demo/..", "../resolver-root", root, "a\\..\\.."]) {
      expect(resolveRepoPath(name, cfg)).toBeNull();
    }
  });
});
