import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/copy";

interface HorizontalBarItem {
  label: string;
  value: number;
  color?: string;
}

interface HorizontalBarProps {
  items: HorizontalBarItem[];
  max?: number;
  ariaLabel?: string;
  className?: string;
}

export function HorizontalBar({ items, max, ariaLabel = "horizontal bar list", className }: HorizontalBarProps) {
  const effectiveMax = max ?? items.reduce((acc, item) => Math.max(acc, item.value), 0) ?? 1;
  const safeMax = effectiveMax > 0 ? effectiveMax : 1;
  return (
    <ul role="list" aria-label={ariaLabel} className={cn("flex flex-col gap-1.5", className)}>
      {items.map((item) => {
        const pct = Math.min(100, (item.value / safeMax) * 100);
        return (
          <li key={item.label} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-[12px]">
            <span className="truncate text-[var(--color-fg-muted)]" title={item.label}>
              {item.label}
            </span>
            <span
              role="img"
              aria-label={`${item.label}: ${formatNumber(item.value)}`}
              className="relative h-2 rounded-full bg-[var(--color-bg-elev)] overflow-hidden"
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: item.color ?? "var(--color-accent)",
                }}
              />
            </span>
            <span className="tabular text-right text-[var(--color-fg-dim)]">{formatNumber(item.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
