"use client";

import type { SessionStatus, SessionSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSubagents } from "../_hooks/use-subagents";
import { getSubagentStatusColor } from "../_lib/colors";
import { RelativeTime } from "./badges";

// Cap recursion so a cycle in the parent-pointer graph (shouldn't happen,
// but adapters are external data) can't blow the stack or spam the API.
// Anything beyond this depth collapses into a "…N more levels" hint.
const MAX_DEPTH = 3;

function StatusDot({ status }: { status: SessionStatus | undefined }) {
  const color = status ? getSubagentStatusColor(status) : "var(--color-fg-dim)";
  return (
    <span
      className={cn("w-1.5 h-1.5 rounded-full inline-block", status === "waiting_for_user" && "relay-attention")}
      style={{ backgroundColor: color }}
      title={status ?? "unknown"}
      aria-hidden
    />
  );
}

/**
 * Top-level subagent list rendered under the `agents` tab. The parent
 * owns the first-level fetch lifecycle and passes the rows in; deeper
 * levels are fetched on-demand by `SubagentNode` via its own hook call.
 */
export function SubagentTree({
  childrenSessions,
  onOpenChild,
  loading,
  error,
  compact = false,
}: {
  childrenSessions: SessionSummary[];
  onOpenChild: (child: SessionSummary) => void;
  loading: boolean;
  error: string | null;
  compact?: boolean;
}) {
  if (loading && childrenSessions.length === 0) {
    return (
      <div className={cn("font-mono text-[11px] text-[var(--color-fg-dim)]", compact ? "py-2" : "py-3")}>
        loading subagents…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className={cn(
          "font-mono text-[11px] text-[var(--color-warn,var(--color-accent))]",
          compact ? "py-2" : "py-3",
        )}
      >
        {error}
      </div>
    );
  }
  if (childrenSessions.length === 0) {
    return (
      <div className={cn("font-mono text-[11px] text-[var(--color-fg-dim)]", compact ? "py-2" : "py-3")}>
        no subagents
      </div>
    );
  }

  return (
    <ul className={cn("font-mono space-y-1", compact ? "py-1" : "py-2")}>
      {childrenSessions.map((child) => (
        <SubagentNode
          key={child.id}
          session={child}
          onOpenChild={onOpenChild}
          compact={compact}
          depth={1}
        />
      ))}
    </ul>
  );
}

/**
 * Recursive node. Each instance owns a `useSubagents` call for its own id;
 * the hook short-circuits when `subagent_count` is falsy so leaf rows make
 * no network request. We never skip the hook call conditionally — that
 * would violate Rules of Hooks — and instead let the hook itself decide
 * whether to fetch. Depth >= MAX_DEPTH stops descending and shows a
 * collapsed-tail hint.
 */
function SubagentNode({
  session,
  onOpenChild,
  compact,
  depth,
}: {
  session: SessionSummary;
  onOpenChild: (child: SessionSummary) => void;
  compact: boolean;
  depth: number;
}) {
  // The list endpoint only sets `subagent_count` on top-level (non-subagent)
  // rows, so once we recurse below depth 1 we can't rely on it as an a-priori
  // signal of "this node has children". Probe via the hook instead — the API
  // returns an empty array cheaply when there are none.
  const canDescend = depth < MAX_DEPTH;
  const grand = useSubagents(
    session.type,
    session.id,
    canDescend,
    session.last_active,
  );
  const grandHasChildren = grand.children.length > 0;

  const label = session.agent_id ?? session.id.slice(0, 8);
  // Indent is rendered via inline padding rather than nested ULs so the
  // L-shaped connector pseudo-elements stay aligned to the same anchor.
  const indentPx = (depth - 1) * (compact ? 12 : 16);

  return (
    <li
      className="relative pl-4 before:absolute before:left-1 before:top-0 before:bottom-1/2 before:w-px before:bg-[var(--color-border)] after:absolute after:left-1 after:top-1/2 after:w-2 after:h-px after:bg-[var(--color-border)]"
      style={indentPx > 0 ? { marginLeft: indentPx } : undefined}
    >
      <button
        type="button"
        onClick={() => onOpenChild(session)}
        className={cn(
          "w-full flex items-center gap-2 text-left rounded-[var(--radius-sm)] border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-elev)] transition-colors",
          compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-[12px]",
        )}
        title={session.title}
      >
        <StatusDot status={session.status} />
        <span className="text-[var(--color-fg)] truncate flex-1">{label}</span>
        {(session.subagent_count ?? grand.children.length) > 0 && (
          <span className="text-[var(--color-fg-dim)] text-[10.5px]" title="subagent count">
            ↳ {session.subagent_count ?? grand.children.length}
          </span>
        )}
        <span className="text-[var(--color-fg-dim)] text-[10.5px]">
          {session.message_count} msg
        </span>
        <RelativeTime iso={session.last_active} />
      </button>

      {canDescend && grandHasChildren && (
        <NestedChildren
          state={grand}
          onOpenChild={onOpenChild}
          compact={compact}
          depth={depth + 1}
        />
      )}
      {!canDescend && (session.subagent_count ?? 0) > 0 && (
        <div
          className={cn(
            "pl-4 font-mono text-[10.5px] text-[var(--color-fg-dim)]",
            compact ? "py-0.5" : "py-1",
          )}
        >
          …more levels (open this row to expand)
        </div>
      )}
    </li>
  );
}

function NestedChildren({
  state,
  onOpenChild,
  compact,
  depth,
}: {
  state: ReturnType<typeof useSubagents>;
  onOpenChild: (child: SessionSummary) => void;
  compact: boolean;
  depth: number;
}) {
  if (state.loading && state.children.length === 0) {
    return (
      <div
        className={cn(
          "pl-4 font-mono text-[10.5px] text-[var(--color-fg-dim)]",
          compact ? "py-0.5" : "py-1",
        )}
      >
        loading…
      </div>
    );
  }
  if (state.error) {
    return (
      <div
        className={cn(
          "pl-4 font-mono text-[10.5px] text-[var(--color-warn,var(--color-accent))]",
          compact ? "py-0.5" : "py-1",
        )}
      >
        {state.error}
      </div>
    );
  }
  if (state.children.length === 0) return null;
  return (
    <ul className={cn("font-mono", compact ? "space-y-0.5 mt-0.5" : "space-y-1 mt-1")}>
      {state.children.map((c) => (
        <SubagentNode
          key={c.id}
          session={c}
          onOpenChild={onOpenChild}
          compact={compact}
          depth={depth}
        />
      ))}
    </ul>
  );
}
