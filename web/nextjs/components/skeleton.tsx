import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SkeletonBlockProps {
  className?: string;
  style?: CSSProperties;
}

export function SkeletonBlock({ className, style }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("relay-skeleton rounded-[var(--radius)] bg-[var(--color-bg-elev)]", className)}
      style={style}
    />
  );
}

export function SkeletonScreen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("h-full overflow-hidden", className)} aria-busy="true">
      <span className="sr-only">loading</span>
      {children}
    </div>
  );
}

