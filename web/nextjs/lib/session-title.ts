/**
 * Session title / preview formatter.
 *
 * Raw session titles and last-message previews can arrive with leading XML
 * tags coming from Claude Code local-command harnesses, task notifications,
 * bash tool blocks, or assorted `<analysis>`/`<plan>` style wrappers. The
 * single-line UI rows (sessions list `last_message`, session-tile `<h2>`)
 * cannot host the collapsible XML panel that `MarkdownLite` uses, so we
 * extract a short `chip` label + a clean `display` string instead.
 *
 * The extractor is intentionally distinct from `splitXmlBlocks` in
 * `markdown-lite.tsx` — that one segments a long body into multiple blocks
 * for folding; this one only inspects the *leading* XML envelope and
 * surfaces the most informative inner text for a one-line render.
 */

export interface FormattedSessionTitle {
  /** Short label (e.g. "/nexus", "task", "bash"). `null` when input has no XML. */
  chip: string | null;
  /** One-line display text, XML stripped, whitespace collapsed. */
  display: string;
}

const DISPLAY_MAX = 200;
const TAG_RE = /^\s*<([a-zA-Z][a-zA-Z0-9_-]*)\b[^>]*>/;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string): string {
  if (s.length <= DISPLAY_MAX) return s;
  return `${s.slice(0, DISPLAY_MAX - 1)}…`;
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "";
}

/** Extracts the *first* line of inner text from `<tag>...</tag>` (case-insensitive),
 *  searching anywhere in `src`. Returns `null` when the tag (or its close) is missing. */
function pickTagInner(src: string, tag: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "i");
  const close = new RegExp(`</${tag}\\s*>`, "i");
  const openMatch = open.exec(src);
  if (!openMatch) return null;
  const after = src.slice(openMatch.index + openMatch[0].length);
  const closeMatch = close.exec(after);
  const inner = closeMatch ? after.slice(0, closeMatch.index) : after;
  return firstNonEmptyLine(inner);
}

/** Extracts the entire inner text (collapsed) of the FIRST leading tag in `src`. */
function pickLeadingTagInner(src: string, tag: string): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "i");
  const close = new RegExp(`</${tag}\\s*>`, "i");
  const openMatch = open.exec(src);
  if (!openMatch) return "";
  const after = src.slice(openMatch.index + openMatch[0].length);
  const closeMatch = close.exec(after);
  const inner = closeMatch ? after.slice(0, closeMatch.index) : after;
  return collapseWhitespace(inner);
}

export function formatSessionTitle(raw: string): FormattedSessionTitle {
  if (!raw) return { chip: null, display: "" };

  // No leading tag at all → return raw text trimmed.
  if (!TAG_RE.test(raw)) {
    return { chip: null, display: truncate(raw.trim()) };
  }

  // ── 1. Claude Code local-command pattern ────────────────────────────────
  //   <command-message>NAME</command-message>
  //   <command-name>/NAME</command-name>
  //   <command-args>BODY</command-args>
  // command-name carries the slash form, so prefer it for the chip.
  const cmdName = pickTagInner(raw, "command-name");
  const cmdMsg = pickTagInner(raw, "command-message");
  if (cmdName || cmdMsg) {
    const nameRaw = (cmdName ?? cmdMsg ?? "").trim();
    const chip = nameRaw.startsWith("/") ? nameRaw : `/${nameRaw}`;
    const args = pickLeadingTagInner(raw, "command-args");
    const display = args ? truncate(args) : chip;
    return { chip, display };
  }

  // ── 2. Task notification ───────────────────────────────────────────────
  const leadMatch = TAG_RE.exec(raw);
  // leadMatch is non-null here because TAG_RE.test passed above.
  const leadingTag = leadMatch![1]!.toLowerCase();

  if (leadingTag === "task-notification") {
    const result = pickTagInner(raw, "result");
    const summary = result ?? pickTagInner(raw, "summary");
    const inner = summary ?? pickLeadingTagInner(raw, "task-notification");
    const display = inner ? truncate(collapseWhitespace(inner)) : "task notification";
    return { chip: "task", display };
  }

  // ── 3. Bash tool blocks ────────────────────────────────────────────────
  if (
    leadingTag === "bash-stdout" ||
    leadingTag === "bash-stderr" ||
    leadingTag === "bash-input" ||
    leadingTag === "bash-output"
  ) {
    const inner = pickLeadingTagInner(raw, leadingTag);
    const display = inner ? truncate(inner) : "";
    return { chip: "bash", display };
  }

  // ── 4. Generic single leading tag ──────────────────────────────────────
  const innerLine = pickTagInner(raw, leadingTag);
  const fullInner = pickLeadingTagInner(raw, leadingTag);

  // Prefer text that appears *after* the leading tag's close, if any.
  const closeRe = new RegExp(`</${leadingTag}\\s*>`, "i");
  const closeMatch = closeRe.exec(raw);
  let trailing = "";
  if (closeMatch) {
    trailing = collapseWhitespace(raw.slice(closeMatch.index + closeMatch[0].length));
  }

  const candidate =
    innerLine ?? (fullInner.length > 0 ? fullInner : trailing.length > 0 ? trailing : "");
  const display = candidate ? truncate(candidate) : "";
  return { chip: leadingTag, display };
}
