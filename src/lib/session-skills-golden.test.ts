import { describe, expect, test } from "bun:test";
import { extractClaudeSkills, getKnownSkills, resetKnownSkillsCacheForTests } from "./session-skills.js";

// Golden regression for extractClaudeSkills: tool_result status attachment
// (is_error, "Error:"/"Failed:" bodies, last-result-wins per tool_use_id,
// missing/unresolved ids), slash commands (wrapped and bare), Agent/Task
// spawn detection, and malformed / non-object lines. The expected output
// was captured with an empty skill registry; aggregate() filters per skill
// name, so on a machine with skills installed the same rows minus unknown
// names must come back.
const L = (o: unknown) => JSON.stringify(o);
const CLAUDE_FIXTURE = [
  L({ type: "user", timestamp: "2026-01-01T00:00:00Z", cwd: "/r/x", message: { role: "user", content: "<command-name>/review</command-name><command-args>deep pr-12</command-args>" } }),
  "not json at all",
  "null",
  "42",
  "",
  L({ type: "assistant", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", content: [
    { type: "text", text: "ok" },
    { type: "tool_use", id: "tu_1", name: "Skill", input: { skill: "alpha-skill", args: "fast mode" } },
    { type: "tool_use", id: "tu_2", name: "Skill", input: { skill: "beta-skill" } },
    { type: "tool_use", name: "Skill", input: { skill: "noid-skill" } },
    { type: "tool_use", id: "tu_9", name: "Skill", input: { skill: "never-resolved" } },
  ] } }),
  L({ type: "user", timestamp: "2026-01-01T00:00:02Z", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "tu_1", content: "fine" },
    { type: "tool_result", tool_use_id: "tu_2", content: "Error: boom" },
  ] } }),
  L({ type: "assistant", timestamp: "2026-01-01T00:00:03Z", message: { role: "assistant", content: [
    { type: "tool_use", id: "tu_3", name: "Agent", input: { prompt: "Read ~/.claude/skills/scout/SKILL.md then go", description: "scouting" } },
    { type: "tool_use", id: "tu_4", name: "Task", input: { prompt: "あなたは Spark エージェントです。", description: "spark" } },
    { type: "tool_use", id: "tu_5", name: "Agent", input: { prompt: "You are the Lens agent. Do it." } },
    { type: "tool_use", id: "tu_6", name: "Agent", input: { prompt: "plain", subagent_type: "custom-agent" } },
    { type: "tool_use", id: "tu_7", name: "Skill", input: { skill: "gamma-skill" } },
    { type: "tool_use", id: "tu_8", name: "Skill", input: { skill: "delta-skill", args: "go" } },
    { type: "tool_use", id: "tu_8", name: "Skill", input: { skill: "delta-skill" } },
  ] } }),
  L({ type: "user", timestamp: "2026-01-01T00:00:04Z", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "tu_7", is_error: true, content: "x" },
    { type: "tool_result", tool_use_id: "tu_8", content: "all good" },
    { type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "Failed: later failure" }] },
    { type: "text", text: "/deploy now please" },
  ] } }),
  L({ type: "user", timestamp: "2026-01-01T00:00:05Z", message: { role: "user", content: "/ship-it quickly" } }),
  L({ type: "assistant", timestamp: "2026-01-01T00:00:06Z", message: { role: "assistant", content: "<command-name>/inline</command-name> mention" } }),
  L({ type: "user", timestamp: "2026-01-01T00:00:07Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_9b", content: "error:   spaced" }] } }),
  L({ timestamp: "2026-01-01T00:00:08Z", role: "user", content: [{ type: "tool_result", tool_use_id: "tu_5", content: "ok" }] }),
].join("\n");

const GOLDEN: Array<Record<string, unknown> & { name: string }> = [
 {
  "name": "deploy",
  "source": "slash_command",
  "first_ts": "2026-01-01T00:00:04Z",
  "last_ts": "2026-01-01T00:00:04Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "inline",
  "source": "slash_command",
  "first_ts": "2026-01-01T00:00:06Z",
  "last_ts": "2026-01-01T00:00:06Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "review",
  "source": "slash_command",
  "first_ts": "2026-01-01T00:00:00Z",
  "last_ts": "2026-01-01T00:00:00Z",
  "count": 1,
  "last_args": "deep pr-12",
  "recipe": "deep",
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "ship-it",
  "source": "slash_command",
  "first_ts": "2026-01-01T00:00:05Z",
  "last_ts": "2026-01-01T00:00:05Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "delta-skill",
  "source": "skill_tool",
  "first_ts": "2026-01-01T00:00:03Z",
  "last_ts": "2026-01-01T00:00:03Z",
  "count": 2,
  "last_args": "go",
  "recipe": "go",
  "last_status": "success",
  "is_first_use_in_session": true
 },
 {
  "name": "alpha-skill",
  "source": "skill_tool",
  "first_ts": "2026-01-01T00:00:01Z",
  "last_ts": "2026-01-01T00:00:01Z",
  "count": 1,
  "last_args": "fast mode",
  "recipe": "fast",
  "last_status": "failed",
  "is_first_use_in_session": true
 },
 {
  "name": "beta-skill",
  "source": "skill_tool",
  "first_ts": "2026-01-01T00:00:01Z",
  "last_ts": "2026-01-01T00:00:01Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": "failed",
  "is_first_use_in_session": true
 },
 {
  "name": "gamma-skill",
  "source": "skill_tool",
  "first_ts": "2026-01-01T00:00:03Z",
  "last_ts": "2026-01-01T00:00:03Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": "failed",
  "is_first_use_in_session": true
 },
 {
  "name": "never-resolved",
  "source": "skill_tool",
  "first_ts": "2026-01-01T00:00:01Z",
  "last_ts": "2026-01-01T00:00:01Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "noid-skill",
  "source": "skill_tool",
  "first_ts": "2026-01-01T00:00:01Z",
  "last_ts": "2026-01-01T00:00:01Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "custom-agent",
  "source": "subagent",
  "first_ts": "2026-01-01T00:00:03Z",
  "last_ts": "2026-01-01T00:00:03Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "lens",
  "source": "subagent",
  "first_ts": "2026-01-01T00:00:03Z",
  "last_ts": "2026-01-01T00:00:03Z",
  "count": 1,
  "last_args": null,
  "recipe": null,
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "scout",
  "source": "subagent",
  "first_ts": "2026-01-01T00:00:03Z",
  "last_ts": "2026-01-01T00:00:03Z",
  "count": 1,
  "last_args": "scouting",
  "recipe": "scouting",
  "last_status": null,
  "is_first_use_in_session": true
 },
 {
  "name": "spark",
  "source": "subagent",
  "first_ts": "2026-01-01T00:00:03Z",
  "last_ts": "2026-01-01T00:00:03Z",
  "count": 1,
  "last_args": "spark",
  "recipe": "spark",
  "last_status": null,
  "is_first_use_in_session": true
 }
];

describe("extractClaudeSkills golden output", () => {
  test("matches the captured aggregate for the fixture", () => {
    resetKnownSkillsCacheForTests();
    const known = getKnownSkills();
    const expected =
      known.size > 0 ? GOLDEN.filter((e) => known.has(e.name)) : GOLDEN;
    expect(extractClaudeSkills(CLAUDE_FIXTURE) as unknown[]).toEqual(expected);
  });

  test("empty input yields no skills", () => {
    expect(extractClaudeSkills("")).toEqual([]);
    expect(extractClaudeSkills("\n\n")).toEqual([]);
  });
});
