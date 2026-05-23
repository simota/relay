// Cross-CLI skill-usage extraction.
//
// "Skill" here means a named SKILL.md agent (nexus / guardian / vision / ...)
// that the user or assistant invoked. Each CLI exposes this differently:
//
//   Claude Code  — assistant `tool_use(name="Skill", input.skill=…)`;
//                  user message `<command-name>/<name></command-name>`;
//                  subagent spawn via `Agent` whose prompt references
//                  `~/.claude/skills/<name>/SKILL.md` (or the kana/english
//                  "あなたは X エージェント" / "You are the X agent" pattern
//                  when the SKILL.md path isn't templated in).
//   Codex CLI    — `session_meta.source.subagent: "<name>"` when this
//                  session was itself spawned as a skill subagent.
//                  Within-session skill use is observable via `spawn_agent`
//                  whose arguments reference `~/.codex/skills/<name>/SKILL.md`.
//   Antigravity  — `<SKILL>The user has explicitly invoked the (<name>) skill\.`
//                  marker the CLI injects into `USER_INPUT.content` after a
//                  `/<name>` slash command. Bare `/<name>` (when the meta
//                  block isn't expanded) is detected as a fallback.
//
// All detected names are cross-checked against an on-disk skill registry
// (~/.claude/skills, ~/.codex/skills, ~/.gemini/skills) so typos / one-off
// slash commands like `/foo` don't pollute the panel. Registry scan is
// best-effort: a missing or unreadable dir falls back to "no filter" so
// extraction degrades gracefully on minimal install layouts.
//
// Output is one `SessionSkillUse` per (name, source) pair with counts and
// first/last timestamps. Order is deterministic (sorted by source then
// descending count then name) so downstream UIs can rely on it.

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SessionSkillChainEdge,
  SessionSkillSource,
  SessionSkillUse,
} from "../sessions/types.js";

// ---------------------------------------------------------------------------
// Shared aggregator
// ---------------------------------------------------------------------------

interface SkillEvent {
  name: string;
  source: SessionSkillSource;
  ts: string;
  args?: string | null;
  /** Pre-extracted recipe hint (first token of args), passed through to aggregate. */
  recipe?: string | null;
  /** Per-event status. "failed" propagates if any matching tool_result was an error. */
  status?: "success" | "failed" | null;
}

