"use client";

import { useEffect, useId, useRef, useState } from "react";

// Mermaid is heavy (~700 kB gz) so the parent loads this module via
// next/dynamic with ssr:false. Even inside the module we wait for the first
// mount before importing the library so the chunk is fetched only when a
// session detail actually contains a mermaid fence.
export default function MermaidBlock({ code }: { code: string }) {
  const reactId = useId();
  // CSS selectors can't start with a digit / contain `:`; useId returns
  // `:r123:` so we normalize to a safe slug.
  const id = `relay-mermaid-${reactId.replace(/:/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setErr(null);

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const prefersDark =
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: prefersDark ? "dark" : "neutral",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
        });
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (err) {
    return (
      <pre className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-2 overflow-x-auto text-[11.5px] text-[var(--color-warn,var(--color-accent))]">
        <div className="text-[10px] uppercase tracking-wider mb-1 text-[var(--color-fg-dim)]">
          mermaid · render failed
        </div>
        <code>{err}</code>
        {"\n"}
        <code className="text-[var(--color-fg-dim)]">{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-2 overflow-x-auto text-[11.5px]"
    >
      <div className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-wider mb-1">
        mermaid
      </div>
      {svg ? (
        <div
          className="relay-mermaid-svg flex justify-center"
          // mermaid.render() returns sanitized SVG (securityLevel: strict).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-[var(--color-fg-dim)] py-4 text-center">rendering…</div>
      )}
    </div>
  );
}
