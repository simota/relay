"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, CalendarClock, History, NotebookPen, ScrollText } from "lucide-react";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageState } from "@/components/page-state";
import { api } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import { cn, timeAgo } from "@/lib/utils";
import type {
  ActivityDay,
  ActivityItem,
  AgendaDay,
  AgendaReport,
  Task,
} from "@/lib/types";

const WINDOW_OPTIONS = [7, 14, 30] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];
const DEFAULT_WINDOW: WindowDays = 7;

export default function AgendaPage() {
  const [days, setDays] = useState<WindowDays>(DEFAULT_WINDOW);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const scrolledOnceRef = useRef(false);
  const { data, isLoading } = useSWR<AgendaReport>(
    `/api/agenda?days=${days}`,
    () => api.agenda(days),
    { refreshInterval: 60_000 },
  );

  const recentActivityCount = useMemo(
    () => (data?.recentActivity ?? []).reduce((s, d) => s + d.items.length, 0),
    [data?.recentActivity],
  );
  const isEmpty = useMemo(() => {
    if (!data) return false;
    return (
      data.overdue.length === 0 &&
      data.daysList.every((d) => d.tasks.length === 0) &&
      data.scheduledNoDate.length === 0 &&
      recentActivityCount === 0
    );
  }, [data, recentActivityCount]);

  // Scroll Today into view exactly once per mount, after the day grid renders.
  // Honor prefers-reduced-motion so users with vestibular sensitivity don't
  // get smooth-scroll on first paint.
  useEffect(() => {
    if (scrolledOnceRef.current) return;
    if (!data || isEmpty) return;
    const node = todayRef.current;
    if (!node) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
    scrolledOnceRef.current = true;
  }, [data, isEmpty]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6 space-y-5 max-w-[1400px]">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">{c("agenda.title")}</h1>
            <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
              {c("agenda.subtitle", { days })}
            </p>
          </div>
          <div className="flex rounded-[var(--radius)] border border-[var(--color-border)] p-0.5">
            {WINDOW_OPTIONS.map((w) => (
              <Button
                key={w}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDays(w)}
                aria-pressed={days === w}
                className={cn(
                  "h-6 px-2 rounded-[var(--radius-sm)] font-mono text-[11px]",
                  days === w && "bg-[var(--color-bg-elev)] text-[var(--color-fg)]",
                )}
              >
                {w}d
              </Button>
            ))}
          </div>
        </div>

        {!data && isLoading && (
          <div className="text-[13px] text-[var(--color-fg-dim)] text-center py-12">
            {c("common.loading")}
          </div>
        )}

        {data && isEmpty && (
          <PageState
            variant="empty"
            title={c("page.agenda.emptyTitle")}
            hint={c("page.agenda.emptyHint")}
          />
        )}

        {data && !isEmpty && (
          <>
            {data.overdue.length > 0 && (
              <OverdueCard tasks={data.overdue} />
            )}

            <div
              className={cn(
                "grid gap-3",
                days === 7
                  ? "grid-cols-[repeat(7,minmax(0,1fr))]"
                  : "grid-cols-[repeat(auto-fill,minmax(260px,1fr))]",
              )}
            >
              {data.daysList.map((day) => (
                <DayCard key={day.date} day={day} todayRef={todayRef} />
              ))}
            </div>

            {data.scheduledNoDate.length > 0 && (
              <ScheduledNoDateCard tasks={data.scheduledNoDate} />
            )}

            {data.recentActivity && recentActivityCount > 0 && (
              <RecentActivityBand
                activityDays={data.recentActivity}
                totalItems={recentActivityCount}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RecentActivityBand({
  activityDays,
  totalItems,
}: {
  activityDays: ActivityDay[];
  totalItems: number;
}) {
  // Hide empty trailing days so the layout compacts when only the last
  // 2-3 days have anything — the band stays readable without forcing the
  // user to scroll past N empty cards.
  const nonEmpty = activityDays.filter((d) => d.items.length > 0);
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[var(--color-fg-muted)]" />
          <CardTitle>
            Recent activity · {formatNumber(totalItems)}
          </CardTitle>
        </div>
        <span className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          past {activityDays.length} days · agent sessions + journal entries
        </span>
      </CardHeader>
      <CardBody>
        <div className="space-y-3">
          {nonEmpty.map((day) => (
            <div key={day.date}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="font-mono text-[12px] font-semibold text-[var(--color-fg)]">
                  {day.weekday}
                </span>
                <span className="font-mono text-[11px] text-[var(--color-fg-dim)]">
                  {day.date}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)] ml-auto">
                  {formatNumber(day.items.length)}
                </span>
              </div>
              <ul className="space-y-1">
                {day.items.map((item, i) => (
                  <ActivityRow key={`${day.date}-${i}`} item={item} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  if (item.kind === "promise_ledger") {
    const href = `/sessions?type=${encodeURIComponent(item.session.type)}&id=${encodeURIComponent(item.session.id)}`;
    return (
      <li>
        <Link
          href={href}
          className="group flex items-start gap-2 rounded-[var(--radius)] px-1.5 py-1 text-[12px] hover:bg-[var(--color-bg-elev-2)] transition-colors"
          title={`Resume session · ${item.ts}`}
        >
          <ScrollText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warm)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[10px] text-[var(--color-fg-dim)] shrink-0">
                {item.session.type}
              </span>
              {item.repo && (
                <span className="font-mono text-[11px] text-[var(--color-cool)] truncate">
                  {item.repo}
                </span>
              )}
              <span className="font-mono text-[10px] text-[var(--color-fg-dim)] shrink-0">
                {timeAgo(item.ts)}
              </span>
            </div>
            <div className="text-[12px] text-[var(--color-fg)] truncate">{item.title}</div>
          </div>
          <Badge
            className="shrink-0 bg-[var(--color-warm)]/15 text-[var(--color-warm)] border-[var(--color-warm)]/30"
            title="unmet promises in this session"
          >
            {formatNumber(item.unmet_count)} unmet
          </Badge>
        </Link>
      </li>
    );
  }
  // agent_journal
  return (
    <li>
      <div
        className="flex items-start gap-2 rounded-[var(--radius)] px-1.5 py-1 text-[12px]"
        title={`${item.repo}/.agents/${item.agent}.md`}
      >
        <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-fg-muted)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[11px] text-[var(--color-cool)] truncate">
              {item.repo}
            </span>
            <span className="font-mono text-[10.5px] text-[var(--color-fg-muted)]">
              {item.agent}
            </span>
          </div>
          <div className="text-[12px] text-[var(--color-fg)] truncate">{item.title}</div>
        </div>
      </div>
    </li>
  );
}

function OverdueCard({ tasks }: { tasks: Task[] }) {
  // Loud red treatment per AC: "overdue is the red background section at the
  // top". We use a critical-tinted background + border so the block stands
  // out of the calendar grid even at a glance.
  return (
    <Card className="border-[var(--color-critical)]/40 bg-[var(--color-critical)]/10">
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--color-critical)]" />
          <CardTitle className="text-[var(--color-critical)] !tracking-wider">
            {c("agenda.overdue")} · {formatNumber(tasks.length)}
          </CardTitle>
        </div>
        <span className="text-[10.5px] uppercase tracking-wider text-[var(--color-critical)]/80">
          {c("agenda.overdue.hint")}
        </span>
      </CardHeader>
      <CardBody>
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} showDue />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function DayCard({
  day,
  todayRef,
}: {
  day: AgendaDay;
  todayRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const isToday = day.date === todayLocalYmd();
  return (
    <Card
      ref={isToday ? todayRef : undefined}
      className={cn(
        "flex flex-col border-t",
        isToday
          ? "border-t-2 border-t-[var(--color-accent)] border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5"
          : "border-t-[var(--color-border)]",
      )}
    >
      <CardHeader className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "font-mono text-[13px] font-semibold",
              isToday ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]",
            )}
          >
            {day.weekday}
          </span>
          <span className="font-mono text-[11px] text-[var(--color-fg-dim)]">
            {day.date}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          {formatNumber(day.tasks.length)}
        </span>
      </CardHeader>
      <CardBody className="flex-1">
        {day.tasks.length === 0 ? (
          <div className="text-[11px] text-[var(--color-fg-dim)] italic">
            {c("agenda.dayEmpty")}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {day.tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function ScheduledNoDateCard({ tasks }: { tasks: Task[] }) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-[var(--color-fg-muted)]" />
          <CardTitle>
            {c("agenda.scheduled")} · {formatNumber(tasks.length)}
          </CardTitle>
        </div>
        <span className="text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          {c("agenda.scheduled.hint")}
        </span>
      </CardHeader>
      <CardBody>
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function TaskRow({ task, showDue }: { task: Task; showDue?: boolean }) {
  return (
    <li>
      <Link
        href={`/tasks?selected=${task.id}`}
        className="group flex items-start gap-2 rounded-[var(--radius)] px-1.5 py-1 text-[12px] hover:bg-[var(--color-bg-elev-2)] transition-colors"
        title={task.title}
      >
        <StatusDot status={task.status} className="mt-1.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[10px] text-[var(--color-fg-dim)] shrink-0">
              #{task.id}
            </span>
            <span className="font-mono text-[11px] text-[var(--color-cool)] truncate">
              {task.repo}
            </span>
          </div>
          <div className="text-[12.5px] text-[var(--color-fg)] truncate group-hover:text-[var(--color-fg)]">
            {task.title}
          </div>
          {showDue && task.due_at && (
            <div className="mt-0.5 text-[10px] text-[var(--color-critical)] font-mono">
              {c("agenda.dueLabel", { date: formatDueShort(task.due_at) })}
            </div>
          )}
        </div>
        {task.wait_on === "scheduled" && (
          <Badge className="shrink-0">scheduled</Badge>
        )}
      </Link>
    </li>
  );
}

function todayLocalYmd(): string {
  // Match the server's ymdLocal — pad month / day so string compare works.
  const at = new Date();
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDueShort(iso: string): string {
  // Render due_at in the user's local TZ — UTC-formatted ISO would mis-label
  // overdue rows near midnight.
  const at = new Date(iso);
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
