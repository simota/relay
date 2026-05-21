"use client";

// Fleet Hamlet — decoration SVG sprites.
//
// Re-usable pure-SVG decoration components shared by Neighborhood, House,
// and Cemetery. All sprites are deterministic given their inputs; the
// animations are scheduled via CSS keyframes injected by `DECOR_CSS`
// (consumed once per view via a single <style> tag).
//
// Keep additional SVG nodes lightweight — each Hamlet page renders many
// houses, so prefer rect/circle/path counts under ~12 per sprite.

import { useMemo } from "react";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import type { SkyPalette, TreeKind, YardDecor } from "../_lib/fleet-hamlet-decor";
import type { WeatherKind } from "../_lib/fleet-hamlet-layout";

// ---------------------------------------------------------------------------
// Sky band — fixed gradient + sun/moon + clouds + stars
// ---------------------------------------------------------------------------

export function SkyBand({
  palette,
  width,
  height,
  weather = "clear",
}: {
  palette: SkyPalette;
  width: number;
  height: number;
  weather?: WeatherKind;
}) {
  // Deterministic cloud + star positions seeded by time-of-day so they
  // remain stable across renders within a session.
  const clouds = useMemo(() => {
    const seed = palette.tod === "morning" ? 1 : palette.tod === "noon" ? 2 : palette.tod === "evening" ? 3 : 4;
    const out: { id: number; x: number; y: number; scale: number; delay: number; dur: number }[] = [];
    const base = palette.tod === "night" ? 1 : palette.tod === "evening" ? 3 : 4;
    const count =
      weather === "stormy" ? Math.max(base, 7) :
      weather === "cloudy" ? Math.max(base, 6) :
      weather === "partly" ? base : Math.max(2, base - 1);
    for (let i = 0; i < count; i++) {
      const k = (seed * 7 + i * 31) % 100;
      out.push({
        id: i,
        x: ((i / count) * width + (k * 3) % width) % width,
        y: 12 + ((k * 5) % Math.max(20, height - 50)),
        scale: 0.7 + ((k * 13) % 60) / 100,
        delay: -(i * 9) - (k % 11),
        dur: 60 + (k % 20),
      });
    }
    return out;
  }, [palette.tod, width, height, weather]);

  const stars = useMemo(() => {
    if (palette.stars === 0) return [] as { id: number; x: number; y: number; r: number; delay: number }[];
    const out: { id: number; x: number; y: number; r: number; delay: number }[] = [];
    for (let i = 0; i < palette.stars; i++) {
      const k = (i * 977) % 1000;
      out.push({
        id: i,
        x: ((k * 11) % width),
        y: ((k * 7) % Math.max(20, height - 30)),
        r: 0.6 + ((k * 3) % 10) / 10,
        delay: -(k % 5),
      });
    }
    return out;
  }, [palette.stars, width, height]);

  const sunY = palette.tod === "noon" ? 28 : palette.tod === "morning" || palette.tod === "evening" ? 42 : 32;
  const sunX = palette.tod === "morning" ? width * 0.18 : palette.tod === "evening" ? width * 0.82 : width * 0.5;
  const sunFill =
    palette.luminary === "moon"
      ? "#F5E9C5"
      : palette.tod === "evening"
      ? "#FF7043"
      : palette.tod === "morning"
      ? "#FFD27E"
      : "#FFE082";

  // Storm sky overlay — darken/desaturate the base gradient with a slate
  // tint while keeping the time-of-day silhouette intact.
  const skyBackground = weather === "stormy"
    ? `${palette.sky}, linear-gradient(to bottom, rgba(40, 50, 70, 0.55), rgba(60, 70, 90, 0.45))`
    : palette.sky;
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 pointer-events-none overflow-hidden"
      style={{ height, background: skyBackground }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0"
      >
        {/* Stars (night) */}
        {stars.map((s) => (
          <circle
            key={s.id}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="#FFFDF0"
            opacity={0.85}
            style={{
              animation: `relayHamletTwinkle 2.4s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
        {/* Luminary — parent group anchors the position; inner group runs
            the pulse animation. */}
        <g transform={`translate(${sunX} ${sunY})`}>
          <g style={{ transformOrigin: "0 0", animation: "relayHamletSunPulse 4s ease-in-out infinite" }}>
            <circle cx={0} cy={0} r={22} fill={sunFill} opacity={0.28} />
            <circle cx={0} cy={0} r={14} fill={sunFill} />
            {palette.luminary === "moon" && (
              <circle cx={5} cy={-3} r={11} fill={palette.sky.includes("0D1B3D") ? "#0D1B3D" : "#1A2B55"} />
            )}
          </g>
        </g>
        {/* Clouds — parent positions, child handles the drift animation so
            the inline transform doesn't fight with the keyframe. */}
        {clouds.map((c) => (
          <g
            key={c.id}
            transform={`translate(${c.x}, ${c.y}) scale(${c.scale})`}
            opacity={palette.tod === "night" ? 0.35 : 0.85}
          >
            <g
              style={{
                animation: `relayHamletCloudDrift ${c.dur}s linear ${c.delay}s infinite`,
              }}
            >
              <CloudPath />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}

function CloudPath() {
  return (
    <g fill="#FFFFFF" fillOpacity={0.95}>
      <ellipse cx={0} cy={8} rx={14} ry={7} />
      <ellipse cx={12} cy={5} rx={12} ry={8} />
      <ellipse cx={24} cy={9} rx={10} ry={6} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Ground band — soft pastel grass strip with subtle dotted pattern
// ---------------------------------------------------------------------------

export function GroundBand({
  palette,
  width,
  height,
}: {
  palette: SkyPalette;
  width: number;
  height: number;
}) {
  const grad = `linear-gradient(to bottom, ${palette.grass} 0%, ${palette.grassDark} 100%)`;
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 pointer-events-none"
      style={{
        bottom: 0,
        height,
        background: grad,
        backgroundImage: `${grad}, radial-gradient(circle at 25% 50%, rgba(255,255,255,0.08) 1px, transparent 2px)`,
        backgroundSize: "auto, 14px 14px",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tree, Bush, Flower, Streetlight, Mailbox, Nameplate, Bird, Butterfly
// ---------------------------------------------------------------------------

export function TreeSvg({
  kind,
  size = 1,
  nightLamp = false,
}: {
  kind: TreeKind;
  size?: number;
  nightLamp?: boolean;
}) {
  const w = 28 * size;
  const h = 44 * size;
  if (kind === "pine") {
    return (
      <svg width={w} height={h} viewBox="0 0 28 44" aria-hidden>
        <rect x="12" y="32" width="4" height="10" fill="#5D3A1F" />
        <polygon points="14,4 25,20 3,20" fill="#3F8A3E" />
        <polygon points="14,12 24,28 4,28" fill="#4FA255" />
        <polygon points="14,20 23,34 5,34" fill="#3F8A3E" />
        {nightLamp && (
          <circle cx="14" cy="14" r="2" fill="#FFE082" opacity="0.7" />
        )}
      </svg>
    );
  }
  if (kind === "oak") {
    return (
      <svg width={w} height={h} viewBox="0 0 28 44" aria-hidden>
        <rect x="12" y="30" width="4" height="12" fill="#5D3A1F" />
        <circle cx="14" cy="18" r="11" fill="#6CAF4F" />
        <circle cx="8" cy="22" r="6" fill="#7DBE5C" />
        <circle cx="20" cy="22" r="6" fill="#5EA044" />
        <circle cx="14" cy="14" r="5" fill="#86CB66" />
      </svg>
    );
  }
  return (
    <svg width={w} height={h * 0.55} viewBox="0 0 28 24" aria-hidden>
      <ellipse cx="14" cy="16" rx="12" ry="7" fill="#6CAF4F" />
      <ellipse cx="9" cy="13" rx="6" ry="5" fill="#7DBE5C" />
      <ellipse cx="19" cy="13" rx="6" ry="5" fill="#5EA044" />
    </svg>
  );
}

export function FlowerSvg({ hue }: { hue: number }) {
  const petal = `hsl(${hue}, 75%, 70%)`;
  const center = `hsl(${(hue + 40) % 360}, 80%, 55%)`;
  return (
    <svg width={14} height={16} viewBox="0 0 14 16" aria-hidden>
      <rect x="6.4" y="8" width="1.2" height="8" fill="#3F8A3E" />
      <circle cx="3.5" cy="6" r="2.4" fill={petal} />
      <circle cx="10.5" cy="6" r="2.4" fill={petal} />
      <circle cx="7" cy="3" r="2.4" fill={petal} />
      <circle cx="7" cy="9" r="2.4" fill={petal} />
      <circle cx="7" cy="6" r="1.6" fill={center} />
    </svg>
  );
}

export function MailboxSvg() {
  return (
    <svg width={10} height={18} viewBox="0 0 10 18" aria-hidden>
      <rect x="4" y="8" width="2" height="10" fill="#3A2A1F" />
      <rect x="0" y="2" width="10" height="7" rx="2" fill="#C13B2C" />
      <rect x="2" y="4" width="2" height="2" fill="#FFFDF0" />
      <rect x="8" y="3" width="1" height="3" fill="#FFE082" />
    </svg>
  );
}

export function NameplateSvg({ text }: { text: string }) {
  return (
    <svg width={26} height={12} viewBox="0 0 26 12" aria-hidden>
      <rect x="0.5" y="0.5" width="25" height="11" rx="2" fill="#FFFDF0" stroke="#3A2A1F" strokeWidth="0.8" />
      <text
        x="13"
        y="8.5"
        textAnchor="middle"
        fontSize="6.5"
        fontFamily="ui-monospace, monospace"
        fill="#3A2A1F"
        fontWeight="600"
      >
        {text}
      </text>
    </svg>
  );
}

export function BirdSvg({ delay = 0 }: { delay?: number }) {
  return (
    <svg
      width={14}
      height={10}
      viewBox="0 0 14 10"
      aria-hidden
      style={{ animation: `relayHamletChirp 3s ease-in-out ${delay}s infinite` }}
    >
      <ellipse cx="7" cy="6" rx="4.5" ry="3" fill="#5C3D8A" />
      <circle cx="11" cy="4.5" r="2" fill="#5C3D8A" />
      <circle cx="11.5" cy="4" r="0.4" fill="#FFFDF0" />
      <path d="M12.5 4.5 L 14 4 L 12.7 5.2 Z" fill="#FFA726" />
      <path d="M3 6 Q 5 3 7 6" stroke="#3A2566" strokeWidth="0.8" fill="none" />
    </svg>
  );
}

export function StreetlampSvg({ lit }: { lit: boolean }) {
  return (
    <svg width={16} height={42} viewBox="0 0 16 42" aria-hidden>
      <rect x="7" y="10" width="2" height="32" fill="#2A2A2A" />
      <rect x="4" y="38" width="8" height="3" rx="1" fill="#2A2A2A" />
      <rect x="3" y="6" width="10" height="6" rx="1.5" fill="#3A3A3A" />
      <rect x="5" y="8" width="6" height="3" fill={lit ? "#FFE082" : "#3A3A3A"} />
      {lit && (
        <circle
          cx="8"
          cy="10"
          r="11"
          fill="#FFE082"
          opacity="0.18"
          style={{ animation: "relayHamletLampGlow 3s ease-in-out infinite" }}
        />
      )}
    </svg>
  );
}

export function ButterflySvg({ delay = 0, hue = 320 }: { delay?: number; hue?: number }) {
  return (
    <svg
      width={16}
      height={12}
      viewBox="0 0 16 12"
      aria-hidden
      style={{ animation: `relayHamletButterfly 18s linear ${delay}s infinite` }}
    >
      <ellipse cx="6" cy="6" rx="4" ry="3" fill={`hsl(${hue}, 75%, 65%)`} />
      <ellipse cx="10" cy="6" rx="4" ry="3" fill={`hsl(${(hue + 30) % 360}, 75%, 70%)`} />
      <rect x="7.5" y="4" width="1" height="5" rx="0.4" fill="#3A2A1F" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Yard layer — wrapper that lays out a deterministic set of yard pieces
// around a house cell. Positioning is in absolute px relative to the cell.
// ---------------------------------------------------------------------------

export function YardLayer({
  decor,
  cellW,
  cellH,
  nightLamps,
}: {
  decor: YardDecor;
  cellW: number;
  cellH: number;
  nightLamps: boolean;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {decor.trees.map((t, i) => (
        <span
          key={`t-${i}`}
          style={{
            position: "absolute",
            left: cellW / 2 + t.offsetX * cellW * 0.55 - 14 * t.scale,
            bottom: 6,
            opacity: 0.95,
          }}
        >
          <TreeSvg kind={t.kind} size={t.scale} nightLamp={nightLamps && t.kind === "pine"} />
        </span>
      ))}
      {decor.flowers.map((f, i) => (
        <span
          key={`f-${i}`}
          style={{
            position: "absolute",
            left: cellW / 2 + f.offsetX * cellW * 0.35 - 7,
            bottom: 2,
          }}
        >
          <FlowerSvg hue={f.hue} />
        </span>
      ))}
      {decor.hasMailbox && (
        <span style={{ position: "absolute", left: cellW * 0.18, bottom: 4 }}>
          <MailboxSvg />
        </span>
      )}
      <span style={{ position: "absolute", left: cellW / 2 - 13, bottom: cellH * 0.27 }}>
        <NameplateSvg text={decor.plate} />
      </span>
      {decor.hasBird && (
        <span style={{ position: "absolute", left: cellW / 2 + 12, top: cellH * 0.32 }}>
          <BirdSvg delay={(decor.plate.charCodeAt(0) % 5) * 0.3} />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heartbeat strip — small SVG waveform whose period is driven by bpm.
// Used in House Plan's vitals HUD.
// ---------------------------------------------------------------------------

export function HeartbeatStrip({ bpm, warn }: { bpm: number; warn: boolean }) {
  const clamped = Math.min(180, Math.max(30, bpm));
  // 60_000 / bpm = ms per beat. We render ~2 beats in the strip; animation
  // shifts the path leftward over (beatMs * 2) for a believable EKG.
  const beatMs = 60_000 / clamped;
  const dur = `${Math.max(0.6, (beatMs * 2) / 1000).toFixed(2)}s`;
  const stroke = warn ? "#E53935" : "#4FA255";
  return (
    <svg width={96} height={20} viewBox="0 0 96 20" aria-hidden className="opacity-90">
      <line x1="0" y1="10" x2="96" y2="10" stroke="currentColor" strokeOpacity="0.18" strokeDasharray="2 3" />
      <g style={{ animation: `relayHamletEkgScroll ${dur} linear infinite` }}>
        <path
          d="M0 10 L 14 10 L 18 6 L 22 14 L 26 4 L 30 16 L 34 10 L 48 10 L 62 10 L 66 6 L 70 14 L 74 4 L 78 16 L 82 10 L 96 10"
          stroke={stroke}
          strokeWidth="1.4"
          fill="none"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Avatar body — extends the head-only SimAvatar with a torso, arms, and a
// shadow disc. Kept self-contained so callers can compose it under the
// existing head SVG without rewriting that.
// ---------------------------------------------------------------------------

export function AvatarBody({
  agentKind,
  width = 48,
  height = 22,
}: {
  agentKind: SimCardModel["sessionType"];
  width?: number;
  height?: number;
}) {
  // Match the SimAvatar 48×48 head box; this strip slots underneath it.
  const colors = clothing(agentKind);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {/* shadow */}
      <ellipse cx={width / 2} cy={height - 2} rx={width * 0.35} ry={2.2} fill="rgba(0,0,0,0.22)" />
      {/* shirt + collar */}
      <path
        d={`M ${width * 0.27} 4 L ${width * 0.42} 0 L ${width * 0.58} 0 L ${width * 0.73} 4 L ${width * 0.78} ${height - 4} L ${width * 0.22} ${height - 4} Z`}
        fill={colors.shirt}
      />
      <path
        d={`M ${width * 0.42} 0 L ${width * 0.5} 5 L ${width * 0.58} 0 Z`}
        fill={colors.accent}
      />
      {/* arms */}
      <rect x={width * 0.12} y={4} width={width * 0.12} height={height - 8} fill={colors.shirtDark} rx={2} />
      <rect x={width * 0.76} y={4} width={width * 0.12} height={height - 8} fill={colors.shirtDark} rx={2} />
    </svg>
  );
}

function clothing(kind: SimCardModel["sessionType"]) {
  if (kind === "claude") return { shirt: "hsl(215, 65%, 58%)", shirtDark: "hsl(218, 70%, 42%)", accent: "hsl(208, 80%, 75%)" };
  if (kind === "codex") return { shirt: "hsl(135, 50%, 48%)", shirtDark: "hsl(138, 55%, 32%)", accent: "hsl(120, 60%, 75%)" };
  if (kind === "antigravity") return { shirt: "hsl(275, 55%, 58%)", shirtDark: "hsl(278, 60%, 40%)", accent: "hsl(290, 65%, 78%)" };
  return { shirt: "hsl(30, 45%, 55%)", shirtDark: "hsl(28, 50%, 38%)", accent: "hsl(38, 65%, 75%)" };
}

// ---------------------------------------------------------------------------
// Candle, Fog, Wreath — for the Cemetery scene
// ---------------------------------------------------------------------------

export function CandleSvg({ delay = 0 }: { delay?: number }) {
  return (
    <svg width={12} height={18} viewBox="0 0 12 18" aria-hidden>
      <rect x="4" y="6" width="4" height="11" fill="#F4E2B8" rx="0.5" />
      <rect x="3" y="4.5" width="6" height="2.5" fill="#E2C68B" rx="0.5" />
      <ellipse cx="6" cy="3" rx="1.6" ry="2.6" fill="#FFB74D" style={{ animation: `relayHamletCandleFlicker 0.9s ease-in-out ${delay}s infinite` }} />
      <ellipse cx="6" cy="3.5" rx="0.8" ry="1.4" fill="#FFF9C4" />
    </svg>
  );
}

export function FogStrip({ width, top }: { width: number; top: number }) {
  return (
    <div
      aria-hidden
      className="absolute pointer-events-none"
      style={{
        left: 0,
        right: 0,
        top,
        height: 24,
        width,
        background: "linear-gradient(90deg, rgba(255,255,255,0.0) 0%, rgba(220,225,240,0.35) 50%, rgba(255,255,255,0.0) 100%)",
        filter: "blur(4px)",
        animation: "relayHamletFogDrift 22s linear infinite",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Confetti (used in events banner on celebrate severity)
// ---------------------------------------------------------------------------

export function ConfettiBurst() {
  const pieces = useMemo(() => {
    const out: { id: number; x: number; hue: number; delay: number; rot: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const k = (i * 137) % 360;
      out.push({ id: i, x: 8 + i * 9, hue: k, delay: -(i * 0.15), rot: (k % 40) - 20 });
    }
    return out;
  }, []);
  return (
    <span
      aria-hidden
      className="absolute inset-0 overflow-hidden pointer-events-none"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.x}%`,
            top: "-6px",
            width: 4,
            height: 8,
            background: `hsl(${p.hue}, 80%, 60%)`,
            transform: `rotate(${p.rot}deg)`,
            animation: `relayHamletConfetti 2.4s ease-in ${p.delay}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared keyframes — inject once per consumer view via:
//   <style>{DECOR_CSS}</style>
// ---------------------------------------------------------------------------

export const DECOR_CSS = `
@keyframes relayHamletCloudDrift {
  0%   { transform: translate(0, 0) scale(var(--s, 1)); }
  100% { transform: translate(140vw, 0) scale(var(--s, 1)); }
}
@keyframes relayHamletSunPulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
@keyframes relayHamletChirp {
  0%, 92%, 100% { transform: translate(0, 0) rotate(0deg); }
  94%           { transform: translate(0, -2px) rotate(-6deg); }
  96%           { transform: translate(0, 0)   rotate(6deg); }
  98%           { transform: translate(0, -1px) rotate(-3deg); }
}
@keyframes relayHamletLampGlow {
  0%, 100% { opacity: 0.18; }
  50%      { opacity: 0.34; }
}
@keyframes relayHamletButterfly {
  0%   { transform: translate(-10vw, 0) rotate(-4deg); }
  25%  { transform: translate(25vw, -20px) rotate(6deg); }
  50%  { transform: translate(55vw, 0) rotate(-4deg); }
  75%  { transform: translate(80vw, -16px) rotate(6deg); }
  100% { transform: translate(110vw, 0) rotate(-4deg); }
}
@keyframes relayHamletEkgScroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-48px); }
}
@keyframes relayHamletCandleFlicker {
  0%, 100% { transform: scale(1, 1); opacity: 0.9; }
  20%      { transform: scale(0.9, 1.1); opacity: 1; }
  60%      { transform: scale(1.05, 0.95); opacity: 0.95; }
  80%      { transform: scale(0.95, 1.05); opacity: 1; }
}
@keyframes relayHamletFogDrift {
  0%   { transform: translateX(-20%); opacity: 0.55; }
  50%  { transform: translateX(20%);  opacity: 0.85; }
  100% { transform: translateX(120%); opacity: 0.55; }
}
@keyframes relayHamletConfetti {
  0%   { transform: translate(0, -10px) rotate(0deg); opacity: 0; }
  10%  { opacity: 1; }
  100% { transform: translate(0, 220px) rotate(540deg); opacity: 0; }
}
@keyframes relayHamletMoodPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 80, 80, 0.0); }
  50%      { box-shadow: 0 0 0 6px rgba(220, 80, 80, 0.18); }
}
@keyframes relayHamletNeedGlow {
  0%, 100% { filter: drop-shadow(0 0 0 currentColor); }
  50%      { filter: drop-shadow(0 0 4px currentColor); }
}
@keyframes relayHamletFireflyOrbit {
  0%   { transform: translate(0, 0); opacity: 0.0; }
  20%  { opacity: 1; }
  50%  { transform: translate(20px, -16px); opacity: 0.9; }
  80%  { opacity: 1; }
  100% { transform: translate(0, 0); opacity: 0.0; }
}
`;
