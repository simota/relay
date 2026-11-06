import { spawn } from "node:child_process";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";
import { memoizedScan } from "./scan-memo.js";
import { ghAuthenticated } from "./gh-auth.js";
import { mapLimit } from "../lib/map-limit.js";

const PR_LIMIT = "80";
const THREAD_LIMIT = 50;
// GraphQL thread lookups in flight at once (one `gh api` process each).
const THREAD_QUERY_CONCURRENCY = 4;

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
    if (!ghAuthenticated()) return { skip: true, reason: "gh CLI not authenticated" };
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const { tasks } = await memoizedScan(ctx, "gh_unresolved_thread", () => scanCurrent(ctx));
    return tasks;
  },

  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    // No user → scanCurrent finds nothing live; that is not "all resolved".
    if (!ctx.knownOpenSourceIds || !ctx.githubUser) return [];
    const { liveSourceIds } = await memoizedScan(ctx, "gh_unresolved_thread", () => scanCurrent(ctx));
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

  const targets: Array<{ pr: GhPrRow & { url: string; number: number }; parsed: { owner: string; name: string } }> = [];
  for (const pr of prs) {
    if (!pr.url || typeof pr.number !== "number") continue;
    const parsed = parsePrUrl(pr.url);
    if (!parsed) continue;
    targets.push({ pr: pr as GhPrRow & { url: string; number: number }, parsed });
  }
  // One GraphQL round-trip per PR; they are independent, so run a few at a
  // time instead of strictly one after another. mapLimit keeps PR order and
  // the sequential loop's failure semantics (first failing PR's error).
  const threadData = await mapLimit(targets, THREAD_QUERY_CONCURRENCY, ({ pr, parsed }) =>
    ghJsonObject([
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
    ]),
  );

  for (const [i, { pr, parsed }] of targets.entries()) {
    const data = threadData[i];
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
    proc.stdout.setEncoding("utf8"); // multi-byte chars may straddle chunks
    proc.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr.setEncoding("utf8"); // multi-byte chars may straddle chunks
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
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
