// Preloaded by `bun test` (see bunfig.toml). A preloaded afterAll is a
// global hook: it runs once, after all files, so the throwaway home is
// removed only when every test file is done with it.
import { afterAll } from "bun:test";
import { rmSync } from "node:fs";
import { TEST_RELAY_HOME } from "./test-setup.js";

afterAll(() => rmSync(TEST_RELAY_HOME, { recursive: true, force: true }));
