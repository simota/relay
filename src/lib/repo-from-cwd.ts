import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Memoize by cwd — the same cwd appears across many sessions and adapters.
// Cleared per-process; the small map size (~ #distinct repo roots seen) is
// well under any reasonable cap.
const cache = new Map<string, string | null>();

/**
 * Resolve the repo name for a given cwd by walking up to the nearest `.git`
 * directory. Falls back to "first path segment under any scan root" when no
 * `.git` is found.
 *
 * The previous "first segment under roots" heuristic mis-resolves two
 * common shapes:
 *   ~/repos/github.com/devs/relay  → "devs"  (should be "relay")
 *   ~/repos/luna/utata-app         → null    (should be "utata-app")
 * `.git` discovery handles both cleanly and works for any scan.roots layout.
 */
export function resolveRepoForCwd(cwd: string | null, roots: string[]): string | null {
  if (!cwd) return null;
  if (cache.has(cwd)) return cache.get(cwd) ?? null;

  const gitRoot = findGitRoot(cwd);
  if (gitRoot) {
    const name = basename(gitRoot);
    cache.set(cwd, name);
    return name;
  }

  for (const root of roots) {
    if (cwd === root) continue;
    if (cwd.startsWith(root + "/")) {
      const rel = cwd.slice(root.length + 1);
      const first = rel.split("/")[0] || null;
      cache.set(cwd, first);
      return first;
    }
  }

  cache.set(cwd, null);
  return null;
}

/**
 * Cap the upward walk at 12 levels so a symlinked or otherwise pathological
 * tree can't loop forever. Real repos sit at most 6-7 segments below /.
 */
function findGitRoot(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
