// Tag normalization shared by the DB layer, API, and CLI (schema v12).
// Dependency-free so db/internal.ts can import it without a cycle.

/** Max tags kept on one task — keeps chips readable and json_each cheap. */
export const MAX_TAGS_PER_TASK = 20;
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}._/:-]{0,39}$/u;

/**
 * Normalize user tag input: trim, strip a leading `#`, lowercase. Returns
 * null for anything that is not a valid tag (1-40 chars, starts with a
 * letter/digit, then letters/digits/`. _ / : -`).
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, "").toLowerCase();
  return TAG_RE.test(tag) ? tag : null;
}

/** Normalize + dedupe a tag list, preserving first-seen order. */
export function normalizeTags(raw: readonly string[]): { tags: string[]; invalid: string[] } {
  const tags: string[] = [];
  const invalid: string[] = [];
  for (const value of raw) {
    const tag = normalizeTag(value);
    if (!tag) {
      if (value.trim()) invalid.push(value);
      continue;
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return { tags, invalid };
}
