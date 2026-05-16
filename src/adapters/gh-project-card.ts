import { spawn, spawnSync } from "node:child_process";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

/**
 * Ingest GitHub Project v2 (the boards under `https://github.com/users/<u>/projects/<n>`
 * and `https://github.com/orgs/<o>/projects/<n>`) **items** as relay
 * tasks. Each project item is one card — either linked to an Issue /
 * PR (already covered by `github_issue` / `github_pr`) or a standalone
 * DraftIssue note that exists *only* on the board.
 *
 * The unique signal this adapter captures is the standalone DraftIssue:
 * a card the user typed straight into the board, with no GitHub Issue
 * backing it. Those cards are completely invisible to `github_issue`
 * (the issues sweep never sees them), and a power user who lives in
 * the Project v2 board can otherwise accumulate dozens of "this would
 * be a great task to start" notes that never reach relay.
 *
 * Default OFF (`[adapters].gh_project_card = false`). Two reasons:
 *  1. The Issue/PR-backed cards duplicate what `github_issue` /
 *     `github_pr` already ingest. The dedup is keyed by `source_id`
 *     across adapters, so the duplicate row is harmless but
 *     visually noisy for users who don't use ProjectV2.
 *  2. ProjectV2 requires a separate token scope (`project` or
 *     `read:project`) on top of the `repo` scope `gh` ships with.
 *     Most relay users haven't run `gh auth refresh -s project`,
 *     so flipping this on by default would just produce skip
 *     errors on every sync.
 *
 * Precheck checks the scope dynamically (via `gh auth status` — the
 * scope set is printed there). When the scope is missing, the
 * adapter SKIPS with a reason string that tells the user the exact
 * command to run. That makes opting in self-explanatory: enable the
 * adapter, sync, read the skip reason, run the suggested refresh.
 *
 * Custom field schema is dynamic per project (each project owner
 * defines their own `Status`, `Priority`, `Date` columns and field
 * names vary in case and spelling). We compare field names
 * case-insensitively and accept the common synonyms; user-defined
 * `Status` values like `Released` are configured via
 * `[gh_project_card].done_statuses` for the resolved sweep.
 */

// Page size for `viewer.projectsV2`. The user typically has 1-5
// projects so paging usually completes in one request. We still
// cap at MAX_PROJECT_PAGES to bound a runaway sweep.
const PROJECT_PAGE_SIZE = 20;
const MAX_PROJECT_PAGES = 5;

// Per-project page size for `items`. 100 is the GraphQL max. ProjectV2
// boards rarely exceed a few hundred cards; we cap at 10 pages so a
// pathological 5000-card board doesn't dominate the sync budget.
const ITEMS_PAGE_SIZE = 100;
const MAX_ITEMS_PAGES = 10;

// Title truncation matches `cursor_session` (120 chars) — long enough
// to hold a meaningful DraftIssue title, short enough to fit a list view
// without horizontal scroll.
const TITLE_MAX_LEN = 120;

// Body truncation for DraftIssue content. DraftIssue bodies can be
// arbitrary Markdown notes; cap to keep the SQLite row reasonable.
const BODY_MAX_LEN = 4000;

// Default priority for a card with no explicit `Priority` custom field
// value. Mirrors the relay-wide default (50). Cards with a custom
// `Priority` (P0/P1/P2 or High/Medium/Low) override this — see
// `mapPriorityValue`.
const PRIORITY_DEFAULT = 50;

