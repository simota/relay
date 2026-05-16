"use client";

import { cn } from "@/lib/utils";

export function TabButton({
  active,
  onClick,
  children,
  compact = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 transition-colors",
        compact ? "h-7 px-2 text-[11px]" : "h-8 px-3 text-[12px]",
        active
          ? "border-[var(--color-accent)] text-[var(--color-fg)]"
          : "border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
      )}
    >
      {children}
    </button>
  );
}
