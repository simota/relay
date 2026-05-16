import { spawnSync } from "node:child_process";

export interface GitSnapshot {
  branch: string;
  headSha: string;
  dirtyFiles: string[];
}

export function gitSnapshot(cwd: string): GitSnapshot | null {
  const rev = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (rev.status !== 0) return null;

  const branchRes = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  const statusRes = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  });

  const dirty = statusRes.status === 0
    ? statusRes.stdout
        .split("\n")
        .map((l) => l.slice(3).trim())
        .filter(Boolean)
    : [];

  return {
    branch: branchRes.stdout.trim() || "HEAD",
    headSha: rev.stdout.trim(),
    dirtyFiles: dirty,
  };
}
