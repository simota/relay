"use client";

import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Minimal Markdown renderer — covers ~80% of .agents/*.md patterns.
// No external dependency; hand-rolled line-based parser.
// XSS: HTML tags in source are escaped; raw HTML is never allowed.
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Inline rendering: **bold**, *italic*, `code`, [text](url)
// ---------------------------------------------------------------------------
function renderInline(text: string): React.ReactNode[] {
  // Pattern: **bold**, *italic*, `code`, [label](url)
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`\n]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) {
      out.push(escHtml(text.slice(last, m.index)));
    }
    if (m[0].startsWith("**")) {
      out.push(<strong key={key++}>{escHtml(m[2] ?? "")}</strong>);
    } else if (m[0].startsWith("*")) {
      out.push(<em key={key++}>{escHtml(m[3] ?? "")}</em>);
    } else if (m[0].startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-1 font-mono text-[11px]"
        >
          {escHtml(m[4] ?? "")}
        </code>,
      );
    } else {
      // link
      const label = m[5] ?? "";
      const href = m[6] ?? "";
      const isExternal = /^https?:\/\//.test(href);
      out.push(
        <a
          key={key++}
          href={href}
          className="text-[var(--color-accent)] underline underline-offset-2"
          {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {escHtml(label)}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) out.push(escHtml(text.slice(last)));
  return out;
}

// ---------------------------------------------------------------------------
// Block-level token types
// ---------------------------------------------------------------------------
type Token =
  | { t: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { t: "hr" }
  | { t: "code_block"; lang: string; body: string }
  | { t: "table"; header: string[]; align: string[]; rows: string[][] }
  | { t: "list_item"; indent: number; checked: boolean | null; text: string; ordered: boolean; number: number }
  | { t: "blank" }
  | { t: "paragraph"; text: string };

// ---------------------------------------------------------------------------
// Tokenize
// ---------------------------------------------------------------------------
function tokenize(md: string): Token[] {
  const lines = md.split("\n");
  const tokens: Token[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    const fenceMatch = /^```([^\n`]*)$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1]?.trim() ?? "";
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        bodyLines.push(lines[i]!);
        i++;
      }
      i++; // consume closing ```
      tokens.push({ t: "code_block", lang, body: bodyLines.join("\n") });
      continue;
    }

    // Table: detect header row (contains |)
    if (/^\|.+\|/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1]!)) {
      const parseRow = (r: string) =>
        r
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const header = parseRow(line);
      const alignLine = lines[i + 1]!;
      const align = parseRow(alignLine).map((c) => {
        if (/^:-+:$/.test(c)) return "center";
        if (/^-+:$/.test(c)) return "right";
        return "left";
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|/.test(lines[i]!)) {
        rows.push(parseRow(lines[i]!));
        i++;
      }
      tokens.push({ t: "table", header, align, rows });
      continue;
    }

    // Heading
    const hMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hMatch) {
      const level = Math.min(4, hMatch[1]!.length) as 1 | 2 | 3 | 4;
      tokens.push({ t: "heading", level, text: hMatch[2]! });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      tokens.push({ t: "hr" });
      i++;
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      tokens.push({ t: "blank" });
      i++;
      continue;
    }

    // List item (ordered or unordered, with optional checkbox)
    const liUnord = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const liOrd = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (liUnord) {
      const indent = liUnord[1]!.length;
      const rest = liUnord[2]!;
      const cbMatch = /^\[( |x|X)\]\s*(.*)$/.exec(rest);
      const checked = cbMatch ? cbMatch[1]!.toLowerCase() === "x" : null;
      const text = cbMatch ? cbMatch[2]! : rest;
      tokens.push({ t: "list_item", indent, checked, text, ordered: false, number: 0 });
      i++;
      continue;
    }
    if (liOrd) {
      const indent = liOrd[1]!.length;
      const number = parseInt(liOrd[2]!, 10);
      const text = liOrd[3]!;
      tokens.push({ t: "list_item", indent, checked: null, text, ordered: true, number });
      i++;
      continue;
    }

    // Paragraph (accumulate continuation lines)
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]!) &&
      !/^#{1,4}\s/.test(lines[i]!) &&
      !/^---+\s*$/.test(lines[i]!) &&
      !/^```/.test(lines[i]!) &&
      !/^\|.+\|/.test(lines[i]!) &&
      !/^(\s*)[-*+]\s/.test(lines[i]!) &&
      !/^(\s*)\d+\.\s/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    tokens.push({ t: "paragraph", text: paraLines.join(" ") });
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Render tokens → React elements
// ---------------------------------------------------------------------------
function renderTokens(tokens: Token[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let idx = 0;

  while (idx < tokens.length) {
    const tok = tokens[idx]!;

    if (tok.t === "blank") {
      idx++;
      continue;
    }

    if (tok.t === "hr") {
      out.push(<hr key={idx} className="my-4 border-[var(--color-border)]" />);
      idx++;
      continue;
    }

    if (tok.t === "heading") {
      const cls = [
        "font-semibold tracking-tight leading-snug",
        tok.level === 1 && "text-[18px] mt-6 mb-3 text-[var(--color-fg)]",
        tok.level === 2 && "text-[15px] mt-5 mb-2 text-[var(--color-fg)]",
        tok.level === 3 && "text-[13px] mt-4 mb-1.5 text-[var(--color-fg)]",
        tok.level === 4 && "text-[12px] mt-3 mb-1 text-[var(--color-fg-muted)]",
      ]
        .filter(Boolean)
        .join(" ");
      const Tag = `h${tok.level}` as "h1" | "h2" | "h3" | "h4";
      out.push(
        <Tag key={idx} className={cls}>
          {renderInline(tok.text)}
        </Tag>,
      );
      idx++;
      continue;
    }

    if (tok.t === "code_block") {
      out.push(
        <pre
          key={idx}
          className="my-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 overflow-x-auto text-[11.5px] font-mono leading-relaxed"
        >
          {tok.lang && (
            <div className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-wider mb-1.5">
              {tok.lang}
            </div>
          )}
          <code>{tok.body}</code>
        </pre>,
      );
      idx++;
      continue;
    }

    if (tok.t === "table") {
      out.push(
        <div key={idx} className="my-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {tok.header.map((h, ci) => (
                  <th
                    key={ci}
                    className="border border-[var(--color-border)] px-3 py-1.5 text-left font-semibold text-[var(--color-fg)]"
                    style={{ textAlign: (tok.align[ci] ?? "left") as React.CSSProperties["textAlign"] }}
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tok.rows.map((row, ri) => (
                <tr key={ri} className="even:bg-[var(--color-bg-elev)]/30">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-fg)]"
                      style={{ textAlign: (tok.align[ci] ?? "left") as React.CSSProperties["textAlign"] }}
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      idx++;
      continue;
    }

    // List: collect consecutive list items at same or deeper indent
    if (tok.t === "list_item") {
      const items: typeof tok[] = [];
      while (idx < tokens.length && tokens[idx]!.t === "list_item") {
        items.push(tokens[idx] as typeof tok);
        idx++;
      }
      out.push(<ListBlock key={idx} items={items} />);
      continue;
    }

    if (tok.t === "paragraph") {
      out.push(
        <p key={idx} className="my-2 text-[13px] leading-relaxed text-[var(--color-fg)]">
          {renderInline(tok.text)}
        </p>,
      );
      idx++;
      continue;
    }

    idx++;
  }

  return out;
}

// ---------------------------------------------------------------------------
// ListBlock: renders flat list of items, grouping by indent (1 level nesting)
// ---------------------------------------------------------------------------
function ListBlock({ items }: { items: Array<{ indent: number; checked: boolean | null; text: string; ordered: boolean; number: number }> }) {
  // Separate top-level (indent 0) items from children (indent > 0)
  // Simple approach: treat indent < 4 as top-level, >= 4 as child
  type Item = { indent: number; checked: boolean | null; text: string; ordered: boolean; number: number };

  function buildNested(flat: Item[]): React.ReactNode[] {
    const result: React.ReactNode[] = [];
    let i = 0;
    while (i < flat.length) {
      const item = flat[i]!;
      const children: Item[] = [];
      i++;
      while (i < flat.length && flat[i]!.indent > item.indent) {
        children.push(flat[i]!);
        i++;
      }
      result.push(
        <ListItem key={i} item={item}>
          {children.length > 0 && <ListBlock items={children} />}
        </ListItem>,
      );
    }
    return result;
  }

  const isOrdered = items[0]?.ordered ?? false;
  const Tag = isOrdered ? "ol" : "ul";
  const listCls = isOrdered
    ? "list-decimal list-inside my-2 space-y-0.5 pl-4"
    : "list-none my-2 space-y-0.5 pl-2";

  return (
    <Tag className={listCls}>
      {buildNested(items)}
    </Tag>
  );
}

function ListItem({
  item,
  children,
}: {
  item: { checked: boolean | null; text: string };
  children?: React.ReactNode;
}) {
  return (
    <li className="text-[13px] leading-relaxed text-[var(--color-fg)] flex gap-2 items-start">
      {item.checked !== null ? (
        <input
          type="checkbox"
          checked={item.checked}
          disabled
          readOnly
          className="mt-[3px] shrink-0 accent-[var(--color-accent)]"
        />
      ) : (
        <span className="shrink-0 text-[var(--color-fg-muted)] mt-[2px]">·</span>
      )}
      <span>
        {renderInline(item.text)}
        {children}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------
export function MarkdownView({ content }: { content: string }) {
  const nodes = useMemo(() => {
    const tokens = tokenize(content);
    return renderTokens(tokens);
  }, [content]);

  return (
    <div className="markdown-view text-[13px] leading-relaxed">
      {nodes}
    </div>
  );
}