function aggregate(events: SkillEvent[]): SessionSkillUse[] {
  const known = getKnownSkills();
  const map = new Map<string, SessionSkillUse>();
  for (const ev of events) {
    const name = normalizeSkillName(ev.name, ev.source);
    if (!name) continue;
    // Registry filter: when the scanner found ≥1 skill dir on disk, drop
    // names that don't match (filters typos like `/foo`, `/test`). When
    // the registry is empty (fresh install / missing dirs), pass through
    // — fail-open keeps the panel functional on bare layouts.
    if (known.size > 0 && !known.has(name)) continue;
    const recipe = ev.recipe ?? extractRecipeFromArgs(ev.args);
    const key = `${ev.source}|${name}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (ev.ts && ev.ts > existing.last_ts) {
        existing.last_ts = ev.ts;
        // "Latest" status follows the latest ts so the panel reflects
        // the most recent outcome, not the worst observed one.
        if (ev.status !== undefined) existing.last_status = ev.status ?? null;
      }
      if (ev.ts && (existing.first_ts === "" || ev.ts < existing.first_ts)) {
        existing.first_ts = ev.ts;
      }
      if (ev.args !== undefined && ev.args !== null && ev.args !== "") {
        existing.last_args = truncate(ev.args, 200);
      }
      if (recipe) existing.recipe = recipe;
    } else {
      map.set(key, {
        name,
        source: ev.source,
        first_ts: ev.ts ?? "",
        last_ts: ev.ts ?? "",
        count: 1,
        last_args: ev.args ? truncate(ev.args, 200) : null,
        recipe,
        last_status: ev.status ?? null,
        is_first_use_in_session: false,
      });
    }
  }
  const out = [...map.values()].sort((a, b) => {
    const so = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
    if (so !== 0) return so;
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
  markFirstUse(out);
  return out;
}

/**
 * Mark the aggregate entry tied to the chronologically-earliest first_ts
 * for each skill name as `is_first_use_in_session: true`. Used by the UI
 * to play a louder fanfare on a skill the session has never touched
 * before. When two entries tie on first_ts, the lower-ordered source wins
 * (slash_command before skill_tool before subagent), keeping the choice
 * deterministic.
 */
function markFirstUse(entries: SessionSkillUse[]): void {
  const firstByName = new Map<string, SessionSkillUse>();
  for (const e of entries) {
    const current = firstByName.get(e.name);
    if (!current) {
      firstByName.set(e.name, e);
      continue;
    }
    if (!e.first_ts) continue;
    if (!current.first_ts || e.first_ts < current.first_ts) {
      firstByName.set(e.name, e);
    } else if (e.first_ts === current.first_ts) {
      if (SOURCE_ORDER[e.source] < SOURCE_ORDER[current.source]) {
        firstByName.set(e.name, e);
      }
    }
  }
  for (const e of firstByName.values()) {
    e.is_first_use_in_session = true;
  }
}

/**
 * Pull a recipe hint out of the args string passed to a Skill tool. The
 * convention `args="apex …"` / `args="classify recipe — ..."` means the
 * first kebab-case token is the recipe (apex / classify / bug / etc).
 * Anything that doesn't look like a kebab-case word returns null so the
 * UI doesn't display garbage like `nexus(セッションの)`.
 */
function extractRecipeFromArgs(args: string | null | undefined): string | null {
  if (!args) return null;
  const trimmed = args.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([a-z][a-z0-9-]{1,30})\b/i);
  if (!match || !match[1]) return null;
  const recipe = match[1].toLowerCase();
  // Reject anything that's clearly not a recipe name (numbers, common
  // English connectors, …).
  if (RECIPE_STOPWORDS.has(recipe)) return null;
  return recipe;
}

const RECIPE_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "with",
  "from",
  "this",
  "that",
  "please",
  "now",
  "here",
  "what",
  "why",
  "how",
]);

const SOURCE_ORDER: Record<SessionSkillSource, number> = {
  slash_command: 0,
  skill_tool: 1,
  subagent: 2,
  session_meta: 3,
};

// Built-in CLI slash commands that share the `/foo` namespace but are not
// SKILL.md agents. Filtered ONLY for `slash_command` source — `skill_tool`,
// `subagent`, and `session_meta` sources are explicit and trustworthy
// (e.g. Codex's `session_meta.source.subagent: "review"` IS the review
// skill, not the built-in `/review` command).
//
// Even with the registry filter active, this list catches built-ins whose
// name happens to collide with a real skill (e.g. some users install a
// `review` skill — the slash command still routes to the built-in).
const BUILTIN_SLASH_COMMANDS = new Set([
  "init",
  "clear",
  "compact",
  "help",
  "model",
  "config",
  "doctor",
  "login",
  "logout",
  "exit",
  "quit",
  "memory",
  "remember",
  "schedule",
  "loop",
  "fast",
  "context",
  "agents",
  "vim",
  "release-notes",
  "ide",
  "mcp",
  "permissions",
  "resume",
  "status",
  "statusline",
  "verify",
  "run",
  "cost",
  "pr-comments",
  "pr_comments",
  "bug",
  "logout",
  "upgrade",
  "hooks",
  "terminal-setup",
  "approved-tools",
]);

// Well-known placeholder names that show up when someone smoke-tests a
// slash command (`/foo`, `/test`) but never resolve to a real skill. The
// registry check usually covers these, but keep the explicit list so
// extraction stays clean on systems without a known skill registry.
const PLACEHOLDER_NAMES = new Set([
  "foo",
  "bar",
  "baz",
  "qux",
  "test",
  "tests",
  "todo",
  "hoge",
  "fuga",
  "piyo",
  "abc",
  "xyz",
  "sample",
  "example",
  "demo",
]);

// Codex CLI built-in function names + common MCP tool names. These can
// occasionally surface in the Agent / spawn_agent prompt text (e.g. a
// retrieved file dump or a copy-pasted shell session). Reject them
// regardless of source so they never sneak past the registry filter.
const TOOL_NAME_DENYLIST = new Set([
  "exec_command",
  "apply_patch",
  "update_plan",
  "view_image",
  "write_stdin",
  "spawn_agent",
  "send_input",
  "wait_agent",
  "resume_agent",
  "close_agent",
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "view_file",
  "list_dir",
  "run_command",
  "general-purpose",
  "explore",
  "plan",
]);

/**
 * Normalize visually-distinct slash forms (fullwidth ／, leading
 * whitespace, leading `@`) into the canonical lowercase ASCII slug.
 */
function normalizeRawName(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .replace(/^[@/／]+/, "")
    .toLowerCase();
}

function normalizeSkillName(raw: string, source: SessionSkillSource): string {
  const s = normalizeRawName(raw);
  if (!s) return "";
  // Skill names are 3–40 chars, kebab-case, start with a letter. The
  // 3-char minimum drops `/x`, `/qq`, and similar smoke-tests that pass
  // the loose 1+ char check.
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(s)) return "";
  // Reject names with consecutive dashes or trailing dash — never appear
  // in real `~/.claude/skills/<name>/` directory names.
  if (s.includes("--") || s.endsWith("-")) return "";
  if (PLACEHOLDER_NAMES.has(s)) return "";
  if (TOOL_NAME_DENYLIST.has(s)) return "";
  if (source === "slash_command" && BUILTIN_SLASH_COMMANDS.has(s)) return "";
  return s;
}

// ---------------------------------------------------------------------------
// On-disk skill registry — used by `aggregate()` to filter out non-skill
// names. Lazily scanned once per process and cached.
// ---------------------------------------------------------------------------

let knownSkillsCache: Set<string> | null = null;

/**
 * Union of skill names installed under any known CLI skill directory.
 * Used as a soft validation layer (`aggregate()` drops names not in the
 * set when the set is non-empty).
 *
 * Scanned directories:
 *   - `~/.claude/skills/<name>/SKILL.md`
 *   - `~/.codex/skills/<name>/SKILL.md`
 *   - `~/.codex/skills/.system/<name>/SKILL.md`
 *   - `~/.gemini/skills/<name>/SKILL.md`
 *
 * Returns an empty set when every dir is missing or unreadable so callers
 * can detect "registry unavailable, skip filter" without exception
 * handling. Exposed for tests.
 */
export function getKnownSkills(): Set<string> {
  if (knownSkillsCache) return knownSkillsCache;
  const out = new Set<string>();
  const home = homedir();
  const roots = [
    join(home, ".claude", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".codex", "skills", ".system"),
    join(home, ".gemini", "skills"),
  ];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Skip dotted bookkeeping dirs (_catalog, _common, .system, …)
      if (!entry || entry.startsWith(".") || entry.startsWith("_")) continue;
      const name = entry.toLowerCase();
      if (!/^[a-z][a-z0-9-]{2,40}$/.test(name)) continue;
      // Confirm the dir actually carries a SKILL.md — guards against stale
      // directories left by uninstalls.
      try {
        statSync(join(root, entry, "SKILL.md"));
      } catch {
        continue;
      }
      out.add(name);
    }
  }
  knownSkillsCache = out;
  return out;
}

/**
 * Test/debug seam: reset the cached registry so the next call re-scans
 * the filesystem. Production code should not need this.
 */
export function resetKnownSkillsCacheForTests(): void {
  knownSkillsCache = null;
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

const CLAUDE_SKILL_PATH_RE = /(?:^|[\s'"`(])(?:~\/|\$HOME\/|\.)?\.claude\/skills\/([a-z][a-z0-9-]{2,40})\/SKILL\.md/g;
const CLAUDE_COMMAND_NAME_RE = /<command-name>\s*\/?([a-z][a-z0-9-]{2,40})\s*<\/command-name>/gi;
// Captures the body that follows the slash command name. When the very
// first token is kebab-case ASCII it gets surfaced as the recipe (e.g.
// `/nexus apex …` → recipe = "apex").
const CLAUDE_COMMAND_ARGS_RE = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/i;

// Fallback patterns for `Agent` spawn prompts whose body identifies the
// agent without referencing the SKILL.md path. Two shapes occur in real
// data: Japanese ("あなたは Spark エージェントです") and English ("You are
// the Spark agent"). The capture group is normalised then validated by
// the registry filter, so a freeform line like "You are the senior agent"
// gets dropped at aggregation rather than creating fake skills.
const CLAUDE_AGENT_PERSONA_JA_RE = /あなたは\s*([A-Za-z][A-Za-z0-9-]{2,40})\s*エージェント/g;
const CLAUDE_AGENT_PERSONA_EN_RE = /You are (?:the\s+)?([A-Za-z][A-Za-z0-9-]{2,40})\s+(?:agent|skill|specialist|orchestrator)\b/g;

/**
 * Pre-scan a Claude JSONL for `tool_result` blocks and produce a map
 * `tool_use_id → "success" | "failed"`. `is_error: true` (or a sentinel
 * "Error" / "Failed" prefix in the content body) flips the entry to
 * "failed"; everything else stays "success". Unmatched tool_use_ids
 * (no result observed) are absent from the map so the caller can keep
 * `last_status: null`.
 */
function collectToolResultStatuses(text: string): Map<string, "success" | "failed"> {
  const map = new Map<string, "success" | "failed">();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
    const content = (wrapper as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "tool_result") continue;
      const id = typeof b.tool_use_id === "string" ? b.tool_use_id : null;
      if (!id) continue;
      const explicitError = b.is_error === true;
      // Some adapters wrap the body in a string instead of using
      // is_error; detect the common "Error:" / "Failed:" prefixes so we
      // don't miss those.
      const bodyError = (() => {
        const c = b.content;
        if (typeof c === "string") return /^(error|failed)\b[:\s]/i.test(c.trim());
        if (Array.isArray(c)) {
          for (const part of c) {
            if (part && typeof part === "object") {
              const p = part as Record<string, unknown>;
              if (typeof p.text === "string" && /^(error|failed)\b[:\s]/i.test(p.text.trim())) {
                return true;
              }
            }
          }
        }
        return false;
      })();
      map.set(id, explicitError || bodyError ? "failed" : "success");
    }
  }
  return map;
}

