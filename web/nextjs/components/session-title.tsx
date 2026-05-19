"use client";

import { formatSessionTitle } from "@/lib/session-title";

interface Props {
  raw: string;
  className?: string;
  /** Whether to render the leading chip. When `false`, only the cleaned display text is shown. */
  showChip?: boolean;
}

/**
 * Renders a session title or last-message preview that may begin with raw
 * XML tags (Claude Code local-command harness, task notifications, bash
 * blocks, `<analysis>` style wrappers). The XML envelope is collapsed into
 * a short chip label + a one-line display string suitable for truncated
 * row layouts. See `lib/session-title.ts` for extraction rules.
 */
export function SessionTitle({ raw, className, showChip = true }: Props) {
  const { chip, display } = formatSessionTitle(raw);
  if (!chip) {
    return <span className={className}>{display || raw}</span>;
  }
  return (
    <span className={className}>
      {showChip && (
        <span
          className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-1 py-px mr-1.5 align-middle font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]"
          title={chip}
        >
          {chip}
        </span>
      )}
      {display && <span>{display}</span>}
    </span>
  );
}
