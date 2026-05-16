"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { c, formatUtcLongDate, formatUtcNumericDate } from "@/lib/copy";
import { useTheme } from "@/components/theme-provider";
import type { HeatmapData } from "@/lib/api";
import type { SourceType } from "@/lib/types";

const CELL = 22;
const GAP = 5;
const LEFT = 150;
const TOP = 30;
const RIGHT = 20;
const BOTTOM = 34;
type ThemeName = "dark" | "light";

const HEATMAP_COLORS: Record<ThemeName, readonly string[]> = {
  dark: [
    "var(--color-fg-dim)",
    "var(--color-fg-muted)",
    "var(--color-cool)",
    "var(--color-warm)",
    "var(--color-accent)",
  ],
  light: [
    "var(--color-accent)",
    "var(--color-cool)",
    "var(--color-fg-muted)",
    "var(--color-critical)",
    "var(--color-fg)",
  ],
};
const SOURCE_ITEMS: Record<ThemeName, Array<{
  source: SourceType;
  label: string;
  color: string;
}>> = {
  dark: [
    { source: "code_todo", label: "code todo", color: "var(--color-fg-muted)" },
    { source: "github_issue", label: "issue", color: "var(--color-cool)" },
    { source: "github_pr", label: "PR", color: "var(--color-warm)" },
    { source: "claude_session_todo", label: "session", color: "var(--color-accent)" },
    { source: "agents_note", label: ".agents", color: "var(--color-fg-dim)" },
    { source: "manual", label: "manual", color: "var(--color-fg)" },
  ],
  light: [
    { source: "code_todo", label: "code todo", color: "var(--color-fg-muted)" },
    { source: "github_issue", label: "issue", color: "var(--color-cool)" },
    { source: "github_pr", label: "PR", color: "var(--color-critical)" },
    { source: "claude_session_todo", label: "session", color: "var(--color-accent)" },
    { source: "agents_note", label: ".agents", color: "var(--color-fg)" },
    { source: "manual", label: "manual", color: "var(--color-fg)" },
  ],
};

interface HeatmapProps {
  data: HeatmapData;
  activeOnly: boolean;
  activeSources: SourceType[];
  onToggleSource: (source: SourceType) => void;
}

