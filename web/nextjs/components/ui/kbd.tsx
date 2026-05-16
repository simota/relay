import * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[3px]",
        "border border-[var(--color-border)] bg-[var(--color-bg-elev)]",
        "text-[10px] font-mono text-[var(--color-fg-muted)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
