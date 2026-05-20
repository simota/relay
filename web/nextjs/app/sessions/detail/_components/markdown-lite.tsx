"use client";

import dynamic from "next/dynamic";
import { useState, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatNumber } from "@/lib/copy";

// Mermaid is heavy and only client-renderable, so we lazy-load it. The chunk
// is fetched only when a session message actually contains a ```mermaid fence.
const MermaidBlock = dynamic(() => import("./mermaid-block"), {
  ssr: false,
  loading: () => (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-2 text-[11.5px] text-[var(--color-fg-dim)]">
      loading mermaid…
    </div>
  ),
});

export function PlainText({ text }: { text: string }) {
  return (
    <pre className="font-mono text-[12px] whitespace-pre-wrap break-words leading-relaxed">
      {text}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Custom renderers — every block element gets explicit Tailwind classes so the
// output matches our compact mono/terminal aesthetic regardless of the active
// theme preset. Anything not listed falls back to react-markdown defaults.
// ---------------------------------------------------------------------------
const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-[14px] font-bold mt-3 mb-1.5 text-[var(--color-fg)]">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[13px] font-bold mt-3 mb-1.5 text-[var(--color-fg)]">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[12.5px] font-bold mt-2.5 mb-1 text-[var(--color-fg)]">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-[12px] font-bold mt-2 mb-1 text-[var(--color-fg)]">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-[12px] font-semibold mt-2 mb-1 text-[var(--color-fg)]">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-[12px] font-semibold mt-2 mb-1 text-[var(--color-fg-muted)]">
      {children}
    </h6>
  ),
  p: ({ children }) => <p className="whitespace-pre-wrap break-words">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="break-words">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--color-accent)] underline underline-offset-2 break-all"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[var(--color-border)] pl-3 text-[var(--color-fg-muted)] italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-[var(--color-border)] my-2" />,
  strong: ({ children }) => <strong className="font-bold text-[var(--color-fg)]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-[var(--color-fg-dim)]">{children}</del>,

  // GFM tables — explicitly styled because Tailwind v4 ships no table reset.
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-border)]">
      <table className="w-full border-collapse text-[11.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[var(--color-bg-elev)] text-[var(--color-fg-muted)]">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-t border-[var(--color-border)] first:border-t-0">{children}</tr>
  ),
  th: ({ children, style }) => (
    <th
      className="text-left font-semibold px-2 py-1 border-r border-[var(--color-border)] last:border-r-0"
      style={style}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      className="px-2 py-1 align-top border-r border-[var(--color-border)] last:border-r-0 break-words"
      style={style}
    >
      {children}
    </td>
  ),

  // Inline + fenced code. react-markdown 9 emits a single `code` element and
  // delegates the wrapping <pre> to the `pre` component — we render only a
  // bare fragment from `pre` because our `code` already supplies the wrapper.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...rest }: ComponentProps<"code">) => {
    const text = String(children ?? "").replace(/\n$/, "");
    const langMatch = /language-([\w-]+)/.exec(className ?? "");
    const lang = langMatch?.[1];

    // Inline code: react-markdown 9 sets no language class for inline.
    if (!lang) {
      return (
        <code
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-1 text-[11px]"
          {...rest}
        >
          {children}
        </code>
      );
    }

    if (lang === "mermaid") {
      return <MermaidBlock code={text} />;
    }

    return (
      <pre className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-2 overflow-x-auto text-[11.5px]">
        <div className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-wider mb-1">
          {lang}
        </div>
        <code className={className}>{text}</code>
      </pre>
    );
  },
};

function MarkdownPlain({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// XML-style tag splitter. Claude/Codex/Antigravity transcripts often contain blocks
// like <thinking>…</thinking> or <commit_analysis>…</commit_analysis>. We
// surface them as labeled, collapsible panels so the structure is legible
// rather than vanishing into raw HTML pass-through.
// ---------------------------------------------------------------------------
type Segment =
  | { type: "text"; content: string }
  | { type: "xml"; tag: string; content: string };

// Tag name must start with a letter; we match the matching closing tag via a
// backreference, which means same-name nesting collapses to the outermost
// boundary (acceptable for v1 — different-name nesting is preserved and
// rendered recursively).
const XML_TAG_RE = /<([a-zA-Z][a-zA-Z0-9_-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;

export function splitXmlBlocks(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(XML_TAG_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", content: text.slice(last, idx) });
    out.push({ type: "xml", tag: m[1] ?? "", content: m[2] ?? "" });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", content: text.slice(last) });
  return out;
}

function XmlPanel({ tag, content }: { tag: string; content: string }) {
  const [expanded, setExpanded] = useState(true);
  const lineCount = content === "" ? 0 : content.split("\n").length;
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/40">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--color-border)] text-[10.5px] font-mono leading-[1.5]">
        <span className="uppercase tracking-wider text-[var(--color-fg-muted)]">{tag}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10.5px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] font-mono"
          aria-expanded={expanded}
        >
          {expanded ? "collapse" : `expand (${formatNumber(lineCount)} lines)`}
        </button>
      </div>
      {expanded && (
        <div className="p-2">
          <MarkdownLite text={content} />
        </div>
      )}
    </div>
  );
}

export function MarkdownLite({ text }: { text: string }) {
  const segments = splitXmlBlocks(text);
  return (
    <div className="space-y-2 font-mono text-[12px] leading-relaxed [&>*:first-child]:mt-0">
      {segments.map((seg, i) => {
        if (seg.type === "xml") {
          return <XmlPanel key={`xml-${i}-${seg.tag}`} tag={seg.tag} content={seg.content} />;
        }
        return <MarkdownPlain key={`text-${i}`} text={seg.content} />;
      })}
    </div>
  );
}