/**
 * Walk the same Claude JSONL but only emit parent→child edges. A "parent"
 * is whichever skill is in conversational scope when the model spawns an
 * Agent/Task tool. Scope is set by either an explicit `<command-name>`
 * user invocation or an assistant `Skill(...)` call, and reset on each
 * user turn that doesn't carry a `<command-name>`.
 *
 * Returns edges in chronological order. Duplicate (parent, child) pairs
 * are preserved so a chain that fans-out twice shows two edges (each with
 * its own ts) — downstream UIs can dedup if they want to.
 */
export function extractClaudeSkillChains(text: string): SessionSkillChainEdge[] {
  const known = getKnownSkills();
  const edges: SessionSkillChainEdge[] = [];
  let currentSkill: string | null = null;

  const isValid = (raw: string): string | null => {
    const n = normalizeSkillName(raw, "skill_tool");
    if (!n) return null;
    if (known.size > 0 && !known.has(n)) return null;
    return n;
  };

  for (const line of text.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
    const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
    const role = (wrapper as Record<string, unknown>).role;
    const content = (wrapper as Record<string, unknown>).content;

    if (role === "user") {
      // Only switch scope on an explicit `<command-name>` slash command.
      // Natural-language follow-ups (the user collaborating with the
      // in-flight skill) and tool_result injections both keep the
      // current scope intact — losing it on every user word would defeat
      // the chain detector for any /nexus session with mid-flight
      // clarification turns. Switching to a new built-in (init/clear/…)
      // is treated as "back to plain mode" (currentSkill = null).
      let scanText = "";
      if (typeof content === "string") {
        scanText = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            scanText += b.text + "\n";
          }
        }
      }
      const m = scanText.match(/<command-name>\s*\/?([a-z][a-z0-9-]{2,40})\s*<\/command-name>/i);
      if (m?.[1]) {
        const raw = m[1].toLowerCase();
        const valid = isValid(raw);
        if (valid) {
          currentSkill = valid;
        } else if (BUILTIN_SLASH_COMMANDS.has(raw)) {
          // /init, /clear, /compact … return us to plain mode.
          currentSkill = null;
        }
      }
      continue;
    }

    if (role !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "tool_use" || typeof b.name !== "string") continue;
      const input =
        b.input && typeof b.input === "object"
          ? (b.input as Record<string, unknown>)
          : {};
      if (b.name === "Skill" && typeof input.skill === "string") {
        const valid = isValid(input.skill);
        if (valid) currentSkill = valid;
      } else if (b.name === "Agent" || b.name === "Task") {
        if (!currentSkill) continue;
        const prompt = typeof input.prompt === "string" ? input.prompt : "";
        const childrenFound = new Set<string>();
        for (const m of prompt.matchAll(CLAUDE_SKILL_PATH_RE)) {
          const child = isValid(m[1] ?? "");
          if (child) childrenFound.add(child);
        }
        if (childrenFound.size === 0) {
          for (const re of [CLAUDE_AGENT_PERSONA_JA_RE, CLAUDE_AGENT_PERSONA_EN_RE]) {
            for (const m of prompt.matchAll(re)) {
              const child = isValid(m[1] ?? "");
              if (child) childrenFound.add(child);
            }
          }
        }
        if (childrenFound.size === 0 && typeof input.subagent_type === "string") {
          const child = isValid(input.subagent_type);
          if (child) childrenFound.add(child);
        }
        for (const child of childrenFound) {
          if (child === currentSkill) continue; // self-loop suppressed
          edges.push({ parent: currentSkill, child, ts });
        }
      }
    }
  }
  return edges;
}

