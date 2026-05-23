// Promise Ledger — audits "what the assistant claimed it did" against
// "what its tool calls actually did" within the same conversational turn.
//
// Inputs: a session's `SessionMessage[]` (already extracted by the per-CLI
// reader) and the parallel `SessionToolCall[]`. Both are chronological.
//
// Output: one `PromiseEntry` per detected claim with a status (verified /
// partial / unmet / unverifiable) and a short evidence label. The
// `SessionPromiseLedger.honesty_score` rolls those up into a single 0-100
// trust number that the UI can render alongside the resident.
//
// Design priorities:
//
//   1. Precision over recall. False unmet/red flags would erode the very
//      trust this feature exists to build. Every claim pattern is anchored
//      and every evidence rule requires concrete tool args; everything
//      else falls into "unverifiable" (a neutral gray) rather than "unmet".
//   2. Cross-CLI. Tool-name matching accepts both Claude (`Edit`, `Write`,
//      `Bash`) and Codex (`apply_patch`, `exec_command`) families.
//   3. Stateless and synchronous. No DB, no IO — pure transform on data
//      the reader already has.
//
// Stays out of scope for v1: multi-claim sentences (one verb per match
// only), follow-up turn fulfillment (claims must be backed by tool_use in
// the same turn or earlier in the conversation), and natural-language
// negation ("I have NOT added X" would currently match — extremely rare
// in assistant transcripts, accept the noise rather than ship a brittle
// detector).

