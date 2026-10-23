import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { expandHome } from "./paths.js";

export function resolveRepoPath(repo: string, cfg: Config): string | null {
  // `repo` is a bare directory name (SPEC §6). Anything else — `..`, a
  // nested or absolute path — would resolve outside the scan roots, and the
  // result is used as the agent's cwd by `relay run`.
  if (!isBareName(repo)) return null;
  for (const rawRoot of cfg.scan.roots) {
    const root = expandHome(rawRoot);
    const direct = join(root, repo);
    if (isDir(direct)) return direct;
  }
  return null;
}

function isBareName(repo: string): boolean {
  return repo !== "" && repo !== "." && repo !== ".." && !/[/\\]/.test(repo);
}

function isDir(p: string): boolean {
  if (!existsSync(p)) return false;
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
