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
import type { SessionMessage, SessionSkillUse, SessionToolCall } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  computeSkillTimelineEvents,
  validSkillNamesFromDetail,
  type SkillTimelineEvent,
} from "../_lib/skill-events";

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export interface ChatBubbleStreamProps {
  messages: readonly SessionMessage[];
  skills?: readonly SessionSkillUse[];
  toolCalls?: readonly SessionToolCall[];
  /** Reference timestamp (ms) for relative-time chips. */
  now: number;
  /** Agent-kind color used to tint assistant bubbles. */
  accentColor?: string;
  /** Max bubbles to render (older entries are dropped). */
  maxBubbles?: number;
}

const TRUNCATE_AT = 120;
// Render a generous history so the Message Room can be scrolled back
// through past chatter. ChatBubbleStream's container owns the scroll;
// only the latest bubble gets the slide-in animation.
const DEFAULT_MAX = 200;
type StreamItem =
  | { kind: "message"; message: SessionMessage; ts: string }
  | { kind: "skill"; skill: SkillTimelineEvent; ts: string };

export function ChatBubbleStream({
  messages,
  skills = [],
  toolCalls = [],
  now,
  accentColor = "hsl(150, 55%, 55%)",
  maxBubbles = DEFAULT_MAX,
}: ChatBubbleStreamProps) {
  const visible = useMemo(() => {
    const chatItems: StreamItem[] = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((message) => ({ kind: "message", message, ts: message.timestamp }));
    const skillItems: StreamItem[] =
      skills.length > 0
        ? computeSkillTimelineEvents(messages, toolCalls, validSkillNamesFromDetail(skills))
            .map((skill) => ({ kind: "skill", skill, ts: skill.ts }))
        : [];
    return [...chatItems, ...skillItems]
      .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
      .slice(-maxBubbles);
  }, [messages, skills, toolCalls, maxBubbles]);

  // Auto-scroll to the bottom when a new message arrives, but ONLY if
  // the user was already near the bottom — that way scrolling back
  // through history isn't disturbed every time fresh chatter lands.
  const listRef = useRef<HTMLOListElement | null>(null);
  const newestTs = visible[visible.length - 1]?.ts ?? "";
  const didInitialScroll = useRef(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!didInitialScroll.current) {
      // First render: pin to the latest message so the user sees current
      // state, then scrolling back is opt-in via the wheel.
      el.scrollTop = el.scrollHeight;
      didInitialScroll.current = true;
      return;
    }
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
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
      {visible.map((item, i) =>
        item.kind === "message" ? (
          <ChatBubble
            // The (index, ts, role) combo means a new bubble at the bottom
            // gets a fresh key and animates in even when older keys reshift.
            key={`m-${item.message.timestamp}-${i}-${item.message.role}`}
            message={item.message}
            now={now}
            accentColor={accentColor}
            // Only the last bubble gets the slide-in animation so older
            // entries don't re-animate on every render.
            fresh={i === visible.length - 1}
          />
        ) : (
          <SkillEventCard
            key={`s-${item.skill.ts}-${i}-${item.skill.name}-${item.skill.source}`}
            skill={item.skill}
            now={now}
            fresh={i === visible.length - 1}
          />
        ),
      )}
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

function SkillEventCard({
  skill,
  now,
  fresh,
}: {
  skill: SkillTimelineEvent;
  now: number;
  fresh: boolean;
}) {
  const ts = Date.parse(skill.ts);
  const rel = Number.isFinite(ts) ? formatRelative(now - ts) : "—";
  const source = skill.source === "skill_tool"
    ? "Skill tool"
    : skill.source === "subagent"
      ? "Sub-agent"
      : skill.source === "session_meta"
        ? "Session"
        : "Command";
  return (
    <li
      className="flex justify-center max-w-full"
      style={{ animation: fresh ? "relayChatSlideIn 280ms ease-out both" : undefined }}
    >
      <article
        className="w-[86%] rounded-[8px] border px-2.5 py-2 font-mono text-[10.5px]"
        style={{
          background:
            "linear-gradient(135deg, hsla(280, 75%, 92%, 0.96), hsla(210, 80%, 91%, 0.92))",
          borderColor: "hsla(276, 55%, 60%, 0.72)",
          color: "#21172B",
          boxShadow:
            "0 6px 12px -6px rgba(70,30,120,0.36), inset 0 1px 0 rgba(255,255,255,0.65)",
        }}
        title={`${source}: ${skill.name}${skill.detail ? `\n${skill.detail}` : ""}`}
        aria-label={`Skill used: ${skill.name}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span aria-hidden className="text-[13px] leading-none">✦</span>
          <span className="font-semibold text-[11px] truncate">Skill: {skill.name}</span>
          <span className="ml-auto shrink-0 text-[8.5px] uppercase tracking-wider opacity-65">
            {source}
          </span>
        </div>
        {skill.detail && (
          <div className="mt-1 truncate text-[9.5px] opacity-75">
            {truncate(skill.detail, 80)}
          </div>
        )}
        <div className="mt-1 text-[8.5px] opacity-65 tabular-nums">
          {rel} ago
        </div>
      </article>
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
