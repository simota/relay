import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { loadConfig, saveTrackedRepos } from "../config.js";
import { expandHome } from "../paths.js";

export interface TrackedRepoStatus {
  path: string;       // absolute, normalized path the user supplied
  exists: boolean;    // is it a directory on disk right now?
  isDir: boolean;     // exists AND a directory (false for plain files / symlink to nowhere)
}

/**
 * Normalize and validate a user-supplied path:
 * - expand ~ via expandHome
 * - require an absolute path (after expansion)
 * - reject empty / whitespace-only entries
 * - reject "..": after `normalize`, the resolved path must not contain ".." segments
 */
function normalizeTrackedPath(raw: string): { path: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "path is empty" };
  const expanded = expandHome(trimmed);
  if (!isAbsolute(expanded)) {
    return { error: `path must be absolute: "${raw}"` };
  }
  const norm = normalize(expanded);
  if (norm.split("/").includes("..")) {
    return { error: `path may not contain "..": "${raw}"` };
  }
  // Strip trailing slash so the saved value matches what resolveRepoPath()
  // produces (join(root, name) never includes a trailing separator). Leave a
  // bare "/" alone.
  const stripped = norm.length > 1 && norm.endsWith("/") ? norm.replace(/\/+$/, "") : norm;
  return { path: stripped };
}

export function createScanApi() {
  const app = new Hono();

  /**
   * GET /api/scan/tracked
   * Returns the current allowlist with on-disk status for each entry, so the
   * UI can flag entries that no longer exist.
   */
  app.get("/scan/tracked", (c) => {
    const cfg = loadConfig();
    const statuses: TrackedRepoStatus[] = cfg.scan.tracked_repos.map((p) => {
      const exists = existsSync(p);
      let isDir = false;
      if (exists) {
        try {
          isDir = statSync(p).isDirectory();
        } catch {
          isDir = false;
        }
      }
      return { path: p, exists, isDir };
    });
    return c.json({ trackedRepos: statuses });
  });

  /**
   * POST /api/scan/tracked
   * Body: { repos: string[] }    // absolute filesystem paths
   * Persists the allowlist to config.toml. Each path is normalized and
   * validated for `isAbsolute` + no ".." segments. Non-existent paths are
   * accepted (returned with exists:false) so users can pre-stage entries.
   */
  app.post("/scan/tracked", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "request body must be valid JSON" }, 400);
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !Array.isArray((body as Record<string, unknown>)["repos"])
    ) {
      return c.json({ error: "body must be { repos: string[] }" }, 400);
    }

    const raw: unknown[] = (body as { repos: unknown[] }).repos;
    const validated: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") {
        return c.json({ error: "each repo must be a string" }, 400);
      }
      const result = normalizeTrackedPath(item);
      if ("error" in result) {
        return c.json({ error: result.error }, 400);
      }
      validated.push(result.path);
    }
    const deduped = [...new Set(validated)];

    saveTrackedRepos(deduped);

    // Echo status back so the UI can immediately flag stale entries.
    const statuses: TrackedRepoStatus[] = deduped.map((p) => {
      const exists = existsSync(p);
      let isDir = false;
      if (exists) {
        try {
          isDir = statSync(p).isDirectory();
        } catch {
          isDir = false;
        }
      }
      return { path: p, exists, isDir };
    });
    return c.json({ trackedRepos: statuses });
  });

  return app;
}
