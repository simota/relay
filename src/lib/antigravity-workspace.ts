// Derive cwd from absolute path mentions inside an Antigravity CLI
// transcript when neither `history.jsonl` nor `cache/last_conversations.json`
// records a workspace for the conversation.
//
// Subagents (child conversations spawned by an orchestrator) do not get
// their own row in `history.jsonl`, and `cache/last_conversations.json`
// only keeps the latest conversation per workspace — so a typical
// /nexus-style fan-out leaves N-1 child conversations with `cwd = null`,
// which then collapses to `repo = null` downstream. The only structural
// evidence of the subagent's repo lives in the chat body itself, where the
// orchestrator typically quotes a `/Users/.../<repo>` path when delegating
// work.
//
// Matching against `scan.roots` keeps the heuristic precise: we only
// accept a mention when it falls under a path the user has already
// declared as a scan root, so a stray reference inside a skill manual or
// imported snippet does not contaminate the resolution. First-match wins;
// root order follows the user's config, so callers that care about
// disambiguation can already express it there.
export function deriveCwdFromMentions(
  text: string,
  roots: readonly string[],
): string | null {
  if (!text || roots.length === 0) return null;
  for (const root of roots) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // `[\w.-]+` is generous on purpose — GitHub repo names allow underscore
    // and dot — but trailing punctuation (period at end of sentence, etc.)
    // is stripped below because it is never a legitimate repo-name suffix.
    const re = new RegExp(`${escaped}/([\\w.-]+)`);
    const m = text.match(re);
    if (m && m[1]) {
      const name = m[1].replace(/[.]+$/, "");
      if (name.length > 0) return `${root}/${name}`;
    }
  }
  return null;
}

/**
 * Step 2 of the cwd chain: an explicit `workspace` marker in a USER_INPUT
 * entry's ADDITIONAL_METADATA. Antigravity emits it inconsistently, so this
 * is best-effort and returns null when absent. Shared by the list adapter
 * and the detail reader so both resolve the same cwd.
 */
export function deriveCwdFromWorkspaceMarker(
  entries: ReadonlyArray<{ type?: unknown; content?: unknown }>,
): string | null {
  for (const entry of entries) {
    if (entry.type !== "USER_INPUT" || typeof entry.content !== "string") continue;
    const match = entry.content.match(/workspace["']?\s*[:=]\s*["']([^"']+)["']/i);
    if (match && typeof match[1] === "string") return match[1];
  }
  return null;
}
