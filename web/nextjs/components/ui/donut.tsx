import { cn } from "@/lib/utils";

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerHint?: string;
  ariaLabel?: string;
  className?: string;
}

export function Donut({
  segments,
  size = 140,
  thickness = 16,
  centerLabel,
  centerHint,
  ariaLabel = "donut chart",
  className,
}: DonutProps) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("block", className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-bg-elev)"
        strokeWidth={thickness}
      />
      {total > 0 &&
        segments.map((seg) => {
          const fraction = seg.value / total;
          const dash = fraction * circumference;
          const node = (
            <circle
              key={seg.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${seg.label}: ${seg.value}`}</title>
            </circle>
          );
          offset += dash;
          return node;
        })}
      {centerLabel && (
        <text
          x={size / 2}
          y={size / 2 + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-[var(--color-fg)] text-[18px] font-semibold tabular"
        >
          {centerLabel}
        </text>
      )}
      {centerHint && (
        <text
          x={size / 2}
          y={size / 2 + 22}
          textAnchor="middle"
          className="fill-[var(--color-fg-dim)] text-[10px]"
        >
          {centerHint}
        </text>
      )}
    </svg>
  );
}
