import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import toml from "@iarna/toml";
import { z } from "zod";
import { CONFIG_PATH, expandHome } from "./paths.js";

const ConfigSchema = z.object({
  scan: z
    .object({
      roots: z.array(z.string()).default(["~/repos/github.com"]),
      exclude: z
        .array(z.string())
        .default(["node_modules", "vendor", ".next", "dist", "target", ".git"]),
      max_depth: z.number().int().positive().default(2),
      tracked_repos: z.array(z.string()).default([]),
    })
    .default({}),
  github: z
    .object({
      user: z.string().optional(),
      orgs: z.array(z.string()).default([]),
      // ProjectV2 sub-config — only consulted by the `gh_project_card`
      // adapter. Kept under `[github]` so the related ProjectV2 knobs
      // live next to `user` / `orgs` rather than scattering them.
      project_v2: z
        .object({
          // Sentinel `repo` value used for standalone DraftIssue
          // cards (no linked Issue/PR). `repo TEXT NOT NULL` in the
          // schema rejects empty strings, so we must pick *some*
          // string. `"__inbox__"` is conspicuously not a valid repo
          // directory name (double-underscore is unusual on disk)
          // and is treated as a normal repo name everywhere else —
          // no special-casing in API/UI/db. Users running a literal
          // inbox repo can repoint here (e.g. `fallback_repo = "inbox"`).
          fallback_repo: z.string().min(1).default("__inbox__"),
        })
        .default({}),
    })
    .default({}),
  agents: z
    .object({
      default: z.string().default("claude-code"),
      claude_bin: z.string().default("claude"),
      codex_bin: z.string().default("codex"),
      gemini_bin: z.string().default("gemini"),
    })
    .default({}),
  ui: z
    .object({
      default_view: z.string().default("today"),
      today_limit: z.number().int().positive().default(5),
      priority_decay_days: z.number().int().nonnegative().default(14),
    })
    .default({}),
  daemon: z
    .object({
      enabled: z.boolean().default(false),
      interval_sec: z.number().int().positive().default(300),
    })
    .default({}),
  adapters: z
    .object({
      code_todo: z.boolean().default(true),
      github_issue: z.boolean().default(true),
      github_pr: z.boolean().default(true),
      gh_notification: z.boolean().default(true),
      gh_run_failure: z.boolean().default(true),
      // ProjectV2 adapter is OFF by default. Card ingest requires the
      // `read:project` (or `project`) token scope which most relay
      // users don't have and don't need — only users who actively
      // organise work in GitHub Project v2 boards benefit. Opt-in via
      // `[adapters].gh_project_card = true` after
      // `gh auth refresh -h github.com -s project`.
      gh_project_card: z.boolean().default(false),
      git_interrupted: z.boolean().default(true),
      git_stash: z.boolean().default(true),
      orphan_branch: z.boolean().default(true),
      claude_session: z.boolean().default(true),
      codex_session: z.boolean().default(true),
      gemini_session: z.boolean().default(true),
      // Cursor adapter is OFF by default. Cursor chats can carry private
      // prompts / credentials in plain text on disk; users must opt in
      // explicitly. Same posture as the other "Cursor data is local-only
      // but unstable" caveats — set `cursor_session = true` after reading
      // SPEC.md §6 `cursor-session`.
      cursor_session: z.boolean().default(false),
      agents_note: z.boolean().default(true),
      // `manual` is a no-op adapter registered for registry symmetry — see
      // `src/adapters/manual.ts` and SPEC.md §6. The flag exists so users can
      // hide the SKIPPED row from `relay sync` output by setting
      // `[adapters].manual = false`. Default `true` keeps the row visible
      // (observability beats silent omission).
      manual: z.boolean().default(true),
    })
    .default({}),
  claude_session: z
    .object({
      exclude_patterns: z.array(z.string()).default([]),
      store_body: z.boolean().default(true),
      lookback_days: z.number().int().positive().default(7),
    })
    .default({}),
  codex_session: z
    .object({
      exclude_patterns: z.array(z.string()).default([]),
      store_body: z.boolean().default(true),
      lookback_days: z.number().int().positive().default(7),
    })
    .default({}),
  gemini_session: z
    .object({
      exclude_patterns: z.array(z.string()).default([]),
      store_body: z.boolean().default(true),
      lookback_days: z.number().int().positive().default(7),
    })
    .default({}),
  cursor_session: z
    .object({
      exclude_patterns: z.array(z.string()).default([]),
      // Default OFF: Cursor chat sqlite holds user prompts in proto-encoded
      // form (not human-readable on inspection but trivially decodable). The
      // adapter's plan-file primary path doesn't need a body either, so the
      // safest default is "no body, no chat-meta secondary tasks". Opt in
      // by setting `store_body = true`.
      store_body: z.boolean().default(false),
      // 14 days vs 7 for codex/gemini because Cursor plans persist on disk
      // until manually deleted, so a tighter window would still surface
      // months-old todos every sync.
      lookback_days: z.number().int().positive().default(14),
    })
    .default({}),
  gh_run_failure: z
    .object({
      // Default OFF: log-failed retrieval costs an extra `gh run view` per
      // failing run and the captured stdout sometimes echoes secrets or
      // local paths. Users who want richer task bodies must opt in.
      store_body: z.boolean().default(false),
    })
    .default({}),
  git_stash: z
    .object({
      // Default OFF: `git stash show --stat <oid>` costs an extra subprocess
      // per stash and the captured diffstat occasionally exposes private
      // file paths or hints at uncommitted secrets. Users who want richer
      // task bodies (so `relay show` shows the touched files) must opt in.
      store_body: z.boolean().default(false),
    })
    .default({}),
  gh_project_card: z
    .object({
      // ProjectV2 boards have user-defined `Status` columns and the
      // "complete" column is variously named `Done` / `Completed` /
      // `Closed` / `Shipped` depending on the project's convention.
      // Adapter compares case-insensitively against this list when
      // deciding whether to emit a card to `fetchResolved`. Users
      // with custom column names (e.g. `Released`, `Shipped 🚀`)
      // should override the full list.
      done_statuses: z
        .array(z.string())
        .default(["Done", "Completed", "Closed", "Shipped"]),
    })
    .default({}),
  orphan_branch: z
    .object({
      // Default OFF: `git log --oneline ${base}..${branch}` can echo
      // sensitive commit subjects (internal repo names, customer IDs,
      // accidental WIP secrets). Without this flag the body still
      // carries branch/tip/upstream/age metadata.
      store_body: z.boolean().default(false),
      // Branch globs to skip. Defaults to `release/*` + `hotfix/*` —
      // long-lived collaborative refs that are protected by convention
      // and would otherwise generate noise on every sync.
      exclude_patterns: z
        .array(z.string())
        .default(["release/*", "hotfix/*"]),
    })
    .default({}),
  close_hints: z
    .array(
      z.object({
        match: z.string().min(1),
        command: z.string().min(1),
      }),
    )
    .default([]),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string = CONFIG_PATH): Config {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return ConfigSchema.parse({});
  }
  const parsed = toml.parse(raw);
  return ConfigSchema.parse(parsed);
}

export function resolveScanRoots(cfg: Config): string[] {
  return cfg.scan.roots.map(expandHome);
}

/**
 * Atomically update scan.tracked_repos in config.toml.
 * Uses @iarna/toml for round-trip parsing to preserve all other settings.
 * Writes to a tmp file then renames for atomic replacement.
 */
export function saveTrackedRepos(repos: string[], path: string = CONFIG_PATH): void {
  // Read existing raw TOML (or start from empty object)
  let raw: toml.JsonMap = {};
  if (existsSync(path)) {
    try {
      raw = toml.parse(readFileSync(path, "utf8")) as toml.JsonMap;
    } catch {
      // If parse fails, keep existing structure empty and overwrite
    }
  }

  // Ensure [scan] section exists
  if (typeof raw["scan"] !== "object" || raw["scan"] === null || Array.isArray(raw["scan"])) {
    raw["scan"] = {} as toml.JsonMap;
  }
  (raw["scan"] as toml.JsonMap)["tracked_repos"] = repos;

  const serialized = toml.stringify(raw);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, serialized, "utf8");
  renameSync(tmpPath, path);
}
