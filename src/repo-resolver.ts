import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { expandHome } from "./paths.js";

export function resolveRepoPath(repo: string, cfg: Config): string | null {
  for (const rawRoot of cfg.scan.roots) {
    const root = expandHome(rawRoot);
    const direct = join(root, repo);
    if (isDir(direct)) return direct;
  }
  return null;
}

function isDir(p: string): boolean {
  if (!existsSync(p)) return false;
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
