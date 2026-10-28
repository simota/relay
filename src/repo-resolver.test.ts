import "./test-setup.js";
import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { RELAY_HOME } from "./paths.js";
import { findMissingRepos } from "./repo-metadata.js";
import { resolveRepoPath } from "./repo-resolver.js";

const root = join(RELAY_HOME, "resolver-root", "github.com");
mkdirSync(join(root, "demo"), { recursive: true });
// A repo pinned via scan.tracked_repos, outside every scan root, plus an
// untracked sibling that sync never ingests.
const elsewhere = join(RELAY_HOME, "resolver-elsewhere");
const tracked = join(elsewhere, "pinned");
mkdirSync(tracked, { recursive: true });
mkdirSync(join(elsewhere, "sibling"), { recursive: true });
const defaults = loadConfig(join(RELAY_HOME, "no-such-config.toml"));
const cfg = { ...defaults, scan: { ...defaults.scan, roots: [root], tracked_repos: [tracked] } };

describe("resolveRepoPath", () => {
  test("resolves a bare repo name under a scan root", () => {
    expect(resolveRepoPath("demo", cfg)).toBe(join(root, "demo"));
  });

  test("resolves a tracked repo outside scan.roots to its exact path", () => {
    expect(resolveRepoPath("pinned", cfg)).toBe(tracked);
    // A tracked repo's parent is not a root: its siblings stay unresolved.
    expect(resolveRepoPath("sibling", cfg)).toBeNull();
  });

  test("rejects names that escape the scan root", () => {
    // `..` resolves to an existing directory (the root's parent) — it must
    // not be reported as a repo, nor may nested/absolute paths be.
    for (const name of ["..", "../..", ".", "", "demo/..", "../resolver-root", root, tracked, "a\\..\\.."]) {
      expect(resolveRepoPath(name, cfg)).toBeNull();
    }
  });
});

describe("findMissingRepos", () => {
  test("treats scan-root and tracked repos as present", () => {
    expect(findMissingRepos(["demo", "pinned", "sibling", "gone"], cfg)).toEqual(["sibling", "gone"]);
  });

  test("reports nothing missing when no location is configured", () => {
    const empty = { ...cfg, scan: { ...cfg.scan, roots: [], tracked_repos: [] } };
    expect(findMissingRepos(["demo", "gone"], empty)).toEqual([]);
  });
});