import type {
  PromiseEntry,
  SessionMessage,
  SessionPromiseLedger,
  SessionToolCall,
} from "../sessions/types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractPromiseLedger(
  messages: readonly SessionMessage[],
  toolCalls: readonly SessionToolCall[],
): SessionPromiseLedger {
  const entries: PromiseEntry[] = [];
  // Turn boundaries are the user-message timestamps. A claim made at ts T
  // can only cite evidence from tool_calls in (lastUserTs, T]. This keeps a
  // claim like "I've added the test" from being satisfied by a Bash test
  // run that happened five turns ago for a completely unrelated request.
  const turnBoundaries = collectUserTurnBoundaries(messages);

  messages.forEach((m, idx) => {
    if (m.role !== "assistant" || !m.text) return;
    const lowerBound = priorUserTs(turnBoundaries, m.timestamp);
    const upperBound = m.timestamp;
    const turnTools = toolCalls.filter(
      (tc) => tc.timestamp > lowerBound && tc.timestamp <= upperBound,
    );

    for (const claim of extractClaims(m.text)) {
      const verdict = verifyClaim(claim, turnTools);
      entries.push({
        message_index: idx,
        timestamp: m.timestamp,
        claim_text: claim.claim_text,
        claim_type: claim.type,
        status: verdict.status,
        evidence: verdict.evidence,
        reason: verdict.reason,
      });
    }
  });

  return summarize(entries);
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

interface RawClaim {
  claim_text: string;
  type: PromiseEntry["claim_type"];
  /** File path / module name target when the claim names one, else null. */
  target: string | null;
}

// Past-perfect English: "I've added X", "We have updated Y". The verb
// captures all the common write-action shapes; the body is the remainder
// of the sentence up to terminating punctuation or newline.
const EN_HAVE_RE =
  /\b(?:I'?(?:ve)|I\s+have|We'?(?:ve)|We\s+have)\s+(added|fixed|created|updated|wrote|written|refactored|implemented|removed|deleted|renamed|moved|installed|configured|set\s+up|hooked\s+up|wired(?:\s+up)?|migrated|enabled|disabled|committed|merged|landed|shipped|tested|verified|ran)\b([^.!?\n]*)/gi;

// Bare-verb declarative at the start of a sentence or bullet point:
// "Added foo.", "- Fixed bar.", "Refactored helper". Anchored to clause
// starts so prose like "the user added a comment" doesn't match.
const EN_BARE_RE =
  /(?:^|[.!?]\s+|[-*+•]\s+|\n\s*[-*+•]\s*|\n\s*\d+\.\s+)(Added|Fixed|Created|Updated|Wrote|Refactored|Implemented|Removed|Deleted|Renamed|Moved|Installed|Configured|Setup|Enabled|Disabled|Migrated|Committed|Merged|Landed|Shipped|Tested|Verified)\b([^.!?\n]*)/g;

// Japanese past tense: "X を 追加 しました" — body precedes the verb.
const JA_PAST_RE =
  /(?:^|[\s。、,「『（(])([^\s。、,「『（(]{1,80})\s*を\s*(追加|修正|作成|更新|削除|リファクタリング|実装|変更|改善|有効化|無効化|コミット|テスト|実行)(?:しました|した|します|する)/g;

// File-path detection. Matches src/foo/bar.ts, ./baz.tsx, foo.toml, etc.
// Used both to pull a target from a claim body and to decide if a tool's
// args reference that target. Kept conservative — requires an extension.
const FILE_PATH_RE =
  /(?:^|[\s`"'(\[])([./\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|sql|toml|ya?ml|json|md|css|scss|sh|bash|html|java|kt|kts|rb|php|c|cpp|h|hpp|swift|sql|graphql|gql|env|lock))(?=[\s`"')\],;:]|$)/;

// A backtick-wrapped identifier without an extension — e.g. `MyHelper` or
// `useFoo` — frequently identifies the target when the body lacks a file
// path. Lower-confidence than FILE_PATH_RE so we only fall back to it.
const BACKTICK_IDENT_RE = /`([A-Za-z_][A-Za-z0-9_-]{2,60})`/;

// Test heuristics. Path: anything that looks like a test file. Command:
// the test runners we see in real fixtures.
const TEST_PATH_RE = /(?:\.(?:test|spec)\.|_test\.|^test_|\/(?:tests?|__tests__|spec)\/)/i;
const TEST_RUNNER_RE =
  /\b(?:bun\s+test|npm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|pytest|jest|vitest|cargo\s+test|go\s+test|mocha|rspec|deno\s+test|phpunit|gradlew?\s+test|rake\s+test|tox\b)\b/i;
const COMMIT_CMD_RE = /\bgit\s+commit\b/;
const DELETE_CMD_RE = /\b(?:rm\s+-?[rRf]*|git\s+rm)\b/;

// Tool names that modify files. Claude: Edit/Write/MultiEdit/NotebookEdit.
// Codex: apply_patch. Add new CLIs here as needed — the substring evidence
// rule in `claimsTarget` works for any name once the tool is registered.
const FILE_WRITE_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch",
]);
const SHELL_TOOLS = new Set(["Bash", "exec_command", "run_shell_command"]);

function extractClaims(text: string): RawClaim[] {
  interface RawMatch {
    full: string;
    verb: string;
    body: string;
    start: number;
  }
  const matches: RawMatch[] = [];
  const pushMatch = (re: RegExp, source: string, verbIdx: number, bodyIdx: number) => {
    // RegExp /g state is per-instance, so each invocation gets a fresh
    // lastIndex via matchAll. The captured groups are 1-indexed.
    for (const m of source.matchAll(re)) {
      if (m.index === undefined) continue;
      matches.push({
        full: m[0],
        verb: m[verbIdx] ?? "",
        body: m[bodyIdx] ?? "",
        start: m.index,
      });
    }
  };
  pushMatch(EN_HAVE_RE, text, 1, 2);
  pushMatch(EN_BARE_RE, text, 1, 2);

  // JA matches: body is group 1 (precedes verb), verb is group 2.
  for (const m of text.matchAll(JA_PAST_RE)) {
    if (m.index === undefined) continue;
    matches.push({
      full: m[0],
      verb: jaVerbToEnglish(m[2] ?? ""),
      body: m[1] ?? "",
      start: m.index,
    });
  }

  // Sort by start so dedup is deterministic, then drop any match that
  // begins inside the previous one — protects against the EN_HAVE/EN_BARE
  // overlap on "I've added X" (EN_BARE would otherwise re-fire on "Added X").
  matches.sort((a, b) => a.start - b.start);
  const deduped: RawMatch[] = [];
  let prevEnd = -1;
  for (const m of matches) {
    if (m.start < prevEnd) continue;
    deduped.push(m);
    prevEnd = m.start + m.full.length;
  }

  return deduped.map((m) => {
    const { type, target } = classifyClaim(m.verb, m.body);
    return {
      claim_text: truncate(m.full.trim().replace(/\s+/g, " "), 200),
      type,
      target,
    };
  });
}

function classifyClaim(
  verbRaw: string,
  body: string,
): { type: PromiseEntry["claim_type"]; target: string | null } {
  const verb = verbRaw.toLowerCase().replace(/\s+/g, " ").trim();
  const target = extractTarget(body);
  const combined = (verb + " " + body).toLowerCase();

  // Commit shortcut: "I've committed …" or "git commit …" mention.
  if (verb === "committed" || COMMIT_CMD_RE.test(combined)) {
    return { type: "commit", target: null };
  }

  // Run-test claims: "ran tests", "tested the X", "tests pass".
  if (
    /\b(?:ran|running)\s+(?:the\s+)?tests?\b/.test(combined) ||
    /\btests?\s+(?:are\s+|now\s+)?passing?\b/.test(combined) ||
    /\b(?:verified|tested)\b/.test(verb)
  ) {
    return { type: "run_test", target };
  }

  // Add-test claims: target is itself a test file, or text mentions "test"
  // and a creation verb.
  if (target && TEST_PATH_RE.test(target)) {
    return { type: "add_test", target };
  }
  if (
    /\b(?:added|wrote|created|implemented|set\s+up|setup)\s+(?:a\s+|the\s+|new\s+|some\s+)*tests?\b/.test(
      combined,
    ) ||
    /テスト/.test(body)
  ) {
    return { type: "add_test", target };
  }

  // Delete claims.
  if (/(?:removed|deleted|dropped)/.test(verb)) {
    return target ? { type: "delete_file", target } : { type: "generic", target: null };
  }

  // File modification claims — target distinguishes create vs edit.
  if (target) {
    if (/(?:added|created|wrote|implemented|installed|set\s+up|setup|configured|migrated)/.test(verb)) {
      return { type: "write_file", target };
    }
    return { type: "edit_file", target };
  }

  // No target — too vague to verify.
  return { type: "generic", target: null };
}

function extractTarget(body: string): string | null {
  const fp = body.match(FILE_PATH_RE);
  if (fp?.[1]) return fp[1];
  const bt = body.match(BACKTICK_IDENT_RE);
  if (bt?.[1]) return bt[1];
  return null;
}

function jaVerbToEnglish(jaVerb: string): string {
  // Maps the JA past-tense verbs in JA_PAST_RE to the English verb space
  // that classifyClaim/verifyClaim already speak. Keep these in sync with
  // the regex's alternation list.
  switch (jaVerb) {
    case "追加":
      return "added";
    case "修正":
      return "fixed";
    case "作成":
      return "created";
    case "更新":
      return "updated";
    case "削除":
      return "deleted";
    case "リファクタリング":
      return "refactored";
    case "実装":
      return "implemented";
    case "変更":
      return "updated";
    case "改善":
      return "refactored";
    case "有効化":
      return "enabled";
    case "無効化":
      return "disabled";
    case "コミット":
      return "committed";
    case "テスト":
      return "tested";
    case "実行":
      return "ran";
    default:
      return jaVerb;
  }
}

// ---------------------------------------------------------------------------
// Evidence pairing
// ---------------------------------------------------------------------------

interface Verdict {
  status: PromiseEntry["status"];
  evidence: string | null;
  reason: string | null;
}

function verifyClaim(claim: RawClaim, tools: readonly SessionToolCall[]): Verdict {
  switch (claim.type) {
    case "write_file":
    case "edit_file":
    case "add_test": {
      if (!claim.target) {
        return { status: "unverifiable", evidence: null, reason: "no specific target" };
      }
      const ev = findFileTouch(tools, claim.target, claim.type);
      if (ev) return { status: "verified", evidence: ev, reason: null };
      return {
        status: "unmet",
        evidence: null,
        reason: `no Edit/Write tool call touched ${claim.target}`,
      };
    }
    case "delete_file": {
      if (!claim.target) {
        return { status: "unverifiable", evidence: null, reason: "no specific target" };
      }
      const ev = findDeleteEvidence(tools, claim.target);
      if (ev) return { status: "verified", evidence: ev, reason: null };
      return {
        status: "unmet",
        evidence: null,
        reason: `no rm/git rm or file removal touched ${claim.target}`,
      };
    }
    case "run_test": {
      const ev = findTestRun(tools);
      if (ev) return { status: "verified", evidence: ev, reason: null };
      return {
        status: "unmet",
        evidence: null,
        reason: "no test-runner command observed in this turn",
      };
    }
    case "commit": {
      const ev = findCommit(tools);
      if (ev) return { status: "verified", evidence: ev, reason: null };
      return {
        status: "unmet",
        evidence: null,
        reason: "no `git commit` observed in this turn",
      };
    }
    case "generic":
    default:
      return {
        status: "unverifiable",
        evidence: null,
        reason: "claim too vague to verify",
      };
  }
}

function findFileTouch(
  tools: readonly SessionToolCall[],
  target: string,
  type: "write_file" | "edit_file" | "add_test",
): string | null {
  const basename = target.split("/").pop() ?? target;
  for (const tc of tools) {
    if (!FILE_WRITE_TOOLS.has(tc.name)) continue;
    const args = tc.args_json ?? tc.args_summary;
    if (!args) continue;
    // Substring match against the basename — works for Claude's structured
    // `file_path` JSON and for Codex's `apply_patch` body since both
    // contain the literal path. Full-path match is preferred when present.
    if (args.includes(target) || args.includes(basename)) {
      const label = labelTouch(tc, type);
      return label;
    }
  }
  return null;
}

function findDeleteEvidence(
  tools: readonly SessionToolCall[],
  target: string,
): string | null {
  const basename = target.split("/").pop() ?? target;
  for (const tc of tools) {
    if (!SHELL_TOOLS.has(tc.name)) continue;
    const args = tc.args_json ?? tc.args_summary ?? "";
    if (!DELETE_CMD_RE.test(args)) continue;
    if (args.includes(target) || args.includes(basename)) {
      return `${tc.name}: rm`;
    }
  }
  return null;
}

function findTestRun(tools: readonly SessionToolCall[]): string | null {
  for (const tc of tools) {
    if (!SHELL_TOOLS.has(tc.name)) continue;
    const args = tc.args_json ?? tc.args_summary ?? "";
    const m = args.match(TEST_RUNNER_RE);
    if (m) return `${tc.name}: ${m[0]}`;
  }
  return null;
}

function findCommit(tools: readonly SessionToolCall[]): string | null {
  for (const tc of tools) {
    if (!SHELL_TOOLS.has(tc.name)) continue;
    const args = tc.args_json ?? tc.args_summary ?? "";
    if (COMMIT_CMD_RE.test(args)) return `${tc.name}: git commit`;
  }
  return null;
}

function labelTouch(
  tc: SessionToolCall,
  type: "write_file" | "edit_file" | "add_test",
): string {
  // Tries to surface the actual file_path from structured args, falling
  // back to the args_summary for opaque CLI tools (apply_patch carries the
  // path inside a patch header that's already in args_summary).
  let path = "";
  if (tc.args_json) {
    try {
      const obj = JSON.parse(tc.args_json) as Record<string, unknown>;
      const fp = obj.file_path ?? obj.path ?? obj.filename;
      if (typeof fp === "string") path = fp;
    } catch {
      // Not JSON (apply_patch is plain text) — fall through.
    }
  }
  if (!path) path = tc.args_summary;
  const action =
    type === "write_file" ? "wrote" : type === "edit_file" ? "edited" : "test";
  return `${tc.name}: ${action} ${truncate(path, 80)}`;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function summarize(entries: PromiseEntry[]): SessionPromiseLedger {
  let verified = 0;
  let partial = 0;
  let unmet = 0;
  let unverifiable = 0;
  for (const e of entries) {
    switch (e.status) {
      case "verified":
        verified++;
        break;
      case "partial":
        partial++;
        break;
      case "unmet":
        unmet++;
        break;
      case "unverifiable":
        unverifiable++;
        break;
    }
  }
  const scorable = verified + partial + unmet;
  const honesty_score = scorable === 0 ? null : Math.round(((verified + 0.5 * partial) / scorable) * 100);
  return {
    entries,
    total_claims: entries.length,
    verified,
    partial,
    unmet,
    unverifiable,
    honesty_score,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectUserTurnBoundaries(messages: readonly SessionMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.timestamp) out.push(m.timestamp);
  }
  return out;
}

function priorUserTs(boundaries: readonly string[], beforeTs: string): string {
  // Largest boundary strictly less than beforeTs. ISO timestamps compare
  // correctly as strings (lexicographic == chronological for fixed-format
  // ISO8601), which both Claude and Codex emit.
  let best = "";
  for (const b of boundaries) {
    if (b < beforeTs && b > best) best = b;
  }
  return best;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
