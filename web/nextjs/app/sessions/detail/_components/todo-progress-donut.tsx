"use client";

import { useMemo } from "react";
import type { SessionTodo } from "@/lib/api";
import { getTodoStatusColor } from "../_lib/colors";
import { computeTodoStats } from "../_lib/stats";

const SIZE = 56;
const STROKE = 10;

interface Segment {
  key: "completed" | "in_progress" | "pending";
  color: string;
  count: number;
}

export function TodoProgressDonut({ todos }: { todos: SessionTodo[] }) {
  const stats = useMemo(() => computeTodoStats(todos), [todos]);
  if (stats.total === 0) return null;

  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  const segments: Segment[] = [
    { key: "completed", color: getTodoStatusColor("completed"), count: stats.completed },
    { key: "in_progress", color: getTodoStatusColor("in_progress"), count: stats.in_progress },
    { key: "pending", color: getTodoStatusColor("pending"), count: stats.pending },
  ];

  let offset = 0;
  const drawn = segments
    .filter((s) => s.count > 0)
    .map((s) => {
      const len = (s.count / stats.total) * circumference;
      const dash = `${len} ${circumference - len}`;
      const off = -offset;
      offset += len;
      return { ...s, dash, off };
    });

  return (
    <div className="flex items-center gap-3">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Todo progress: ${stats.completed} of ${stats.total} done`}
      >
        <title>
          {`completed: ${stats.completed}\nin_progress: ${stats.in_progress}\npending: ${stats.pending}`}
        </title>
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={STROKE}
        />
        {drawn.map((s) => (
          <circle
            key={s.key}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={STROKE}
            strokeDasharray={s.dash}
            strokeDashoffset={s.off}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ))}
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="text-[13px] font-semibold text-[var(--color-fg)]">
          {stats.completed}/{stats.total} done
        </span>
        <span className="text-[11px] font-mono text-[var(--color-fg-muted)]">
          {stats.percent.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
