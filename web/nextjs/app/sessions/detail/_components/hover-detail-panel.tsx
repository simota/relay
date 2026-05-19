"use client";

/**
 * Small fixed-height detail panel rendered outside (under) the SVG to surface
 * hover context without disturbing chart layout. The minimum height keeps the
 * surrounding layout stable when the panel toggles between empty and filled.
 */
export function HoverDetailPanel({
  time,
  primary,
  secondary,
  tertiary,
}: {
  time?: string;
  primary?: string;
  secondary?: string;
  tertiary?: string;
}) {
  return (
    <div
      className="mt-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-1.5 font-mono text-[11px] leading-tight"
      style={{
        backgroundColor: "var(--color-bg-elev)",
        minHeight: 48,
      }}
      aria-live="polite"
    >
      <div className="flex items-baseline gap-2 text-[var(--color-fg)]">
        {time ? (
          <span className="text-[var(--color-fg-dim)] tabular-nums">{time}</span>
        ) : null}
        {primary ? <span className="font-semibold">{primary}</span> : null}
        {!time && !primary ? (
          <span className="text-[var(--color-fg-dim)]">hover for detail</span>
        ) : null}
      </div>
      {secondary ? (
        <div className="text-[var(--color-fg-muted)] truncate">{secondary}</div>
      ) : null}
      {tertiary ? (
        <div className="text-[var(--color-fg-dim)] truncate">{tertiary}</div>
      ) : null}
    </div>
  );
}
