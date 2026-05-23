"use client";

// Fleet Hamlet — SkillBurst overlay.
//
// Renders the floating "SKILL FIRED" badge + radial sparkles above a
// resident's SimCard. Driven by `useHamletSkillBursts`; the parent passes
// the live burst list for that sessionKey and we render the most recent
// one (older bursts auto-expire via the hook).

import type { SkillBurstEvent } from "../_hooks/use-hamlet-skill-burst";

const SOURCE_LABEL: Record<SkillBurstEvent["source"], string> = {
  slash_command: "/",
  skill_tool: "↯",
  subagent: "↳",
  session_meta: "◎",
};

// Inline keyframes — co-located so the component is portable and the
// styles can't drift from the lifetimes the hook controls (3800ms TTL).
const BURST_CSS = `
@keyframes relayHamletBurstBadge {
  0%   { opacity: 0; transform: translate(-50%, 0) scale(0.85); }
  12%  { opacity: 1; transform: translate(-50%, -6px) scale(1.05); }
  85%  { opacity: 1; transform: translate(-50%, -10px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -16px) scale(0.95); }
}
@keyframes relayHamletBurstHalo {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
  20%  { opacity: 0.85; transform: translate(-50%, -50%) scale(0.9); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
}
@keyframes relayHamletBurstSpark {
  0%   { opacity: 0; transform: translate(-50%, -50%) translate(0,0) scale(0.6); }
  18%  { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) translate(var(--sx), var(--sy)) scale(0.4); }
}
@keyframes relayHamletBurstCardPulse {
  0%, 100% { box-shadow: inset 3px 0 0 0 hsl(280, 70%, 60%), 0 0 0 0 rgba(245, 200, 80, 0); }
  35%      { box-shadow: inset 3px 0 0 0 hsl(280, 70%, 60%), 0 0 14px 4px rgba(245, 200, 80, 0.55); }
}
.relay-hamlet-skill-burst-card-pulse {
  animation: relayHamletBurstCardPulse 1500ms ease-out;
}
`;

const SPARK_OFFSETS: Array<{ sx: number; sy: number }> = [
  { sx: 16, sy: -22 },
  { sx: -18, sy: -20 },
  { sx: 22, sy: 6 },
  { sx: -20, sy: 10 },
  { sx: 4, sy: -30 },
  { sx: -6, sy: 26 },
];

export function SkillBurstStyles() {
  return <style>{BURST_CSS}</style>;
}

export function SkillBurstOverlay({ burst }: { burst: SkillBurstEvent }) {
  // Anchored to the SimCard avatar area. The parent should give us a
  // `position: relative` container so absolute positioning lands cleanly.
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 80,
        pointerEvents: "none",
        zIndex: 5,
        overflow: "visible",
      }}
    >
      {/* Halo behind the badge */}
      <span
        style={{
          position: "absolute",
          top: 28,
          left: "50%",
          width: 64,
          height: 64,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(245,200,80,0.55) 0%, rgba(245,200,80,0.18) 45%, transparent 70%)",
          animation: "relayHamletBurstHalo 1400ms ease-out forwards",
        }}
      />
      {SPARK_OFFSETS.map((s, i) => (
        <span
          key={i}
          style={
            {
              position: "absolute",
              top: 28,
              left: "50%",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "hsl(45, 100%, 65%)",
              boxShadow: "0 0 6px 1px rgba(245, 200, 80, 0.85)",
              "--sx": `${s.sx}px`,
              "--sy": `${s.sy}px`,
              animation: `relayHamletBurstSpark ${1100 + i * 80}ms ease-out forwards`,
            } as React.CSSProperties
          }
        />
      ))}
      {/* Floating skill name badge */}
      <span
        style={{
          position: "absolute",
          top: -4,
          left: "50%",
          padding: "2px 8px",
          borderRadius: 999,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.5,
          color: "hsl(45, 90%, 22%)",
          background:
            "linear-gradient(180deg, hsl(45, 100%, 78%), hsl(38, 90%, 60%))",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.7) inset, 0 0 0 1px rgba(140, 80, 0, 0.35), 0 4px 10px rgba(245, 200, 80, 0.5)",
          whiteSpace: "nowrap",
          animation: "relayHamletBurstBadge 3600ms ease-out forwards",
        }}
      >
        <span style={{ opacity: 0.85, marginRight: 4 }}>{SOURCE_LABEL[burst.source]}</span>
        {burst.name}
      </span>
    </div>
  );
}
