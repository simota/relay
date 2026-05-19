"use client";

import { useMemo } from "react";
import type { SessionMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getRoleColor } from "../_lib/colors";
import { messageKey, shortTime } from "../_lib/format";

/**
 * Horizontal strip showing every message in the (unfiltered) session as a
 * single vertical bar whose height encodes character count (log-scaled) and
 * whose color encodes role. Designed to surface conversational rhythm at a
 * glance — long-form assistant explanations, short-burst user prompts,
 * tool-chain stretches — and to act as a click-to-jump minimap for the
 * messages list below.
 */
export function MessageLengthStrip({
  messages,
  compact = false,
}: {
  messages: SessionMessage[];
  compact?: boolean;
}) {
  const { max, items } = useMemo(() => {
    let m = 0;
    const arr = messages.map((msg) => {
      const len = msg.text.length;
      if (len > m) m = len;
      return { msg, len };
    });
    return { max: m, items: arr };
  }, [messages]);

  if (items.length === 0) return null;

  const height = compact ? 18 : 24;
  const logMax = Math.log1p(max);

  const handleClick = (key: string) => {
    if (typeof document === "undefined") return;
    const el = document.querySelector<HTMLElement>(
      `[data-message-key="${CSS.escape(key)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.setAttribute("data-jump-target", "");
    window.setTimeout(() => el.removeAttribute("data-jump-target"), 1200);
  };

  return (
    <div className="flex w-full items-center gap-2">
      <div
        className="flex w-14 shrink-0 items-center gap-1 text-[9px] font-mono uppercase tracking-wide text-[var(--color-fg-dim)]"
        title="Message length per turn (height = char count, color = role)"
      >
        <svg
          width={10}
          height={10}
          viewBox="0 0 10 10"
          fill="currentColor"
          aria-hidden="true"
          className="shrink-0"
        >
          <rect x={0} y={1} width={8} height={1.5} rx={0.5} />
          <rect x={0} y={4} width={5} height={1.5} rx={0.5} />
          <rect x={0} y={7} width={7} height={1.5} rx={0.5} />
        </svg>
        <span>length</span>
      </div>
      <div
        className="flex flex-1 min-w-0 items-end gap-px rounded-[var(--radius-sm)] overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-elev)]"
        role="img"
        aria-label={`Message length strip for ${items.length} messages`}
        style={{ height }}
      >
        {items.map(({ msg, len }, i) => {
          const ratio = logMax > 0 ? Math.log1p(len) / logMax : 0;
          const barH = Math.max(2, Math.round(ratio * height));
          const key = messageKey(msg);
          return (
            <button
              key={`${msg.timestamp}-${i}`}
              type="button"
              onClick={() => handleClick(key)}
              className={cn(
                "flex-1 min-w-0 cursor-pointer transition-opacity hover:opacity-80",
                "focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]",
              )}
              style={{
                height: barH,
                backgroundColor: getRoleColor(msg.role),
                alignSelf: "flex-end",
              }}
              title={`${msg.role} · ${shortTime(msg.timestamp)} · ${len.toLocaleString()} chars`}
              aria-label={`Jump to ${msg.role} message at ${shortTime(msg.timestamp)} (${len} chars)`}
            />
          );
        })}
      </div>
    </div>
  );
}
