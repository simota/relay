"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  api,
  type SessionDetail,
  type SessionSummary,
  type SessionType,
} from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { MAX_TILES } from "../_constants";
import { formatDuration, truncatePath } from "../_lib/format";
import { computeStats } from "../_lib/stats";
import type { RoleFilter, StreamStatus, TileSpec } from "../_types";
import { RelativeTime, TypeBadge } from "./badges";
import { MessagesList } from "./messages-list";
import { SessionTasksPanel } from "./session-tasks-panel";
import { StreamStatusBadge, WaitingForUserBadge } from "./session-tile";
import { TabButton } from "./tab-button";
import { TodosList } from "./todos-list";
import { ToolCallsList } from "./tool-calls-list";

// ---------------------------------------------------------------------------
// SessionTileView — the main content view for one session tile
// (previously SessionDetailView; adapted for tile context)
// ---------------------------------------------------------------------------
export function SessionTileView({
  data,
  streamStatus,
  freshMessageKeys,
  onClose,
  tileIndex,
  onReplaceTile,
  onAddSubagents,
  currentTileCount,
}: {
  data: SessionDetail;
  streamStatus: StreamStatus;
  freshMessageKeys?: ReadonlySet<string>;
  onClose?: () => void;
  tileIndex: number;
  onReplaceTile: (index: number, spec: TileSpec) => void;
  onAddSubagents: (agentIds: string[], type: SessionType) => void;
  currentTileCount: number;
}) {
  const [tab, setTab] = useState<"messages" | "todos" | "tools">("messages");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [search, setSearch] = useState("");

  // Compact layout kicks in when the board hosts 4+ tiles — shrink header,
  // metadata, and chrome so the message body stays readable in a 3×2 grid.
  const compact = currentTileCount >= 4;

  const stats = useMemo(() => computeStats(data.messages), [data.messages]);
  const duration = useMemo(
    () => formatDuration(data.started_at, data.last_active),
    [data.started_at, data.last_active],
  );

  const isSubagent = !!data.parent_session_id;
  const hasSubagents = (data.subagent_count ?? 0) > 0;
  const [addingSubagents, setAddingSubagents] = useState(false);

  const handleAddAllSubagents = useCallback(async () => {
    if (addingSubagents) return;
    setAddingSubagents(true);
    try {
      const subagents: SessionSummary[] = await api.sessions({
        type: data.type,
        parent: data.id,
        includeSubagents: true,
      });
      const agentIds = subagents
        .filter((s) => s.agent_id)
        .map((s) => s.id);
      onAddSubagents(agentIds, data.type);
    } catch (e) {
      console.warn("[relay] failed to fetch subagents:", e);
    } finally {
      setAddingSubagents(false);
    }
  }, [addingSubagents, data.id, data.type, onAddSubagents]);

  const handleGoToParent = useCallback(() => {
    if (!data.parent_session_id) return;
    onReplaceTile(tileIndex, { type: data.type, id: data.parent_session_id });
  }, [data.parent_session_id, data.type, tileIndex, onReplaceTile]);

  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = data.messages.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (q && !m.text.toLowerCase().includes(q)) return false;
      return true;
    });
    return matched.slice().reverse();
  }, [data.messages, roleFilter, search]);

  const filteredTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = !q
      ? data.tool_calls
      : data.tool_calls.filter(
          (tc) =>
            tc.name.toLowerCase().includes(q) ||
            tc.args_summary.toLowerCase().includes(q) ||
            (tc.args_json?.toLowerCase().includes(q) ?? false),
        );
    return matched.slice().reverse();
  }, [data.tool_calls, search]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tile header */}
      <div className={cn("flex-shrink-0 space-y-1.5", compact ? "px-3 pt-2 pb-1" : "px-4 pt-3 pb-2")}>
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={data.type} />
          {data.repo ? (
            <Link
              href="/repos"
              className={cn(
                "font-mono text-[var(--color-fg)] hover:text-[var(--color-accent)] hover:underline",
                compact ? "text-[12px]" : "text-[13px]",
              )}
            >
              {data.repo}
            </Link>
          ) : (
            <span
              className={cn("font-mono text-[var(--color-fg-dim)]", compact ? "text-[12px]" : "text-[13px]")}
            >
              —
            </span>
          )}
          <span className="text-[var(--color-fg-dim)]">·</span>
          <RelativeTime iso={data.last_active} />
          {!compact && (
            <>
              <span className="text-[var(--color-fg-dim)]">·</span>
              <StreamStatusBadge status={streamStatus} />
            </>
          )}
          {/* Waiting badge is non-null only when the SSE-delivered detail
              classifies this session as needing user action. Placed before
              the spacer so it sits next to the stream/type chips and
              dominates the user's attention. */}
          <WaitingForUserBadge status={data.status} compact={compact} />
          <div className="flex-1" />
          {compact && <StreamStatusBadge status={streamStatus} />}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close tile"
              className="text-[11px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] hover:border-[var(--color-fg-muted)] transition-colors"
            >
              ✕
            </button>
          )}
        </div>
        <h2
          className={cn(
            "font-semibold tracking-tight leading-snug",
            compact ? "text-[13px] line-clamp-1" : "text-[15px]",
          )}
          title={compact ? data.title : undefined}
        >
          {data.title}
        </h2>
        {isSubagent && data.parent_session_id && (
          <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-[var(--color-fg-dim)]">
            <span>↑ Parent:</span>
            <span className="font-mono">{data.parent_session_id.slice(0, 8)}…</span>
            <button
              type="button"
              onClick={handleGoToParent}
              className="text-[var(--color-accent)] hover:underline"
            >
              (open)
            </button>
          </div>
        )}
        {!isSubagent && hasSubagents && (
          <div className="flex items-center gap-2 text-[10.5px] font-mono text-[var(--color-fg-dim)]">
            <span>Subagents: {data.subagent_count}</span>
            {currentTileCount < MAX_TILES && (
              <button
                type="button"
                onClick={() => void handleAddAllSubagents()}
                disabled={addingSubagents}
                className="text-[var(--color-accent)] hover:underline disabled:opacity-50 disabled:cursor-wait"
              >
                {addingSubagents ? "loading…" : "+ Add all subagents"}
              </button>
            )}
          </div>
        )}
        {!compact && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10.5px] text-[var(--color-fg-dim)] font-mono">
            <span title={data.cwd ?? ""}>cwd: {truncatePath(data.cwd ?? "—", 50)}</span>
            <span>session: {data.id.slice(0, 8)}</span>
            {stats.user > 0 && <span>user: {formatNumber(stats.user)}</span>}
            {stats.assistant > 0 && <span>assistant: {formatNumber(stats.assistant)}</span>}
            {stats.tool > 0 && <span>tool: {formatNumber(stats.tool)}</span>}
            <span>duration: {duration}</span>
          </div>
        )}
        {compact && (
          <div className="flex items-center gap-3 text-[10.5px] text-[var(--color-fg-dim)] font-mono">
            <span title={data.cwd ?? ""} className="truncate max-w-[40%]">
              {truncatePath(data.cwd ?? "—", 32)}
            </span>
            {stats.user + stats.assistant > 0 && (
              <span>
                {formatNumber(stats.user)}u/{formatNumber(stats.assistant)}a
                {stats.tool > 0 ? `/${formatNumber(stats.tool)}t` : ""}
              </span>
            )}
            <span>{duration}</span>
          </div>
        )}
      </div>

      {/* F-4: tasks ingested from this session. Fetched once on mount —
          the SSE stream updates `data` repeatedly, but the task↔session
          mapping changes only after a `relay sync`, so re-fetching on every
          message append would be wasted DB work. */}
      <SessionTasksPanel type={data.type} sessionId={data.id} compact={compact} />

      {/* Sticky tab bar — sticky within the tile's scroll container */}
      <div
        className={cn(
          "flex-shrink-0 sticky top-0 z-10 bg-[var(--color-bg)] border-b border-[var(--color-border)] space-y-1.5",
          compact ? "px-3 pt-0.5 pb-1.5" : "px-4 pt-1 pb-2",
        )}
      >
        <div className="flex gap-1 items-center">
          <TabButton active={tab === "messages"} onClick={() => setTab("messages")} compact={compact}>
            {c("sessions.detail.messagesHeading", {
              count: formatNumber(filteredMessages.length),
            })}
          </TabButton>
          {data.todos.length > 0 && (
            <TabButton active={tab === "todos"} onClick={() => setTab("todos")} compact={compact}>
              {c("sessions.detail.todosHeading", { count: formatNumber(data.todos.length) })}
            </TabButton>
          )}
          <TabButton active={tab === "tools"} onClick={() => setTab("tools")} compact={compact}>
            {c("sessions.detail.toolCallsHeading", { count: formatNumber(filteredTools.length) })}
          </TabButton>
          <div className="flex-1" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter…"
            className={cn(
              "font-mono text-[12px] px-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-accent)]",
              compact ? "w-[120px] h-6" : "w-[180px] h-7",
            )}
          />
        </div>
        {tab === "messages" && (
          <div className="flex gap-1 flex-wrap">
            {(["all", "user", "assistant", "tool", "system"] as const).map((r) => {
              const count =
                r === "all"
                  ? data.messages.length
                  : data.messages.filter((m) => m.role === r).length;
              if (r !== "all" && count === 0) return null;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  aria-pressed={roleFilter === r}
                  className={cn(
                    "rounded-[var(--radius-sm)] border font-mono transition-colors",
                    compact ? "px-1.5 h-5 text-[10px]" : "px-2 h-6 text-[11px]",
                    roleFilter === r
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                  )}
                >
                  {r} · {formatNumber(count)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className={cn("flex-1 min-h-0 overflow-y-auto", compact ? "px-3" : "px-4")}>
        {tab === "messages" && (
          <MessagesList
            messages={filteredMessages}
            freshKeys={freshMessageKeys}
            compact={compact}
          />
        )}
        {tab === "todos" && <TodosList todos={data.todos} />}
        {tab === "tools" && <ToolCallsList calls={filteredTools} />}
      </div>
    </div>
  );
}
