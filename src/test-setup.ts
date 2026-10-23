// Preloaded by `bun test` (see bunfig.toml). src/paths.ts reads RELAY_HOME
// once at module load and all test files share one process, so the
// throwaway home has to be set here, before any test file is imported.
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-test-"));
process.env.RELAY_HOME = home;
// A preloaded afterAll is a global hook: it runs once, after all files.
afterAll(() => rmSync(home, { recursive: true, force: true }));
