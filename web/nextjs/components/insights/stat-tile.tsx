"use client";

import type { ReactNode } from "react";

import { PageState, stateVariantFromError } from "@/components/page-state";
import { StatCard } from "@/components/stat-card";
import { c } from "@/lib/copy";
import { cn } from "@/lib/utils";

interface StatTileProps {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "accent" | "warm" | "cool" | "critical";
  size?: "default" | "lg" | "hero";
  delta?: { value: string; tone?: "positive" | "negative" | "neutral" };
  sparkline?: ReactNode;
  isLoading?: boolean;
  error?: unknown;
  online?: boolean;
  onRetry?: () => void;
  className?: string;
  /** When provided, the tile becomes a button. */
  onToggle?: () => void;
  expanded?: boolean;
  expandedLabel?: string;
  /** Additional content rendered after the tile, e.g. expansion panel. */
  trailing?: ReactNode;
}

export function StatTile({
  label,
  value,
  hint,
  tone,
  size = "hero",
  delta,
  sparkline,
  isLoading,
  error,
  online = true,
  onRetry,
  className,
  onToggle,
  expanded,
  expandedLabel,
  trailing,
}: StatTileProps) {
  const variant = stateVariantFromError(error, online);
  if (variant) {
    return (
      <div className={className}>
        <PageState variant={variant} hint={c("page.insights.error.hint")} action={onRetry} />
      </div>
    );
  }
  const card =
    isLoading ? (
      <StatCard
        label={label}
        value="…"
        hint={hint}
        tone={tone}
        size={size}
        className={cn(onToggle && "cursor-pointer", expanded && "border-[var(--color-accent)]")}
      />
    ) : (
      <StatCard
        label={label}
        value={value}
        hint={hint}
        tone={tone}
        size={size}
        delta={delta}
        sparkline={sparkline}
        className={cn(onToggle && "cursor-pointer", expanded && "border-[var(--color-accent)]")}
      />
    );

  if (!onToggle) {
    return (
      <div className={className}>
        {card}
        {trailing}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!!expanded}
        aria-label={expandedLabel ?? label}
        className="block w-full text-left rounded-[var(--radius-lg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {card}
      </button>
      {trailing}
    </div>
  );
}
