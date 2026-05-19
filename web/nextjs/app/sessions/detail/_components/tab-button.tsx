"use client";

import { cn } from "@/lib/utils";

export function TabButton({
  active,
  onClick,
  children,
  compact = false,
  title,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  compact?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={cn(
        "inline-flex items-center gap-1 border-b-2 transition-colors whitespace-nowrap shrink-0 font-mono",
        compact ? "h-7 px-1.5 text-[11px]" : "h-8 px-2 text-[12px]",
        active
          ? "border-[var(--color-accent)] text-[var(--color-fg)]"
          : "border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
      )}
    >
      {children}
    </button>
  );
}
