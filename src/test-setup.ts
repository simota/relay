// Points RELAY_HOME at a throwaway directory. src/paths.ts reads RELAY_HOME
// once at module load and all test files share one process, so this must
// run before anything imports src/paths.ts: bunfig.toml preloads it via
// src/test-preload.ts, and DB-touching test files also import it first so
// a run that skips the preload (e.g. started from a subdirectory) still
// never touches the user's ~/.relay. Module caching makes it run once.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_RELAY_HOME = mkdtempSync(join(tmpdir(), "relay-test-"));
process.env.RELAY_HOME = TEST_RELAY_HOME;
