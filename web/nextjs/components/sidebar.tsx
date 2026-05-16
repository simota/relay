"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  Home, Inbox, Pause, Check, Box, Clock, Activity, MessagesSquare, Pin, CalendarDays,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { getThemeMeta, ThemePicker, useThemeMenuId } from "@/components/theme-picker";
import { api } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { Counts } from "@/lib/types";
import type { SavedView, ViewFilter } from "@/lib/api";

type NavStatus = "open" | "snoozed" | "done";

const NAV: Array<{
  href: string;
  label: string;
  icon: typeof Home;
  key: "today" | NavStatus | "agenda";
  status?: NavStatus;
}> = [
  { href: "/", label: c("nav.today"), icon: Home, key: "today" },
  { href: "/agenda", label: c("nav.agenda"), icon: CalendarDays, key: "agenda" },
  { href: "/tasks?status=open", label: c("nav.open"), icon: Inbox, key: "open", status: "open" },
  { href: "/tasks?status=snoozed", label: c("nav.snoozed"), icon: Pause, key: "snoozed", status: "snoozed" },
  { href: "/tasks?status=done", label: c("nav.done"), icon: Check, key: "done", status: "done" },
];

const BROWSE = [
  { href: "/repos", label: c("nav.repos"), icon: Box, key: "repos" as const },
  { href: "/sessions", label: c("nav.sessions"), icon: MessagesSquare, key: undefined },
  { href: "/contexts", label: c("nav.contexts"), icon: Clock, key: "contexts" as const },
  { href: "/insights", label: c("nav.insights"), icon: Activity, key: undefined },
];

// Order matches the canonical adapter list; each row links to /tasks pre-
// filtered by source so the sidebar count and the destination list agree.
const SOURCES: Array<{ type: string; label: string; countKey: keyof NonNullable<Counts["sources"]> }> = [
  { type: "code_todo",           label: c("source.codeTasks"),    countKey: "code_todo" },
  { type: "github_issue",        label: c("source.githubIssue"),  countKey: "github_issue" },
  { type: "github_pr",           label: c("source.githubPr"),     countKey: "github_pr" },
  { type: "gh_notification",     label: c("source.ghNotification"), countKey: "gh_notification" },
  { type: "gh_run_failure",      label: c("source.ghRunFailure"),  countKey: "gh_run_failure" },
  { type: "gh_project_card",     label: c("source.ghProjectCard"), countKey: "gh_project_card" },
  { type: "git_interrupted",     label: c("source.gitInterrupted"), countKey: "git_interrupted" },
  { type: "git_stash",           label: c("source.gitStash"),     countKey: "git_stash" },
  { type: "orphan_branch",       label: c("source.orphanBranch"), countKey: "orphan_branch" },
  { type: "claude_session_todo", label: c("source.claudeSession"), countKey: "claude_session_todo" },
  { type: "codex_session_todo",  label: c("source.codexSession"), countKey: "codex_session_todo" },
  { type: "gemini_session_todo", label: c("source.geminiSession"), countKey: "gemini_session_todo" },
  { type: "cursor_session_todo", label: c("source.cursorSession"), countKey: "cursor_session_todo" },
  { type: "agents_note",         label: c("source.agents"),       countKey: "agents_note" },
  { type: "manual",              label: c("source.manual"),       countKey: "manual" },
];

export function Sidebar() {
  const path = usePathname();
  const searchParams = useSearchParams();
  const currentStatus = searchParams.get("status");
  const { theme } = useTheme();
  // Theme is only known after the inline init script runs (= after mount),
  // so we delay rendering the theme-dependent icon until then to keep the
  // SSR'd HTML identical to the first client render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useThemeMenuId();
  const currentMeta = getThemeMeta(theme);
  const CurrentIcon = currentMeta.icon;
  const currentLabel = c(currentMeta.labelKey);
  const { data: counts } = useSWR<Counts>("/api/counts", () => api.counts(), {
    refreshInterval: 30_000,
  });
  const { data: views = [] } = useSWR<SavedView[]>("/api/views", () => api.views.list(), {
    refreshInterval: 30_000,
  });
  const pinnedViews = views.filter((view) => view.pinned);

  return (
    <aside className="h-full w-[220px] shrink-0 border-r border-[var(--color-border)] flex flex-col">
      <div className="h-12 flex items-center px-4 border-b border-[var(--color-border)]">
        <Brand />
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-5">
        <Section title={c("nav.views")}>
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              active={isNavActive(path, currentStatus, item)}
              icon={<item.icon className="w-3.5 h-3.5" />}
              count={navCount(counts, item.key)}
            >
              {item.label}
            </NavLink>
          ))}
        </Section>

        {pinnedViews.length > 0 && (
          <Section title={c("nav.pinnedViews")}>
            {pinnedViews.map((view) => (
              <NavLink
                key={`${view.smart ? "smart" : "saved"}-${view.id}`}
                href={viewHref(view.filter)}
                active={isViewActive(path, searchParams, view.filter)}
                icon={<Pin className="w-3.5 h-3.5" />}
                count={view.count}
              >
                {view.name}
              </NavLink>
            ))}
          </Section>
        )}

        <Section title={c("nav.browse")}>
          {BROWSE.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              active={path.startsWith(item.href)}
              icon={<item.icon className="w-3.5 h-3.5" />}
              count={item.key ? counts?.[item.key] : undefined}
            >
              {item.label}
            </NavLink>
          ))}
        </Section>

        <Section title={c("nav.sources")}>
          {SOURCES.map((s) => (
            <SourceLink
              key={s.type}
              source={s.type}
              label={s.label}
              count={counts?.sources?.[s.countKey]}
              active={isViewActive(path, searchParams, { source: s.type })}
            />
          ))}
        </Section>
      </nav>

      <div className="px-4 py-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-fg-dim)] flex items-center gap-2">
        {/* Theme comes from <html data-theme> set by the inline script in
            layout.tsx, which only runs on the client. On SSR / first client
            render we keep the button empty so both renders match exactly;
            the icon mounts once we know the resolved theme. */}
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] text-[var(--color-fg-muted)] transition-colors ring-focus hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-fg)]"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            aria-controls={menuId}
            aria-label={mounted ? c("common.switchTheme", { theme: currentLabel }) : c("common.switchTheme", { theme: c("common.light") })}
            title={mounted ? c("common.switchTheme", { theme: currentLabel }) : undefined}
          >
            {mounted ? (
              <CurrentIcon className="h-3.5 w-3.5" />
            ) : (
              <span className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
          {mounted && (
            <ThemePicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              triggerRef={triggerRef}
              menuId={menuId}
            />
          )}
        </div>
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
        <span className="font-mono">{c("app.version")}</span>
      </div>
    </aside>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-cool)] flex items-center justify-center text-[var(--color-accent-fg)] text-[10px] font-bold">
        r
      </div>
      <span className="font-mono text-[13px] font-medium tracking-tight">{c("app.brand")}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 mb-1 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
        {title}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

