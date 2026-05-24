import { spawn, spawnSync } from "node:child_process";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

const PR_LIMIT = "80";
const THREAD_LIMIT = 50;

const THREAD_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          comments(last: 1) {
            nodes {
              body
              path
              line
              url
              author { login }
            }
          }
        }
      }
    }
  }
}`;

export const ghUnresolvedThreadAdapter: Adapter = {
  name: "gh_unresolved_thread",

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
      .knownOpenSourceIds("gh_unresolved_thread")
      .filter((source_id) => !live.has(source_id))
      .map((source_id) => ({ source_type: "gh_unresolved_thread", source_id }));
  },
};

async function scanCurrent(ctx: AdapterContext): Promise<{ tasks: TaskInput[]; liveSourceIds: string[] }> {
  const user = ctx.githubUser;
  if (!user) return { tasks: [], liveSourceIds: [] };

  const prs = await ghJsonArray([
    "search",
    "prs",
    "--author",
    user,
    "--state",
    "open",
    "--sort",
    "updated",
    "--order",
    "desc",
    "--limit",
    PR_LIMIT,
    "--json",
    "repository,number,title,url,updatedAt",
  ]) as GhPrRow[];

  const tasks: TaskInput[] = [];
  const liveSourceIds: string[] = [];

  for (const pr of prs) {
    if (!pr.url || typeof pr.number !== "number") continue;
    const parsed = parsePrUrl(pr.url);
    if (!parsed) continue;
    const data = await ghJsonObject([
      "api",
      "graphql",
      "-f",
      `query=${THREAD_QUERY}`,
      "-f",
      `owner=${parsed.owner}`,
      "-f",
      `name=${parsed.name}`,
      "-F",
      `number=${pr.number}`,
    ]);
    const threads = extractThreads(data).filter((thread) => !thread.isResolved).slice(0, THREAD_LIMIT);
    for (const thread of threads) {
      const comment = thread.comments?.nodes?.[0];
      const sourceId = `${pr.url}#thread:${thread.id}`;
      liveSourceIds.push(sourceId);
      tasks.push({
        source_type: "gh_unresolved_thread",
        source_id: sourceId,
        repo: parsed.name,
        title: `Unresolved review thread: ${pr.title ?? `PR #${pr.number}`}`,
        body: formatBody(pr, comment),
        status: "open",
        assignee: "self",
        priority: 76,
        prompt: null,
        files: comment?.path ? [comment.path] : [],
        context_hash: null,
        session_id: null,
        due_at: null,
        wait_on: "self",
      });
    }
  }

  return { tasks, liveSourceIds };
}

interface GhPrRow {
  repository?: { name?: string; nameWithOwner?: string };
  number?: number;
  title?: string;
  url?: string;
  updatedAt?: string;
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  comments?: {
    nodes?: Array<{
      body?: string;
      path?: string;
      line?: number;
      url?: string;
      author?: { login?: string };
    }>;
  };
}

function extractThreads(data: unknown): ReviewThread[] {
  const root = data as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: { nodes?: ReviewThread[] };
        };
      };
    };
  };
  return root.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
}

function formatBody(
  pr: GhPrRow,
  comment?: { body?: string; path?: string; line?: number; url?: string; author?: { login?: string } },
): string {
  const lines: string[] = [];
  if (pr.url) lines.push(pr.url);
  if (comment?.url) lines.push(`thread: ${comment.url}`);
  if (comment?.path) lines.push(`file: ${comment.path}${comment.line ? `:${comment.line}` : ""}`);
  if (comment?.author?.login) lines.push(`last comment: ${comment.author.login}`);
  if (pr.updatedAt) lines.push(`pr updated: ${pr.updatedAt}`);
  if (comment?.body) lines.push("", comment.body);
  return lines.join("\n");
}

function parsePrUrl(url: string): { owner: string; name: string } | null {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
  if (!match) return null;
  return { owner: match[1]!, name: match[2]! };
}

function ghJsonArray(args: string[]): Promise<unknown[]> {
  return runGh(args).then((stdout) => JSON.parse(stdout) as unknown[]);
}

function ghJsonObject(args: string[]): Promise<unknown> {
  return runGh(args).then((stdout) => JSON.parse(stdout) as unknown);
}

function runGh(args: string[]): Promise<string> {
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
      resolve(stdout);
    });
  });
}
