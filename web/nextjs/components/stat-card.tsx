"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/copy";

type Tone = "default" | "accent" | "warm" | "cool" | "critical";

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
  size?: "default" | "lg" | "hero";
  trend?: { dir: "up" | "down" | "flat"; value: string };
  delta?: { value: string; tone?: "positive" | "negative" | "neutral" };
  sparkline?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const toneColor: Record<Tone, string> = {
  default: "text-[var(--color-fg)]",
  accent: "text-[var(--color-accent)]",
  warm: "text-[var(--color-warm)]",
  cool: "text-[var(--color-cool)]",
  critical: "text-[var(--color-critical)]",
};

const deltaColor: Record<NonNullable<NonNullable<StatCardProps["delta"]>["tone"]>, string> = {
  positive: "text-[var(--color-accent)]",
  negative: "text-[var(--color-warm)]",
  neutral: "text-[var(--color-fg-dim)]",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  size = "default",
  trend,
  delta,
  sparkline,
  className,
  children,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-bg-elev)]/40 backdrop-blur-sm",
        "p-4 overflow-hidden",
        "hover:border-[var(--color-border-strong)] transition-colors",
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent opacity-50" />
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium mb-2">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "tabular font-semibold tracking-tight",
            toneColor[tone],
            size === "hero" ? "text-[32px]" : size === "lg" ? "text-[36px]" : "text-[24px]",
          )}
        >
          {typeof value === "number" ? formatNumber(value) : value}
        </span>
        {trend && (
          <span
            className={cn(
              "text-[11px] tabular",
              trend.dir === "up"
                ? "text-[var(--color-accent)]"
                : trend.dir === "down"
                  ? "text-[var(--color-critical)]"
                  : "text-[var(--color-fg-dim)]",
            )}
          >
            {trend.dir === "up" ? "↑" : trend.dir === "down" ? "↓" : "·"} {trend.value}
          </span>
        )}
        {delta && (
          <span className={cn("ml-auto text-[11px] tabular", deltaColor[delta.tone ?? "neutral"])}>
            {delta.value}
          </span>
        )}
      </div>
      {children && (
        <div
          className={cn(
            "mt-2",
            size === "hero" &&
              "grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 items-baseline text-[12px] text-[var(--color-fg-muted)]",
          )}
        >
          {children}
        </div>
      )}
      {sparkline && <div className="mt-2 flex items-end justify-end">{sparkline}</div>}
      {hint && <div className="mt-1 text-[11px] text-[var(--color-fg-dim)] font-mono">{hint}</div>}
    </div>
  );
}
