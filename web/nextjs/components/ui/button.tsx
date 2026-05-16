import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  default:
    "bg-[var(--color-bg-elev)] hover:bg-[var(--color-bg-elev-2)] text-[var(--color-fg)] border border-[var(--color-border)]",
  primary:
    "bg-[var(--color-accent)] hover:brightness-110 text-[var(--color-accent-fg)] font-medium",
  ghost:
    "hover:bg-[var(--color-bg-elev-2)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
  danger:
    "bg-[var(--color-critical)]/10 text-[var(--color-critical)] hover:bg-[var(--color-critical)]/20",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
  icon: "h-8 w-8 p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius)] transition-colors duration-150 ring-focus select-none whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
