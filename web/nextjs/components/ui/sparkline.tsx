import { cn } from "@/lib/utils";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  ariaLabel?: string;
  className?: string;
}

export function Sparkline({
  values,
  width = 96,
  height = 24,
  ariaLabel = "trend sparkline",
  className,
}: SparklineProps) {
  if (values.length < 3) {
    return (
      <span
        role="img"
        aria-label={ariaLabel}
        className={cn("text-[12px] text-[var(--color-fg-dim)] tabular", className)}
      >
        —
      </span>
    );
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const last = values[values.length - 1]!;
  const lastX = (values.length - 1) * stepX;
  const lastY = height - ((last - min) / range) * (height - 4) - 2;
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
    >
      <polyline
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <circle cx={lastX} cy={lastY} r={2} fill="var(--color-accent)" />
    </svg>
  );
}
