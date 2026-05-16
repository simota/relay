import { cn } from "@/lib/utils";

interface DivergingDailyBarProps {
  data: Array<{ day: string; opened: number; closed: number }>;
  ariaLabel?: string;
  height?: number;
  className?: string;
}

export function DivergingDailyBar({
  data,
  ariaLabel = "Opened vs closed daily flow",
  height = 140,
  className,
}: DivergingDailyBarProps) {
  if (data.length === 0) return null;
  const max = data.reduce((acc, d) => Math.max(acc, d.opened, d.closed), 0) || 1;
  const half = height / 2;
  const inner = half - 4;
  const colW = 100 / data.length;
  const barW = Math.max(colW * 0.7, 0.5);
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className={cn("block w-full", className)}
      style={{ height }}
    >
      <line
        x1={0}
        y1={half}
        x2={100}
        y2={half}
        stroke="var(--color-border)"
        strokeWidth={0.4}
        vectorEffect="non-scaling-stroke"
      />
      {data.map((d, i) => {
        const cx = colW * (i + 0.5);
        const openedH = (d.opened / max) * inner;
        const closedH = (d.closed / max) * inner;
        return (
          <g key={d.day}>
            <rect
              x={cx - barW / 2}
              y={half - openedH}
              width={barW}
              height={openedH}
              fill="var(--color-warm)"
              opacity={0.85}
            >
              <title>{`${d.day} · opened ${d.opened}`}</title>
            </rect>
            <rect
              x={cx - barW / 2}
              y={half}
              width={barW}
              height={closedH}
              fill="var(--color-accent)"
              opacity={0.85}
            >
              <title>{`${d.day} · closed ${d.closed}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}