export const ghProjectCardAdapter: Adapter = {
  name: "gh_project_card",

  precheck(_ctx: AdapterContext): { skip: true; reason: string } | null {
    // 1. gh authenticated? Same probe as every other gh adapter.
    const authProbe = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
    if (authProbe.error || authProbe.status !== 0) {
      return { skip: true, reason: "gh CLI not authenticated" };
    }
    // 2. Token scope check. `gh auth status` prints "Token scopes: 'a',
    //    'b', ..." on stderr (gh 2.x) or stdout (gh older). We accept
    //    either `project` or `read:project` — both grant the
    //    `projectsV2` query access we need.
    const combined = `${authProbe.stdout ?? ""}\n${authProbe.stderr ?? ""}`;
    if (!hasProjectScope(combined)) {
      return {
        skip: true,
        reason:
          "gh token missing 'project' scope — run `gh auth refresh -h github.com -s project` (or `-s read:project`)",
      };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const fallbackRepo = ctx.ghProjectCard?.fallbackRepo ?? "__inbox__";
    let items: ProjectItem[];
    try {
      items = await fetchAllProjectItems(ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.log?.(`gh_project_card: graphql fetch failed (${msg})`);
      return [];
    }

    const tasks: TaskInput[] = [];
    for (const item of items) {
      const task = itemToTask(item, fallbackRepo);
      if (task) tasks.push(task);
    }
    return tasks;
  },

  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    // Re-run the scope precheck — `autoCloseResolvedRemoteTasks`
    // (sync.ts) calls `fetchResolved` for every enabled adapter
    // regardless of whether precheck skipped, so a user who enables
    // the adapter without the `project` scope would otherwise see a
    // noisy "graphql ... INSUFFICIENT_SCOPES" log on every sync. The
    // precheck path is cheap (`gh auth status` runs once already in
    // fetch's pre-step) so the second invocation is a few-ms cost
    // for the cleaner UX of "skipped means skipped".
    const auth = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
    if (auth.error || auth.status !== 0) return [];
    const combined = `${auth.stdout ?? ""}\n${auth.stderr ?? ""}`;
    if (!hasProjectScope(combined)) return [];

    const doneStatuses = (ctx.ghProjectCard?.doneStatuses ?? [
      "Done",
      "Completed",
      "Closed",
      "Shipped",
    ]).map((s) => s.toLowerCase());

    let items: ProjectItem[];
    try {
      items = await fetchAllProjectItems(ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.log?.(`gh_project_card: graphql resolved-sweep failed (${msg})`);
      return [];
    }

    const resolved: ResolvedSource[] = [];
    for (const item of items) {
      const status = extractStatusValue(item)?.toLowerCase();
      if (!status) continue;
      if (!doneStatuses.includes(status)) continue;
      resolved.push({
        source_type: "gh_project_card",
        source_id: sourceIdFor(item.projectId, item.id),
      });
    }
    return resolved;
  },
};

/**
 * Project item, normalised across the three possible `content` shapes
 * (Issue / PullRequest / DraftIssue) plus an opaque field-values map.
 */
interface ProjectItem {
  id: string;
  projectId: string;
  projectTitle: string;
  projectNumber: number | null;
  content:
    | { kind: "issue"; url: string; title?: string; repository?: string | null }
    | { kind: "pull_request"; url: string; title?: string; repository?: string | null }
    | { kind: "draft_issue"; title?: string; body?: string }
    | { kind: "unknown" };
  fieldValues: FieldValue[];
}

type FieldValue =
  | { fieldName: string; kind: "text"; text: string }
  | { fieldName: string; kind: "date"; date: string }
  | { fieldName: string; kind: "single_select"; name: string }
  | { fieldName: string; kind: "number"; number: number }
  | { fieldName: string; kind: "users"; logins: string[] };

function sourceIdFor(projectId: string, itemId: string): string {
  // GitHub internal node IDs are stable across renames and visibility
  // changes — safer than `(project_number, item_index)` which shifts
  // when cards are added or reordered.
  return `gh:project:${projectId}:item:${itemId}`;
}

/**
 * Map a project item to a relay TaskInput. Returns null if the item
 * carries no usable content (rare DraftIssue with empty title and
 * empty body — silently skipped per the AC).
 */
function itemToTask(item: ProjectItem, fallbackRepo: string): TaskInput | null {
  const repo = resolveRepo(item, fallbackRepo);
  const title = resolveTitle(item);
  if (!title) return null;

  const status = extractStatusValue(item);
  const priorityName = extractFieldByName(item, "priority");
  const dateField = extractDateField(item);

  return {
    source_type: "gh_project_card",
    source_id: sourceIdFor(item.projectId, item.id),
    repo,
    title: truncate(title, TITLE_MAX_LEN),
    body: renderBody(item),
    status: mapStatus(status),
    assignee: "self",
    priority: mapPriorityValue(priorityName) ?? PRIORITY_DEFAULT,
    prompt: null,
    files: [],
    context_hash: null,
    session_id: null,
    due_at: dateField,
    wait_on: mapWaitOn(status),
  };
}

function resolveRepo(item: ProjectItem, fallbackRepo: string): string {
  if (item.content.kind === "issue" || item.content.kind === "pull_request") {
    const name = item.content.repository;
    if (name && name.length > 0) return name;
  }
  return fallbackRepo;
}

function resolveTitle(item: ProjectItem): string | null {
  if (item.content.kind === "issue" || item.content.kind === "pull_request") {
    return item.content.title ?? null;
  }
  if (item.content.kind === "draft_issue") {
    const t = item.content.title?.trim();
    if (t && t.length > 0) return t;
    // DraftIssue with no title — fall back to the first body line so
    // the row at least has something to display.
    const bodyFirstLine = item.content.body?.split(/\r?\n/)[0]?.trim();
    if (bodyFirstLine && bodyFirstLine.length > 0) return bodyFirstLine;
    return null;
  }
  return null;
}

function renderBody(item: ProjectItem): string {
  const lines: string[] = [];
  lines.push(`project: ${item.projectTitle}${item.projectNumber !== null ? ` (#${item.projectNumber})` : ""}`);
  if (item.content.kind === "issue" || item.content.kind === "pull_request") {
    lines.push(`${item.content.kind === "issue" ? "issue" : "pr"}: ${item.content.url}`);
  } else if (item.content.kind === "draft_issue") {
    lines.push("type: draft_issue");
  }
  const status = extractStatusValue(item);
  if (status) lines.push(`status: ${status}`);
  const priority = extractFieldByName(item, "priority");
  if (priority) lines.push(`priority: ${priority}`);
  const date = extractDateField(item);
  if (date) lines.push(`date: ${date}`);
  const assignees = extractAssigneeLogins(item);
  if (assignees.length > 0) lines.push(`assignees: ${assignees.join(", ")}`);

  if (item.content.kind === "draft_issue" && item.content.body) {
    const trimmed = item.content.body.trim();
    if (trimmed.length > 0) {
      lines.push("");
      lines.push(truncate(trimmed, BODY_MAX_LEN));
    }
  }
  return lines.join("\n");
}

/**
 * Find a field value by case-insensitive name match. Returns the
 * single-select label, the text value, or `null`. Used for the user-
 * defined `Status` and `Priority` columns whose exact casing varies.
 */
function extractFieldByName(item: ProjectItem, nameLower: string): string | null {
  for (const fv of item.fieldValues) {
    if (fv.fieldName.toLowerCase() !== nameLower) continue;
    if (fv.kind === "single_select") return fv.name;
    if (fv.kind === "text") return fv.text;
    if (fv.kind === "number") return String(fv.number);
  }
  return null;
}

function extractStatusValue(item: ProjectItem): string | null {
  return extractFieldByName(item, "status");
}

/**
 * Read the first `Date`-kind field value. ProjectV2 boards
 * conventionally use `Date` as the column name; we don't pin to a
 * specific field name because boards differ ("Due date", "Target",
 * "Ship date") — the first date-typed field wins.
 */
function extractDateField(item: ProjectItem): string | null {
  for (const fv of item.fieldValues) {
    if (fv.kind === "date") return fv.date;
  }
  return null;
}

function extractAssigneeLogins(item: ProjectItem): string[] {
  for (const fv of item.fieldValues) {
    if (fv.kind === "users" && fv.fieldName.toLowerCase() === "assignees") {
      return fv.logins;
    }
  }
  return [];
}

/**
 * Map a Status column value to relay's `status` enum. Anything that
 * looks "in progress" → `in_progress`; everything else stays `open`.
 * The `done`-equivalent statuses are not mapped to `done` directly
 * here — they're handled by `fetchResolved` which closes the task
 * through the standard auto-close path (so it's undo-able via
 * `relay undo`).
 */
function mapStatus(value: string | null): "open" | "in_progress" {
  if (!value) return "open";
  const v = value.toLowerCase();
  if (v.includes("progress") || v === "doing" || v === "in review" || v === "active") {
    return "in_progress";
  }
  return "open";
}

/**
 * Map a Status column value to `wait_on`. A `Waiting`-flavoured
 * status (waiting / blocked / on hold) implies the next move is
 * outside the user; everything else stays `self`.
 */
function mapWaitOn(value: string | null): "self" | "external" {
  if (!value) return "self";
  const v = value.toLowerCase();
  if (v.includes("waiting") || v.includes("blocked") || v.includes("on hold")) {
    return "external";
  }
  return "self";
}

/**
 * Map a user-defined `Priority` column value to relay's 0-100 scale.
 * Accepts the two most common conventions (P0/P1/P2/P3 and
 * High/Medium/Low). Unknown values return null so the caller falls
 * back to the relay-wide default.
 */
function mapPriorityValue(value: string | null): number | null {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  if (v === "p0" || v === "urgent" || v === "critical") return 90;
  if (v === "p1" || v === "high") return 75;
  if (v === "p2" || v === "medium" || v === "normal") return 50;
  if (v === "p3" || v === "low") return 35;
  if (v === "p4") return 25;
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function hasProjectScope(authStatus: string): boolean {
  // `gh auth status` prints the line:
  //   - Token scopes: 'admin:public_key', 'gist', 'project', 'repo'
  // (older `gh` versions use the same format on stderr). Accept either
  // `project` (full) or `read:project` (read-only) — both grant the
  // `projectsV2` query access. Match the quoted token so substring
  // collisions (no current GitHub scope conflicts, but `admin:public_key`
  // already contains the substring `:project` — be precise).
  return /'project'/.test(authStatus) || /'read:project'/.test(authStatus);
}

// -- GraphQL plumbing --------------------------------------------------

async function fetchAllProjectItems(ctx: AdapterContext): Promise<ProjectItem[]> {
  const projects = await fetchAllProjects(ctx);
  if (projects.length === 0) return [];

  const all: ProjectItem[] = [];
  for (const project of projects) {
    let cursor: string | null = null;
    for (let page = 0; page < MAX_ITEMS_PAGES; page++) {
      const result = await fetchProjectItemsPage(project.id, cursor);
      for (const node of result.nodes) {
        const item = normaliseItem(node, project);
        if (item) all.push(item);
      }
      if (!result.hasNext || !result.endCursor) break;
      cursor = result.endCursor;
    }
  }
  return all;
}

interface ProjectMeta {
  id: string;
  title: string;
  number: number | null;
}

async function fetchAllProjects(ctx: AdapterContext): Promise<ProjectMeta[]> {
  const projects: ProjectMeta[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const result = await fetchProjectsPage(cursor);
    for (const node of result.nodes) {
      if (!node?.id || typeof node.title !== "string") continue;
      projects.push({
        id: node.id,
        title: node.title,
        number: typeof node.number === "number" ? node.number : null,
      });
    }
    if (!result.hasNext || !result.endCursor) break;
    cursor = result.endCursor;
  }
  ctx.log?.(`gh_project_card: fetched ${projects.length} projects`);
  return projects;
}

interface ProjectsPageResult {
  nodes: GraphQlProjectNode[];
  endCursor: string | null;
  hasNext: boolean;
}

interface GraphQlProjectNode {
  id?: string;
  title?: string;
  number?: number;
}

const PROJECTS_QUERY = `query($cursor: String, $pageSize: Int!) {
  viewer {
    projectsV2(first: $pageSize, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id title number }
    }
  }
}`;

async function fetchProjectsPage(cursor: string | null): Promise<ProjectsPageResult> {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${PROJECTS_QUERY}`,
    "-F",
    `pageSize=${PROJECT_PAGE_SIZE}`,
  ];
  if (cursor !== null) args.push("-f", `cursor=${cursor}`);

  const raw = await ghApiText(args);
  const parsed = JSON.parse(raw) as ProjectsGraphQlResponse;
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const first = parsed.errors[0]?.message ?? "unknown error";
    throw new Error(`graphql: ${first}`);
  }
  const conn = parsed.data?.viewer?.projectsV2;
  return {
    nodes: conn?.nodes ?? [],
    endCursor: conn?.pageInfo?.endCursor ?? null,
    hasNext: conn?.pageInfo?.hasNextPage ?? false,
  };
}

interface ProjectsGraphQlResponse {
  data?: {
    viewer?: {
      projectsV2?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: GraphQlProjectNode[];
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

interface ItemsPageResult {
  nodes: GraphQlItemNode[];
  endCursor: string | null;
  hasNext: boolean;
}

interface GraphQlItemNode {
  id?: string;
  content?: GraphQlContent;
  fieldValues?: { nodes?: GraphQlFieldValue[] };
}

interface GraphQlContent {
  __typename?: string;
  url?: string;
  title?: string;
  body?: string;
  repository?: { name?: string };
}

interface GraphQlFieldValue {
  __typename?: string;
  text?: string;
  date?: string;
  name?: string;
  number?: number;
  users?: { nodes?: Array<{ login?: string }> };
  field?: { name?: string };
}

const ITEMS_QUERY = `query($projectId: ID!, $cursor: String, $pageSize: Int!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: $pageSize, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            __typename
            ... on Issue { url title repository { name } }
            ... on PullRequest { url title repository { name } }
            ... on DraftIssue { title body }
          }
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2Field { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2Field { name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2Field { name } }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
              ... on ProjectV2ItemFieldUserValue {
                users(first: 10) { nodes { login } }
                field { ... on ProjectV2Field { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

async function fetchProjectItemsPage(
  projectId: string,
  cursor: string | null,
): Promise<ItemsPageResult> {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${ITEMS_QUERY}`,
    "-f",
    `projectId=${projectId}`,
    "-F",
    `pageSize=${ITEMS_PAGE_SIZE}`,
  ];
  if (cursor !== null) args.push("-f", `cursor=${cursor}`);

  const raw = await ghApiText(args);
  const parsed = JSON.parse(raw) as ItemsGraphQlResponse;
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const first = parsed.errors[0]?.message ?? "unknown error";
    throw new Error(`graphql: ${first}`);
  }
  const conn = parsed.data?.node?.items;
  return {
    nodes: conn?.nodes ?? [],
    endCursor: conn?.pageInfo?.endCursor ?? null,
    hasNext: conn?.pageInfo?.hasNextPage ?? false,
  };
}

interface ItemsGraphQlResponse {
  data?: {
    node?: {
      items?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: GraphQlItemNode[];
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

function normaliseItem(
  raw: GraphQlItemNode,
  project: ProjectMeta,
): ProjectItem | null {
  if (!raw.id) return null;
  const content = normaliseContent(raw.content);
  // Standalone DraftIssue with no title and no body content — silently
  // skip per the AC (rare, but observed when a card is created and
  // immediately abandoned).
  if (content.kind === "unknown") return null;
  if (
    content.kind === "draft_issue" &&
    !content.title &&
    !content.body
  ) {
    return null;
  }
  return {
    id: raw.id,
    projectId: project.id,
    projectTitle: project.title,
    projectNumber: project.number,
    content,
    fieldValues: normaliseFieldValues(raw.fieldValues?.nodes ?? []),
  };
}

function normaliseContent(raw: GraphQlContent | undefined): ProjectItem["content"] {
  if (!raw || !raw.__typename) return { kind: "unknown" };
  switch (raw.__typename) {
    case "Issue":
      return {
        kind: "issue",
        url: raw.url ?? "",
        title: raw.title,
        repository: raw.repository?.name ?? null,
      };
    case "PullRequest":
      return {
        kind: "pull_request",
        url: raw.url ?? "",
        title: raw.title,
        repository: raw.repository?.name ?? null,
      };
    case "DraftIssue":
      return {
        kind: "draft_issue",
        title: raw.title,
        body: raw.body,
      };
    default:
      return { kind: "unknown" };
  }
}

function normaliseFieldValues(raw: GraphQlFieldValue[]): FieldValue[] {
  const out: FieldValue[] = [];
  for (const fv of raw) {
    const fieldName = fv.field?.name;
    if (!fieldName) continue;
    switch (fv.__typename) {
      case "ProjectV2ItemFieldTextValue":
        if (typeof fv.text === "string") {
          out.push({ fieldName, kind: "text", text: fv.text });
        }
        break;
      case "ProjectV2ItemFieldDateValue":
        if (typeof fv.date === "string" && fv.date.length > 0) {
          out.push({ fieldName, kind: "date", date: fv.date });
        }
        break;
      case "ProjectV2ItemFieldNumberValue":
        if (typeof fv.number === "number") {
          out.push({ fieldName, kind: "number", number: fv.number });
        }
        break;
      case "ProjectV2ItemFieldSingleSelectValue":
        if (typeof fv.name === "string" && fv.name.length > 0) {
          out.push({ fieldName, kind: "single_select", name: fv.name });
        }
        break;
      case "ProjectV2ItemFieldUserValue": {
        const logins = (fv.users?.nodes ?? [])
          .map((n) => n.login)
          .filter((l): l is string => typeof l === "string" && l.length > 0);
        if (logins.length > 0) {
          out.push({ fieldName, kind: "users", logins });
        }
        break;
      }
      default:
        // Unknown field-value type — skip silently. GitHub adds new
        // field types over time (iterations, etc.); the adapter
        // ignores them rather than erroring.
        break;
    }
  }
  return out;
}

/**
 * Spawn `gh <args>` and return stdout as a raw string. Throws on
 * non-zero exit. Mirrors the helper in `orphan-branch.ts` so the
 * GraphQL error envelope can be parsed by the caller.
 */
function ghApiText(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
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
