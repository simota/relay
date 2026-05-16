import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 px-2.5 rounded-[var(--radius)]",
        "bg-transparent border border-[var(--color-border)] text-[var(--color-fg)]",
        "placeholder:text-[var(--color-fg-dim)] outline-none ring-focus",
        "text-[13px]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
