import { Hono } from "hono";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { loadConfig } from "../config.js";
import { resolveRepoPath } from "../repo-resolver.js";

const MAX_FILE_BYTES = 200 * 1024; // 200 KB
const MAX_FILES = 20;

export interface AgentFileEntry {
  name: string;
  relativePath: string;
  mtime: string;
  sizeBytes: number;
  content: string;
  truncated: boolean;
}

export interface RepoAgentsResponse {
  repo: string;
  exists: boolean;
  files: AgentFileEntry[];
}

const UNSAFE_NAME_RE = /\.\.|[/\\]/;

export function createRepoAgentsApi(): Hono {
  const app = new Hono();

  app.get("/:name/agents", async (c) => {
    const name = c.req.param("name");

    // Sanitize: reject path traversal attempts
    if (UNSAFE_NAME_RE.test(name)) {
      return c.json({ error: "Invalid repo name" }, 400);
    }

    const cfg = loadConfig();
    const repoPath = resolveRepoPath(name, cfg);

    if (!repoPath) {
      return c.json<RepoAgentsResponse>({ repo: name, exists: false, files: [] });
    }

    const agentsDir = join(repoPath, ".agents");

    let names: string[];
    try {
      names = await readdir(agentsDir);
    } catch {
      // .agents/ does not exist or is not readable
      return c.json<RepoAgentsResponse>({ repo: name, exists: true, files: [] });
    }

    const mdNames = names.filter((n) => extname(n).toLowerCase() === ".md");

    // Gather mtime for each file, then sort newest-first
    const withMtime: Array<{ name: string; mtime: Date }> = [];
    for (const fname of mdNames) {
      const filePath = join(agentsDir, fname);
      try {
        const s = await stat(filePath);
        if (!s.isFile()) continue;
        withMtime.push({ name: fname, mtime: s.mtime });
      } catch {
        console.warn(`[repo-agents] stat failed: ${filePath}`);
      }
    }

    withMtime.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const limited = withMtime.slice(0, MAX_FILES);

    const entries: AgentFileEntry[] = [];
    for (const { name: fname, mtime } of limited) {
      const filePath = join(agentsDir, fname);
      try {
        const raw = await readFile(filePath);
        const sizeBytes = raw.byteLength;
        const truncated = sizeBytes > MAX_FILE_BYTES;
        const content = truncated
          ? raw.subarray(0, MAX_FILE_BYTES).toString("utf8")
          : raw.toString("utf8");
        entries.push({
          name: fname,
          relativePath: `.agents/${fname}`,
          mtime: mtime.toISOString(),
          sizeBytes,
          content,
          truncated,
        });
      } catch {
        console.warn(`[repo-agents] read failed: ${filePath}`);
      }
    }

    return c.json<RepoAgentsResponse>({ repo: name, exists: true, files: entries });
  });

  return app;
}