export function Heatmap({ data, activeOnly, activeSources, onToggleSource }: HeatmapProps) {
  const router = useRouter();
  const { theme } = useTheme();
  // Sunset, notebook, washi, and sketch use light color-scheme; reuse the light
  // palette so chart contrast stays consistent without maintaining extra
  // hand-tuned ramps. Matrix, ocean, and blueprint are dark color-schemes, so
  // they reuse the dark palette.
  const paletteKey: ThemeName =
    theme === "dark" || theme === "matrix" || theme === "ocean" || theme === "blueprint" ? "dark" : "light";
  const colors = HEATMAP_COLORS[paletteKey];
  const sourceItems = SOURCE_ITEMS[paletteKey];
  const filteredSource = activeSources.length === 1 ? activeSources[0] : undefined;
  const rows = useMemo(
    () =>
      data.repos
        .map((repo, index) => ({
          repo,
          index,
          active: (data.open?.[index] ?? []).some((count) => count > 0),
        }))
        .filter((row) => !activeOnly || row.active),
    [activeOnly, data.open, data.repos],
  );
  const activeSourceSet = useMemo(() => new Set(activeSources), [activeSources]);

  const width = LEFT + data.weeks.length * (CELL + GAP) - GAP + RIGHT;
  const height = TOP + rows.length * (CELL + GAP) - GAP + BOTTOM;

  const openTasksForDate = (date: string) => {
    const params = new URLSearchParams({ completed_on: date });
    if (filteredSource) params.set("source", filteredSource);
    router.push(`/tasks?${params.toString()}`);
  };

  if (data.weeks.length === 0 || rows.length === 0) {
    return (
      <div>
        <SourceLegend activeSourceSet={activeSourceSet} sourceItems={sourceItems} onToggleSource={onToggleSource} />
        <div className="py-12 text-center text-[13px] text-[var(--color-fg-dim)]">
          {c("heatmap.empty")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SourceLegend activeSourceSet={activeSourceSet} sourceItems={sourceItems} onToggleSource={onToggleSource} />
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={c("heatmap.aria")}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-full"
        >
          {data.weeks.map((week, index) => (
            <text
              key={week}
              x={LEFT + index * (CELL + GAP) + CELL / 2}
              y={17}
              textAnchor="middle"
              className="fill-[var(--color-fg-dim)] text-[10px] font-mono"
            >
              {formatWeek(week)}
            </text>
          ))}

          {rows.map((row, rowIndex) => {
            const y = TOP + rowIndex * (CELL + GAP);
            return (
              <g key={row.repo}>
                <text
                  x={LEFT - 10}
                  y={y + CELL / 2 + 4}
                  textAnchor="end"
                  className="fill-[var(--color-fg-muted)] text-[11px] font-mono"
                >
                  {truncate(row.repo)}
                </text>
                {data.weeks.map((week, weekIndex) => {
                  const value = data.cells[row.index]?.[weekIndex] ?? 0;
                  const openCount = data.open?.[row.index]?.[weekIndex] ?? 0;
                  const closedCount = data.closed?.[row.index]?.[weekIndex] ?? 0;
                  return (
                    <rect
                      key={`${row.repo}-${week}`}
                      x={LEFT + weekIndex * (CELL + GAP)}
                      y={y}
                      width={CELL}
                      height={CELL}
                      rx={4}
                      fill={colorFor(value, colors)}
                      opacity={openCount + closedCount === 0 ? 0.28 : 1}
                      className="cursor-pointer outline-none transition-opacity hover:opacity-80 focus-visible:opacity-80"
                      tabIndex={0}
                      role="link"
                      aria-label={`${row.repo} ${week} completed tasks`}
                      onClick={() => openTasksForDate(week)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openTasksForDate(week);
                        }
                      }}
                    >
                      <title>
                        {`${row.repo} · ${formatLongWeek(week)} · open ${openCount} · closed ${closedCount}`}
                      </title>
                    </rect>
                  );
                })}
              </g>
            );
          })}

          <text
            x={LEFT}
            y={height - 10}
            className="fill-[var(--color-fg-dim)] text-[10px] font-mono"
          >
            lower open ratio
          </text>
          {colors.map((color, index) => (
            <rect
              key={color}
              x={LEFT + 116 + index * 19}
              y={height - 20}
              width={14}
              height={14}
              rx={3}
              fill={color}
            />
          ))}
          <text
            x={LEFT + 222}
            y={height - 10}
            className="fill-[var(--color-fg-dim)] text-[10px] font-mono"
          >
            higher open ratio
          </text>
        </svg>
      </div>
    </div>
  );
}

function SourceLegend({
  activeSourceSet,
  sourceItems,
  onToggleSource,
}: {
  activeSourceSet: Set<SourceType>;
  sourceItems: Array<{ source: SourceType; label: string; color: string }>;
  onToggleSource: (source: SourceType) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {sourceItems.map((item) => {
        const active = activeSourceSet.has(item.source);
        const Icon = active ? Eye : EyeOff;
        return (
          <Button
            key={item.source}
            type="button"
            size="sm"
            variant={active ? "default" : "ghost"}
            aria-pressed={active}
            onClick={() => onToggleSource(item.source)}
            className={active ? "" : "opacity-65"}
          >
            <Icon size={14} aria-hidden="true" />
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}

function colorFor(value: number, colors: readonly string[]): string {
  if (value <= 0) return colors[0]!;
  if (value <= 0.25) return colors[1]!;
  if (value <= 0.5) return colors[2]!;
  if (value <= 0.75) return colors[3]!;
  return colors[4]!;
}

function formatWeek(value: string): string {
  return formatUtcNumericDate(new Date(value));
}

function formatLongWeek(value: string): string {
  return formatUtcLongDate(new Date(value));
}

function truncate(value: string): string {
  return value.length <= 22 ? value : `${value.slice(0, 9)}...${value.slice(-10)}`;
}
