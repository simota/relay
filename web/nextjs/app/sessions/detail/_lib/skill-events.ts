// Per-invocation skill events for the sequence-lane timeline.
//
// SessionDetail.skills is aggregated (one row per (source, name) pair) and
// is great for the side panel — but the timeline needs every invocation
// with its own timestamp. We re-derive those events here from the data
// already on the client (messages + tool_calls) so the API payload doesn't
// grow.
//
// Mirrors the detection rules in `src/lib/session-skills.ts` (server side).
// Keep the regexes / built-in filter in sync if either side changes.
//
// `validNames` (when provided) acts as the same registry filter the server
// applies — derived from `SessionDetail.skills` so the timeline can't
// surface skill names the panel suppressed. Pass `null` to skip filtering
// (used in unit tests).

import type {
  SessionMessage,
  SessionSkillSource,
  SessionSkillUse,
  SessionToolCall,
} from "@/lib/api";

export interface SkillTimelineEvent {
  ts: string;
  name: string;
  source: SessionSkillSource;
  /** Short label / arg snippet for tooltips. */
  detail: string | null;
}

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
  "upgrade",
  "hooks",
  "terminal-setup",
  "approved-tools",
]);

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

// Mirror of the server-side TOOL_NAME_DENYLIST. Mainly defends timeline
// extraction on rows where the server-side registry filter would have
// dropped these, but lookback windows are tight enough that an old row
// might leak through.
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

const COMMAND_NAME_RE = /<command-name>\s*\/?([a-z][a-z0-9-]{2,40})\s*<\/command-name>/gi;
const CLAUDE_SKILL_PATH_RE = /(?:^|[\s'"`(])(?:~\/|\$HOME\/|\.)?\.claude\/skills\/([a-z][a-z0-9-]{2,40})\/SKILL\.md/g;
const CODEX_SKILL_PATH_RE = /(?:^|[\s'"`(])(?:~\/|\$HOME\/|\.)?\.codex\/skills\/(?:\.system\/)?([a-z][a-z0-9-]{2,40})\/SKILL\.md/g;
const ANTIGRAVITY_SKILL_INVOKE_RE =
  /<SKILL>\s*The user has explicitly invoked the\s*\(([a-z][a-z0-9-]{2,40})\)\s*skill/g;
const AGENT_PERSONA_JA_RE = /あなたは\s*([A-Za-z][A-Za-z0-9-]{2,40})\s*エージェント/g;
const AGENT_PERSONA_EN_RE = /You are (?:the\s+)?([A-Za-z][A-Za-z0-9-]{2,40})\s+(?:agent|skill|specialist|orchestrator)\b/g;

function normalize(name: string, source: SessionSkillSource): string {
  // NFKC absorbs fullwidth ／ / @ variants into ASCII so `/Nexus`, `／nexus`
  // `@nexus` and Codex's `$nexus` all collapse to the same slug.
  const s = name.normalize("NFKC").trim().replace(/^[@/／$]+/, "").toLowerCase();
  if (!s) return "";
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(s)) return "";
  if (s.includes("--") || s.endsWith("-")) return "";
  if (PLACEHOLDER_NAMES.has(s)) return "";
  if (TOOL_NAME_DENYLIST.has(s)) return "";
  if (source === "slash_command" && BUILTIN_SLASH_COMMANDS.has(s)) return "";
  return s;
}

export function computeSkillTimelineEvents(
  messages: readonly SessionMessage[],
  toolCalls: readonly SessionToolCall[],
  validNames?: ReadonlySet<string> | null,
): SkillTimelineEvent[] {
  const events: SkillTimelineEvent[] = [];
  // Local helper so each match site stays uniform. `validNames` is the
  // server-side registry filter projected onto the client; when null, we
  // skip the check (e.g. unit tests, or sessions where the registry was
  // unavailable at extraction time).
  const push = (
    ts: string,
    name: string,
    source: SessionSkillSource,
    detail: string | null,
  ) => {
    if (!name) return;
    if (validNames && !validNames.has(name)) return;
    events.push({ ts, name, source, detail });
  };

  for (const m of messages) {
    if (m.role !== "user" || !m.text) continue;
    // Claude <command-name> tags
    for (const match of m.text.matchAll(COMMAND_NAME_RE)) {
      const raw = match[1];
      if (!raw) continue;
      const name = normalize(raw, "slash_command");
      push(m.timestamp, name, "slash_command", null);
    }
    // Antigravity SKILL meta block
    for (const match of m.text.matchAll(ANTIGRAVITY_SKILL_INVOKE_RE)) {
      const raw = match[1];
      if (!raw) continue;
      const name = normalize(raw, "slash_command");
      push(m.timestamp, name, "slash_command", null);
    }
    // Bare slash/dollar command at start of user message text — covers
    // Codex (`/foo` and `$foo` both leak through as plain user_message) and
    // Claude transcripts where the CLI didn't wrap the command in a
    // <command-name> tag.
    const trimmed = m.text.trimStart();
    const bare = trimmed.match(/^[/$]([a-z][a-z0-9-]{2,40})\b/);
    if (bare?.[1]) {
      const name = normalize(bare[1], "slash_command");
      push(m.timestamp, name, "slash_command", null);
    }
  }

  for (const tc of toolCalls) {
    if (tc.name === "Skill") {
      // Claude: input.skill / input.args
      const obj = parseJsonSafe(tc.args_json);
      if (obj && typeof obj.skill === "string") {
        const name = normalize(obj.skill, "skill_tool");
        const arg = typeof obj.args === "string" ? obj.args : null;
        push(tc.timestamp, name, "skill_tool", arg);
      }
    } else if (tc.name === "Agent" || tc.name === "Task" || tc.name === "spawn_agent") {
      const raw = tc.args_json ?? "";
      const pathRe = tc.name === "spawn_agent" ? CODEX_SKILL_PATH_RE : CLAUDE_SKILL_PATH_RE;
      const obj = parseJsonSafe(tc.args_json);
      const detail = extractFirst(obj, ["description", "name"]);
      const found = new Set<string>();
      for (const match of raw.matchAll(pathRe)) {
        const skill = match[1];
        if (!skill) continue;
        const name = normalize(skill, "subagent");
        if (name) {
          found.add(name);
          push(tc.timestamp, name, "subagent", detail);
        }
      }
      if (found.size === 0) {
        for (const re of [AGENT_PERSONA_JA_RE, AGENT_PERSONA_EN_RE]) {
          for (const match of raw.matchAll(re)) {
            const skill = match[1];
            if (!skill) continue;
            const name = normalize(skill, "subagent");
            if (name && !found.has(name)) {
              found.add(name);
              push(tc.timestamp, name, "subagent", detail);
            }
          }
        }
      }
    }
  }

  return events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/**
 * Build a Set<string> of validated skill names from `SessionDetail.skills`.
 * Passed as the registry filter to `computeSkillTimelineEvents`.
 */
export function validSkillNamesFromDetail(skills: readonly SessionSkillUse[]): Set<string> {
  const out = new Set<string>();
  for (const s of skills) out.add(s.name);
  return out;
}

function parseJsonSafe(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractFirst(
  obj: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
