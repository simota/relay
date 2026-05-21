"use client";

// Fleet Hamlet — Chat Bubble Stream.
//
// Renders the last ~5 messages of a session as alternating user/assistant
// chat bubbles inside the Neighborhood panel. User bubbles are pinned
// left with a pastel blue background; assistant bubbles are pinned right
// with a pastel green/emerald background tinted by the resident's agent
// color. The newest bubble fades+slides in from the bottom so new
// activity feels alive without redirecting attention.

import { useEffect, useMemo, useRef } from "react";
import type { SessionMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export interface ChatBubbleStreamProps {
  messages: readonly SessionMessage[];
  /** Reference timestamp (ms) for relative-time chips. */
  now: number;
  /** Agent-kind color used to tint assistant bubbles. */
  accentColor?: string;
  /** Max bubbles to render (older entries are dropped). */
  maxBubbles?: number;
}

const TRUNCATE_AT = 120;
const DEFAULT_MAX = 5;

export function ChatBubbleStream({
  messages,
  now,
  accentColor = "hsl(150, 55%, 55%)",
  maxBubbles = DEFAULT_MAX,
}: ChatBubbleStreamProps) {
  const visible = useMemo(() => {
    // Surface only chat-style rows (user/assistant); tool & system noise
    // stays in the Messages tab.
    const filtered = messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );
    return filtered.slice(-maxBubbles);
  }, [messages, maxBubbles]);

  // Auto-scroll to the bottom whenever a new message arrives so the
  // freshest chatter is always visible without manual scrolling. Keyed
  // off the newest timestamp + visible count so a re-render that doesn't
  // change the conversation doesn't jam the scroll back to the floor.
  const listRef = useRef<HTMLOListElement | null>(null);
  const newestTs = visible[visible.length - 1]?.timestamp ?? "";
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [newestTs, visible.length]);

  if (visible.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center px-4 py-3">
        <div className="text-[10.5px] font-mono text-[var(--color-fg-dim)] text-center max-w-[200px] leading-snug">
          <span aria-hidden className="block text-[16px] mb-1">💬</span>
          No conversation yet
        </div>
      </div>
    );
  }

  return (
    <ol
      ref={listRef}
      className="flex flex-col gap-1.5 px-2 py-2 overflow-y-auto h-full"
      aria-label="recent conversation"
    >
      {visible.map((m, i) => (
        <ChatBubble
          // The (index, ts, role) combo means a new bubble at the bottom
          // gets a fresh key and animates in even when older keys reshift.
          key={`${m.timestamp}-${i}-${m.role}`}
          message={m}
          now={now}
          accentColor={accentColor}
          // Only the last bubble gets the slide-in animation so older
          // entries don't re-animate on every render.
          fresh={i === visible.length - 1}
        />
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// One bubble
// ---------------------------------------------------------------------------

interface ChatBubbleProps {
  message: SessionMessage;
  now: number;
  accentColor: string;
  fresh: boolean;
}

function ChatBubble({ message, now, accentColor, fresh }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const truncated = truncate(message.text, TRUNCATE_AT);
  const ts = Date.parse(message.timestamp);
  const rel = Number.isFinite(ts) ? formatRelative(now - ts) : "—";
  const bg = isUser
    ? "linear-gradient(135deg, hsla(210, 80%, 92%, 0.95), hsla(220, 70%, 86%, 0.95))"
    : `linear-gradient(135deg, ${tintLight(accentColor, 0.9)}, ${tintLight(accentColor, 0.78)})`;
  const borderColor = isUser ? "hsl(215, 55%, 65%)" : tintBorder(accentColor);

  return (
    <li
      className={cn(
        "flex items-end gap-1.5 max-w-full",
        isUser ? "justify-start" : "justify-end",
      )}
      style={{
        animation: fresh ? "relayChatSlideIn 280ms ease-out both" : undefined,
      }}
    >
      {isUser && (
        <span
          aria-hidden
          className="shrink-0 text-[12px] leading-none mb-0.5"
          title="user"
        >
          👤
        </span>
      )}
      <div
        className={cn(
          "relative max-w-[78%] min-w-0 px-2 py-1 rounded-[10px] text-[10.5px] font-mono leading-snug",
        )}
        style={{
          // D2 — pastel base + paper-noise speckle (matches HouseChatBubble).
          background: `${bg}, radial-gradient(circle at 30% 20%, rgba(255,255,255,0.55) 0.5px, transparent 1.5px), radial-gradient(circle at 70% 60%, rgba(0,0,0,0.04) 0.5px, transparent 1.5px)`,
          backgroundSize: "auto, 7px 7px, 9px 9px",
          border: `1px solid ${borderColor}`,
          color: "#1A1F2E",
          // D2 — 4-layer drop shadow + inset highlight so the bubble reads
          // as paper resting on the panel surface.
          boxShadow:
            "0 5px 10px -4px rgba(0,0,0,0.32), 0 3px 5px -2px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(0,0,0,0.05)",
          // Tail nibs are added via CSS clip-path on a pseudo-ish absolute
          // element below; we keep the bubble itself rectangular-rounded.
        }}
        title={message.text}
      >
        <span className="block break-words whitespace-pre-wrap">{truncated}</span>
        <span
          className="block text-[8.5px] mt-0.5 opacity-65 tabular-nums"
          style={{ color: isUser ? "#3B4A6B" : "#2A4A36" }}
        >
          {rel} ago
        </span>
        {/* Tail nib */}
        <span
          aria-hidden
          className="absolute"
          style={{
            bottom: -4,
            [isUser ? "left" : "right"]: 8,
            width: 0,
            height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: `6px solid ${borderColor}`,
          }}
        />
      </div>
      {!isUser && (
        <span
          aria-hidden
          className="shrink-0 text-[12px] leading-none mb-0.5"
          style={{ color: accentColor }}
          title={message.role}
        >
          🤖
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Style block — must be injected once per panel
// ---------------------------------------------------------------------------

export const CHAT_BUBBLE_CSS = `
@keyframes relayChatSlideIn {
  0% { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  if (!text) return "";
  // Collapse run-on whitespace so a single huge prompt doesn't blow out
  // the bubble before truncation kicks in.
  const norm = text.replace(/\s+/g, " ").trim();
  if (norm.length <= max) return norm;
  return `${norm.slice(0, max - 1).trimEnd()}…`;
}

function formatRelative(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

// Coerce any HSL/HSLA/HEX into a soft tint by re-emitting the hue with
// fixed light saturation+lightness. Keeps bubble palette pastel even
// when the agent color is saturated.
function tintLight(color: string, alpha: number): string {
  const hue = extractHue(color);
  return `hsla(${hue}, 65%, 88%, ${alpha})`;
}

function tintBorder(color: string): string {
  const hue = extractHue(color);
  return `hsl(${hue}, 45%, 60%)`;
}

function extractHue(color: string): number {
  const m = color.match(/hsla?\(\s*(-?\d+(?:\.\d+)?)/);
  if (m && m[1]) {
    const v = Number.parseFloat(m[1]);
    if (Number.isFinite(v)) return ((v % 360) + 360) % 360;
  }
  return 150; // pleasant green fallback
}