export function extractClaudeSkills(text: string): SessionSkillUse[] {
  const events: SkillEvent[] = [];
  // First pass collects tool_result statuses keyed by tool_use_id so the
  // Skill tool_use loop below can attach an outcome ("failed" when
  // `is_error: true` was returned, "success" otherwise). Built ahead of
  // the main pass because tool_use_id ordering is forward-only and the
  // result lands on a later line than the call itself.
  const resultStatus = collectToolResultStatuses(text);
  for (const line of text.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
    const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
    const content = (wrapper as Record<string, unknown>).content;

    if (typeof content === "string") {
      const argsBody = content.match(CLAUDE_COMMAND_ARGS_RE)?.[1] ?? null;
      for (const match of content.matchAll(CLAUDE_COMMAND_NAME_RE)) {
        const name = match[1];
        if (name) events.push({ name, source: "slash_command", ts, args: argsBody });
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        const blockType = b.type;
        if (blockType === "text" && typeof b.text === "string") {
          const argsBody = b.text.match(CLAUDE_COMMAND_ARGS_RE)?.[1] ?? null;
          for (const match of b.text.matchAll(CLAUDE_COMMAND_NAME_RE)) {
            const name = match[1];
            if (name) events.push({ name, source: "slash_command", ts, args: argsBody });
          }
        } else if (blockType === "tool_use" && typeof b.name === "string") {
          const input =
            b.input && typeof b.input === "object"
              ? (b.input as Record<string, unknown>)
              : {};
          if (b.name === "Skill" && typeof input.skill === "string") {
            const args = typeof input.args === "string" ? input.args : null;
            const toolUseId = typeof b.id === "string" ? b.id : null;
            const status = toolUseId ? (resultStatus.get(toolUseId) ?? null) : null;
            events.push({ name: input.skill, source: "skill_tool", ts, args, status });
          } else if (b.name === "Agent" || b.name === "Task") {
            // Spawn template references the agent's SKILL.md by path. When
            // that path isn't present we fall back to persona declarations
            // ("あなたは X エージェントです" / "You are the X agent") in
            // the prompt body, or finally the `subagent_type` field.
            // Registry filter at aggregate() drops any false positives the
            // persona / subagent_type patterns might capture.
            const prompt = typeof input.prompt === "string" ? input.prompt : "";
            const desc = typeof input.description === "string" ? input.description : null;
            const found = new Set<string>();
            for (const match of prompt.matchAll(CLAUDE_SKILL_PATH_RE)) {
              const name = match[1];
              if (name) {
                found.add(name);
                events.push({ name, source: "subagent", ts, args: desc });
              }
            }
            if (found.size === 0) {
              for (const re of [CLAUDE_AGENT_PERSONA_JA_RE, CLAUDE_AGENT_PERSONA_EN_RE]) {
                for (const match of prompt.matchAll(re)) {
                  const name = match[1];
                  if (name && !found.has(name.toLowerCase())) {
                    found.add(name.toLowerCase());
                    events.push({ name, source: "subagent", ts, args: desc });
                  }
                }
              }
            }
            if (found.size === 0 && typeof input.subagent_type === "string") {
              // Last-resort: when the user templated a custom agent via
              // `subagent_type: "<skill>"` directly. Registry filter
              // drops the built-in "general-purpose" / "Explore" values.
              events.push({
                name: input.subagent_type,
                source: "subagent",
                ts,
                args: desc,
              });
            }
          }
        }
      }
    }
  }
  return aggregate(events);
}