function NavLink({
  href,
  active,
  icon,
  count,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-2 px-2 h-7 rounded-[var(--radius)] text-[12.5px] transition-colors",
        active
          ? "bg-[var(--color-bg-elev-2)] text-[var(--color-fg)]"
          : "text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-fg)]",
      )}
    >
      <span className={cn("opacity-80", active && "text-[var(--color-accent)] opacity-100")}>{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {count !== undefined && (
        <span className={cn(
          "tabular min-w-5 h-4 px-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] text-center text-[11px] leading-4",
          active ? "text-[var(--color-accent)]" : "text-[var(--color-fg-dim)]",
        )}>
          {formatNumber(count)}
        </span>
      )}
    </Link>
  );
}

function SourceLink({
  source,
  label,
  count,
  active,
}: {
  source: string;
  label: string;
  count?: number;
  active: boolean;
}) {
  return (
    <Link
      href={`/tasks?source=${encodeURIComponent(source)}`}
      className={cn(
        "group flex items-center px-2 h-6 rounded-[var(--radius)] text-[11.5px] transition-colors",
        active
          ? "bg-[var(--color-bg-elev-2)] text-[var(--color-fg)]"
          : "text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-fg)]",
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      <span
        className={cn(
          "tabular text-[12px]",
          active ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]",
        )}
      >
        {formatNumber(count ?? 0)}
      </span>
    </Link>
  );
}

function navCount(
  counts: Counts | undefined,
  key: "today" | NavStatus | "agenda",
): number | undefined {
  if (!counts) return undefined;
  // Agenda doesn't carry a single integer in /api/counts — the badge would
  // need a separate fetch. Skip the badge for now; the page itself shows
  // overdue / per-day totals inline.
  if (key === "agenda") return undefined;
  return counts[key];
}

function isNavActive(
  path: string,
  currentStatus: string | null,
  item: { href: string; key: string; status?: NavStatus },
): boolean {
  const base = item.href.split("?")[0]!;
  // next.config.ts sets trailingSlash:true, so usePathname() yields "/tasks/"
  // rather than "/tasks". Normalize so equality matches the bare href.
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (item.key === "today") return normalized === base;
  // For /tasks entries, distinguish by the `status` query param so only the
  // matching nav row lights up instead of all three (open/snoozed/done).
  if (item.status) return normalized === base && currentStatus === item.status;
  return normalized === base || normalized.startsWith(`${base}/`);
}

function viewHref(filter: ViewFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.repo) params.set("repo", filter.repo);
  if (filter.source) params.set("source", filter.source);
  if (filter.age) params.set("age", filter.age);
  const qs = params.toString();
  return `/tasks${qs ? `?${qs}` : ""}`;
}

function isViewActive(
  path: string,
  current: URLSearchParams,
  filter: ViewFilter,
): boolean {
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalized !== "/tasks") return false;
  // A view is active when the URL's query params exactly match the filter —
  // not just a subset, otherwise a `status=open` URL would light up every
  // view that happens to include `status=open` plus extra filters.
  const a = new URLSearchParams();
  if (filter.status) a.set("status", filter.status);
  if (filter.repo) a.set("repo", filter.repo);
  if (filter.source) a.set("source", filter.source);
  if (filter.age) a.set("age", filter.age);
  const b = new URLSearchParams();
  for (const k of ["status", "repo", "source", "age"]) {
    const v = current.get(k);
    if (v) b.set(k, v);
  }
  a.sort();
  b.sort();
  return a.toString() === b.toString();
}
