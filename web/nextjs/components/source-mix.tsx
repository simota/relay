"use client";

import { useTheme } from "@/components/theme-provider";
import type { Counts, SourceType } from "@/lib/types";

type ThemeName = "dark" | "light";

const SOURCE_ITEMS: Record<ThemeName, Array<{
  source: SourceType;
  label: string;
  color: string;
}>> = {
  dark: [
    { source: "code_todo", label: "code todo", color: "var(--color-fg-muted)" },
    { source: "github_issue", label: "issue", color: "var(--color-cool)" },
    { source: "github_pr", label: "PR", color: "var(--color-warm)" },
    { source: "gh_review_request", label: "review", color: "var(--color-cool)" },
    { source: "gh_unresolved_thread", label: "thread", color: "var(--color-critical)" },
    { source: "git_dirty_worktree", label: "dirty", color: "var(--color-warm)" },
    { source: "docs_checklist", label: "docs", color: "var(--color-fg-muted)" },
    { source: "claude_session_todo", label: "session", color: "var(--color-accent)" },
    { source: "agents_note", label: ".agents", color: "var(--color-fg-dim)" },
    { source: "manual", label: "manual", color: "var(--color-fg)" },
  ],
  light: [
    { source: "code_todo", label: "code todo", color: "var(--color-fg-muted)" },
    { source: "github_issue", label: "issue", color: "var(--color-cool)" },
    { source: "github_pr", label: "PR", color: "var(--color-critical)" },
    { source: "gh_review_request", label: "review", color: "var(--color-cool)" },
    { source: "gh_unresolved_thread", label: "thread", color: "var(--color-critical)" },
    { source: "git_dirty_worktree", label: "dirty", color: "var(--color-warm)" },
    { source: "docs_checklist", label: "docs", color: "var(--color-fg-muted)" },
    { source: "claude_session_todo", label: "session", color: "var(--color-accent)" },
    { source: "agents_note", label: ".agents", color: "var(--color-fg)" },
    { source: "manual", label: "manual", color: "var(--color-fg)" },
  ],
};

interface SourceMixProps {
  counts?: Counts;
}

export function SourceMix({ counts }: SourceMixProps) {
  const { theme } = useTheme();
  // Sunset, notebook, washi, and sketch reuse the light palette (light
  // color-scheme) for chart segments. Matrix, ocean, and blueprint are dark
  // color-schemes, so they reuse the dark palette.
  const paletteKey: ThemeName =
    theme === "dark" || theme === "matrix" || theme === "ocean" || theme === "blueprint" ? "dark" : "light";
  const segments = SOURCE_ITEMS[paletteKey].map((item) => ({
    ...item,
    value: counts?.sources?.[item.source] ?? 0,
  }));
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const delta7d = counts?.source_delta_7d ?? 0;

  return (
    <div>
      <div className="relative pt-5">
        <div className="flex h-2 w-full overflow-visible rounded-full bg-[var(--color-bg)]">
          {total > 0 ? (
            segments.map((segment) => {
              const pct = (segment.value / total) * 100;
              return (
                <div
                  key={segment.source}
                  className="group relative h-2 min-w-0 first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${pct}%`, backgroundColor: segment.color }}
                  title={`${segment.label}: ${segment.value}`}
                >
                  <span className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--color-fg)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    {segment.label}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="h-2 w-full rounded-full bg-[var(--color-border)]" title="No sources" />
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-[var(--color-fg-dim)] tabular">
        Total: {total} · {formatSigned(delta7d)} / 7d
      </div>
    </div>
  );
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}
