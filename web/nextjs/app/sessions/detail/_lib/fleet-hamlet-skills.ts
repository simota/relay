// Hamlet — Skills system.
//
// A resident's "skill tree" derived from already-cached session data:
//   - Tool Skills: cumulative use count of each Read/Edit/Write/Bash/...
//   - Language Skills: file extension extracted from tool args
//   - Repo Skill: message-count proxy for tenure in the current repo
//
// All pure, deterministic, and runs client-side — no API change.

import type { SessionDetail, SessionToolCall } from "@/lib/api";
import type { SimCardModel } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SkillKind = "agent" | "tool" | "lang" | "repo";

export interface SkillDef {
  id: string;
  label: string;
  /** Short emoji/symbol for compact UIs. */
  icon: string;
  kind: SkillKind;
}

export interface Skill extends SkillDef {
  /** Raw experience count (uses, lines, messages depending on kind). */
  xp: number;
  /** 0..10 — Math.min(10, floor(sqrt(xp))). */
  level: number;
  /** Human label per level bucket. */
  levelLabel: string;
}

// ---------------------------------------------------------------------------
// File-extension → Language mapping
// ---------------------------------------------------------------------------

// Lowercased extension → display name. Extensions outside the table fall
// through to no language credit so noisy `.bak` / `.tmp` files don't pad XP.
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  cs: "C#",
  php: "PHP",
  md: "Markdown",
  mdx: "Markdown",
  sql: "SQL",
  css: "CSS",
  scss: "CSS",
  sass: "CSS",
  html: "HTML",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
};

const LANG_ICON: Record<string, string> = {
  TypeScript: "TS",
  JavaScript: "JS",
  Python: "PY",
  Go: "GO",
  Rust: "RS",
  Ruby: "RB",
  Java: "JV",
  Kotlin: "KT",
  Swift: "SW",
  C: "C",
  "C++": "C+",
  "C#": "C#",
  PHP: "PH",
  Markdown: "MD",
  SQL: "SQ",
  CSS: "CS",
  HTML: "HT",
  JSON: "{}",
  YAML: "YM",
  TOML: "TM",
  Shell: "SH",
};

// Compact icon for well-known tools — falls back to first letter otherwise.
const TOOL_ICON: Record<string, string> = {
  Read: "📖",
  Edit: "✏",
  Write: "🖊",
  Bash: "💻",
  Grep: "🔍",
  Glob: "🔭",
  TodoWrite: "✅",
  WebFetch: "🌐",
  WebSearch: "🔎",
  Task: "🤖",
  NotebookEdit: "📓",
};

// ---------------------------------------------------------------------------
// Level math
// ---------------------------------------------------------------------------

export function xpToLevel(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  return Math.min(10, Math.floor(Math.sqrt(xp)));
}

export function levelLabel(level: number): string {
  if (level <= 0) return "Untouched";
  if (level <= 2) return "Novice";
  if (level <= 4) return "Apprentice";
  if (level <= 6) return "Adept";
  if (level <= 8) return "Expert";
  return "Master";
}

// ---------------------------------------------------------------------------
// Compute skills for a single resident
// ---------------------------------------------------------------------------

export function computeSkills(
  card: SimCardModel,
  detail: SessionDetail | undefined,
): Skill[] {
  const tools = new Map<string, number>();
  const langs = new Map<string, number>();
  // Agent skills are the SKILL.md agents (nexus, guardian, vision, …) invoked
  // via the Skill tool, user `/<name>` slash commands, or subagent spawn.
  // Sum across all sources for the same name so a heavily-used skill ranks
  // higher than one invoked once per channel.
  const agents = new Map<string, number>();

  if (detail) {
    for (const tc of detail.tool_calls) {
      tools.set(tc.name, (tools.get(tc.name) ?? 0) + 1);
      const lang = languageFromToolCall(tc);
      if (lang) langs.set(lang, (langs.get(lang) ?? 0) + 1);
    }
    for (const s of detail.skills ?? []) {
      agents.set(s.name, (agents.get(s.name) ?? 0) + s.count);
    }
  }

  const out: Skill[] = [];

  for (const [name, xp] of agents) {
    const icon = "✦";
    out.push(makeSkill({ id: `agent:${name}`, label: name, icon, kind: "agent" }, xp));
  }
  for (const [name, xp] of tools) {
    const icon = TOOL_ICON[name] ?? name.slice(0, 2);
    out.push(makeSkill({ id: `tool:${name}`, label: name, icon, kind: "tool" }, xp));
  }
  for (const [name, xp] of langs) {
    const icon = LANG_ICON[name] ?? name.slice(0, 2).toUpperCase();
    out.push(makeSkill({ id: `lang:${name}`, label: name, icon, kind: "lang" }, xp));
  }

  // Repo skill — proxy from message count (capped at 100 messages → Lv 10).
  const msgXp = detail?.messages.length ?? 0;
  if (card.repo) {
    out.push(
      makeSkill(
        { id: `repo:${card.repo}`, label: card.repo, icon: "🏡", kind: "repo" },
        msgXp,
      ),
    );
  }

  return out;
}

function makeSkill(def: SkillDef, xp: number): Skill {
  const level = xpToLevel(xp);
  return { ...def, xp, level, levelLabel: levelLabel(level) };
}

export function topSkills(skills: readonly Skill[], n: number): Skill[] {
  // Agent skills carry orchestration signal (which SKILL.md agent the
  // resident invoked). XP for agents is naturally smaller than for raw
  // tool calls (Bash fires hundreds of times per session, nexus a dozen)
  // so a pure level/xp sort would push agents off the compact list every
  // time. Reserve up to 2 slots for the top-XP agent skills, then fill
  // the rest with the remaining skills sorted by level/xp.
  const sorted = [...skills].sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    return b.xp - a.xp;
  });
  const agentSlots = Math.min(2, Math.max(0, n - 1));
  const agents = sorted.filter((s) => s.kind === "agent").slice(0, agentSlots);
  const taken = new Set(agents.map((s) => s.id));
  const out = [...agents];
  for (const s of sorted) {
    if (out.length >= n) break;
    if (taken.has(s.id)) continue;
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers — extract a language from a tool call's args.
// ---------------------------------------------------------------------------

const PATH_KEYS = ["file_path", "filePath", "path", "notebook_path", "filename"];

function languageFromToolCall(tc: SessionToolCall): string | null {
  // Prefer structured args_json when available; fall back to scanning the
  // summary text for the first plausible filename token.
  if (tc.args_json) {
    try {
      const obj = JSON.parse(tc.args_json) as Record<string, unknown>;
      for (const k of PATH_KEYS) {
        const v = obj[k];
        if (typeof v === "string") {
          const lang = languageFromPath(v);
          if (lang) return lang;
        }
      }
    } catch {
      // ignore — fall through to summary scan
    }
  }
  if (tc.args_summary) {
    const m = tc.args_summary.match(/[\w./-]+\.([A-Za-z0-9]{1,8})\b/);
    if (m?.[1]) {
      const lang = LANGUAGE_EXTENSIONS[m[1].toLowerCase()];
      if (lang) return lang;
    }
  }
  return null;
}

function languageFromPath(p: string): string | null {
  const dot = p.lastIndexOf(".");
  if (dot < 0 || dot >= p.length - 1) return null;
  const ext = p.slice(dot + 1).toLowerCase();
  return LANGUAGE_EXTENSIONS[ext] ?? null;
}
