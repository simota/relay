import { spawn, spawnSync } from "node:child_process";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

const SEARCH_LIMIT = "100";

export const ghReviewRequestAdapter: Adapter = {
  name: "gh_review_request",

  precheck(ctx: AdapterContext): { skip: true; reason: string } | null {
    if (!ctx.githubUser) return { skip: true, reason: "github.user not configured in ~/.relay/config.toml" };
    const res = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
    if (res.error || res.status !== 0) return { skip: true, reason: "gh CLI not authenticated" };
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const { tasks } = await scanCurrent(ctx);
    return tasks;
  },

  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    if (!ctx.knownOpenSourceIds) return [];
    const { liveSourceIds } = await scanCurrent(ctx);
    const live = new Set(liveSourceIds);
    return ctx
      .knownOpenSourceIds("gh_review_request")
      .filter((source_id) => !live.has(source_id))
      .map((source_id) => ({ source_type: "gh_review_request", source_id }));
  },
};

async function scanCurrent(ctx: AdapterContext): Promise<{ tasks: TaskInput[]; liveSourceIds: string[] }> {
  const user = ctx.githubUser;
  if (!user) return { tasks: [], liveSourceIds: [] };

  const rows = await ghJson([
    "search",
    "prs",
    "--review-requested",
    user,
    "--state",
    "open",
    "--sort",
    "updated",
    "--order",
    "desc",
    "--limit",
    SEARCH_LIMIT,
    "--json",
    "repository,number,title,body,url,updatedAt,author,labels,isDraft",
  ]) as GhPrRow[];

  const tasks: TaskInput[] = [];
  const liveSourceIds: string[] = [];
  for (const row of rows) {
    if (!row.url) continue;
    const repo = row.repository?.name ?? repoNameFromUrl(row.url);
    if (!repo) continue;
    liveSourceIds.push(row.url);
    tasks.push({
      source_type: "gh_review_request",
      source_id: row.url,
      repo,
      title: `Review requested: ${row.title ?? `PR #${row.number ?? "?"}`}`,
      body: formatBody(row),
      status: "open",
      assignee: "self",
      priority: row.isDraft ? 58 : 72,
      prompt: null,
      files: [],
      context_hash: null,
      session_id: null,
      due_at: null,
      wait_on: "self",
    });
  }
  return { tasks, liveSourceIds };
}

interface GhPrRow {
  repository?: { name?: string };
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  updatedAt?: string;
  author?: { login?: string };
  labels?: Array<{ name?: string }>;
  isDraft?: boolean;
}

function formatBody(row: GhPrRow): string {
  const lines: string[] = [];
  if (row.url) lines.push(row.url);
  if (row.author?.login) lines.push(`author: ${row.author.login}`);
  if (row.updatedAt) lines.push(`updated: ${row.updatedAt}`);
  if (row.isDraft) lines.push("draft: true");
  const labels = (row.labels ?? []).map((label) => label.name).filter(Boolean);
  if (labels.length > 0) lines.push(`labels: ${labels.join(", ")}`);
  if (row.body) lines.push("", row.body);
  return lines.join("\n");
}

function repoNameFromUrl(url: string): string | null {
  const match = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\//.exec(url);
  return match?.[1] ?? null;
}

function ghJson(args: string[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gh exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        const cause = e instanceof Error ? e.message : String(e);
        reject(new Error(`gh JSON parse failed: ${cause}; stderr: ${stderr.trim().slice(0, 500)}`));
      }
    });
  });
}
