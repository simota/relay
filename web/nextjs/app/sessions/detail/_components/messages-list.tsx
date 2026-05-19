"use client";

import { useState } from "react";
import type { SessionMessage } from "@/lib/api";
import { formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { COLLAPSE_CHAR_THRESHOLD, COLLAPSE_LINE_THRESHOLD } from "../_constants";
import { messageKey, shortTime } from "../_lib/format";
import { MarkdownLite, PlainText } from "./markdown-lite";

export function MessagesList({
  messages,
  freshKeys,
  compact = false,
}: {
  messages: SessionMessage[];
  freshKeys?: ReadonlySet<string>;
  compact?: boolean;
}) {
  if (messages.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)] py-6 text-center">no messages</p>
    );
  }
  return (
    <ol className={cn(compact ? "space-y-2 pt-2" : "space-y-3 pt-3")}>
      {messages.map((m, i) => {
        const isFresh = freshKeys?.has(messageKey(m)) ?? false;
        const key = messageKey(m);
        return (
          <MessageRow
            key={`${m.timestamp}-${i}`}
            message={m}
            messageKey={key}
            compact={compact}
            fresh={isFresh}
          />
        );
      })}
    </ol>
  );
}

function MessageRow({
  message: m,
  messageKey: msgKey,
  compact = false,
  fresh = false,
}: {
  message: SessionMessage;
  messageKey: string;
  compact?: boolean;
  fresh?: boolean;
}) {
  const lines = m.text.split("\n").length;
  const long = lines > COLLAPSE_LINE_THRESHOLD || m.text.length > COLLAPSE_CHAR_THRESHOLD;
  const [expanded, setExpanded] = useState(!long);
  const isAssistant = m.role === "assistant";
  const [renderMode, setRenderMode] = useState<"rendered" | "raw">(
    isAssistant ? "rendered" : "raw",
  );

  return (
    <li
      className={cn(
        "rounded-[var(--radius)] border border-[var(--color-border)] space-y-1.5",
        compact ? "p-2" : "p-3",
        fresh && "relay-fresh",
      )}
      data-fresh={fresh ? "" : undefined}
      data-message-key={msgKey}
    >
      <div className="flex items-center gap-2 text-[10.5px] text-[var(--color-fg-dim)] font-mono">
        <span
          className={cn(
            "uppercase tracking-wider",
            m.role === "user" && "text-[var(--color-accent)]",
            m.role === "assistant" && "text-[var(--color-cool)]",
          )}
        >
          {m.role}
        </span>
        <span>·</span>
        <span title={m.timestamp}>{shortTime(m.timestamp)}</span>
        {fresh && (
          <span
            className="rounded-sm px-1 py-px text-[9.5px] uppercase tracking-wider text-[var(--color-bg)] bg-[var(--color-accent)] font-bold"
            aria-label="new message"
          >
            new
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setRenderMode("rendered")}
          aria-pressed={renderMode === "rendered"}
          className={cn(
            "text-[10.5px] font-mono",
            renderMode === "rendered"
              ? "text-[var(--color-accent)] underline underline-offset-2"
              : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
          )}
        >
          rendered
        </button>
        <button
          type="button"
          onClick={() => setRenderMode("raw")}
          aria-pressed={renderMode === "raw"}
          className={cn(
            "text-[10.5px] font-mono",
            renderMode === "raw"
              ? "text-[var(--color-accent)] underline underline-offset-2"
              : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
          )}
        >
          raw
        </button>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10.5px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] font-mono"
          >
            {expanded ? "collapse" : `expand (${formatNumber(lines)} lines)`}
          </button>
        )}
      </div>
      <div
        className={cn(
          "text-[12px] leading-relaxed text-[var(--color-fg)]",
          !expanded && "max-h-[14rem] overflow-hidden relative",
        )}
      >
        {renderMode === "rendered" ? <MarkdownLite text={m.text} /> : <PlainText text={m.text} />}
        {!expanded && (
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--color-bg)] to-transparent pointer-events-none" />
        )}
      </div>
    </li>
  );
}