// ---------------------------------------------------------------------------
// Codex CLI
// ---------------------------------------------------------------------------

const CODEX_SKILL_PATH_RE = /(?:^|[\s'"`(])(?:~\/|\$HOME\/|\.)?\.codex\/skills\/(?:\.system\/)?([a-z][a-z0-9-]{2,40})\/SKILL\.md/g;

export function extractCodexSkills(text: string): SessionSkillUse[] {
  const events: SkillEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
    const payload = (obj.payload ?? {}) as Record<string, unknown>;

    if (obj.type === "session_meta") {
      // Whole session is a skill subagent: source.subagent === "<skill>".
      // Older session_meta variants used a nested thread_spawn block too.
      const source = payload.source;
      if (source && typeof source === "object") {
        const s = source as Record<string, unknown>;
        if (typeof s.subagent === "string") {
          events.push({ name: s.subagent, source: "session_meta", ts });
        } else if (s.subagent && typeof s.subagent === "object") {
          const sub = s.subagent as Record<string, unknown>;
          if (typeof sub.name === "string") {
            events.push({ name: sub.name, source: "session_meta", ts });
          }
        }
      }
      continue;
    }

    // Codex slash commands appear unmolested in user_message text — they
    // aren't expanded the way Claude wraps them in <command-name> tags.
    // Limit to a name at the start of the message body to avoid catching
    // every `/foo` mention in pasted file paths.
    if (
      obj.type === "event_msg" &&
      (payload as Record<string, unknown>).type === "user_message"
    ) {
      const msg = (payload as Record<string, unknown>).message;
      if (typeof msg === "string") {
        const match = msg.trimStart().match(/^\/([a-z][a-z0-9-]{2,40})\b/);
        if (match?.[1]) {
          events.push({ name: match[1], source: "slash_command", ts });
        }
      }
    }

    if (obj.type === "response_item" && payload.type === "function_call") {
      const name = typeof payload.name === "string" ? payload.name : "";
      if (name === "spawn_agent") {
        // Args is a JSON-encoded string. Pull the SKILL.md reference out,
        // or fall back to the persona declarations (registry-validated).
        const args = typeof payload.arguments === "string" ? payload.arguments : "";
        const found = new Set<string>();
        for (const match of args.matchAll(CODEX_SKILL_PATH_RE)) {
          const skillName = match[1];
          if (skillName) {
            found.add(skillName);
            events.push({ name: skillName, source: "subagent", ts });
          }
        }
        if (found.size === 0) {
          for (const re of [CLAUDE_AGENT_PERSONA_JA_RE, CLAUDE_AGENT_PERSONA_EN_RE]) {
            for (const match of args.matchAll(re)) {
              const skillName = match[1];
              if (skillName && !found.has(skillName.toLowerCase())) {
                found.add(skillName.toLowerCase());
                events.push({ name: skillName, source: "subagent", ts });
              }
            }
          }
        }
      }
    }
  }
  return aggregate(events);
}

// ---------------------------------------------------------------------------
// Antigravity CLI
// ---------------------------------------------------------------------------

// The CLI expands `/foo` into a `<SKILL>The user has explicitly invoked the
// (foo) skill\.` block inside USER_INPUT.content. We match the parenthesized
// name (followed by the literal "skill") to avoid catching unrelated
// parenthesized text.
const ANTIGRAVITY_SKILL_INVOKE_RE =
  /<SKILL>\s*The user has explicitly invoked the\s*\(([a-z][a-z0-9-]{2,40})\)\s*skill/g;

// Fallback: bare `/<name>` at the start of <USER_REQUEST> (the CLI sometimes
// elides the SKILL meta block for unknown / unconfigured names). The
// registry filter prevents this from inflating with arbitrary mentions
// elsewhere in the request body, but we still anchor to the start of the
// extracted request to avoid false positives in inline code snippets.
const ANTIGRAVITY_USER_REQUEST_RE = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/;
const ANTIGRAVITY_BARE_SLASH_RE = /(?:^|\s)\/([a-z][a-z0-9-]{2,40})\b/g;

interface AntigravityEntry {
  type?: string;
  source?: string;
  created_at?: string;
  content?: string;
}

export function extractAntigravitySkills(text: string): SessionSkillUse[] {
  const events: SkillEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: AntigravityEntry;
    try {
      entry = JSON.parse(trimmed) as AntigravityEntry;
    } catch {
      continue;
    }
    if (entry.type !== "USER_INPUT" || typeof entry.content !== "string") continue;
    const ts = typeof entry.created_at === "string" ? entry.created_at : "";
    const seen = new Set<string>();
    for (const match of entry.content.matchAll(ANTIGRAVITY_SKILL_INVOKE_RE)) {
      const name = match[1];
      if (name) {
        seen.add(name.toLowerCase());
        events.push({ name, source: "slash_command", ts });
      }
    }
    // Fallback to bare /<name> in the <USER_REQUEST> body when the SKILL
    // meta block wasn't injected. Limit the scan to the request body so a
    // stray "/" in a code snippet inside ADDITIONAL_METADATA can't trigger.
    const requestMatch = entry.content.match(ANTIGRAVITY_USER_REQUEST_RE);
    const requestBody = requestMatch?.[1] ?? "";
    if (requestBody) {
      for (const match of requestBody.matchAll(ANTIGRAVITY_BARE_SLASH_RE)) {
        const name = match[1];
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          events.push({ name, source: "slash_command", ts });
        }
      }
    }
  }
  return aggregate(events);
}

// ---------------------------------------------------------------------------
// SessionSummary.skills_used helper
// ---------------------------------------------------------------------------

/**
 * Distinct skill names across all sources, ordered by descending total
 * usage. Used to populate `SessionSummary.skills_used`.
 */
export function distinctSkillNames(skills: SessionSkillUse[], limit = 20): string[] {
  const totals = new Map<string, number>();
  for (const s of skills) {
    totals.set(s.name, (totals.get(s.name) ?? 0) + s.count);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}
