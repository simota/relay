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
import { DIORAMA_DEFS } from "../_lib/fleet-hamlet-diorama-tokens";
import type { Season } from "../_lib/fleet-hamlet-particles";
import { StandingMiniAvatar } from "./fleet-hamlet-park-residents";

// F-4 — season tint colours interpolated via the `--hamlet-season-tint`
// registered custom property (declared in DECOR_CSS). Browsers without
// `@property` support fall back to the literal colour without animation.
const SEASON_TINT: Record<Season, string> = {
  spring: "rgba(255, 200, 220, 0.10)",
  summer: "rgba(255, 240, 180, 0.00)",
  autumn: "rgba(220, 130, 60, 0.10)",
  winter: "rgba(200, 220, 245, 0.14)",
};

// ---------------------------------------------------------------------------
// Sky band — fixed gradient + sun/moon + clouds + stars
// ---------------------------------------------------------------------------

export function SkyBand({
  palette,
  width,
  height,
  weather = "clear",
  season,
}: {
  palette: SkyPalette;
  width: number;
  height: number;
  weather?: WeatherKind;
  /**
   * F-4 — optional season for the tint overlay. When provided, the
   * `--hamlet-season-tint` registered custom property animates between
   * seasons (handled by DECOR_CSS @property + transition). Omit to keep
   * the time-of-day-only behaviour.
   */
  season?: Season;
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
  const isMoon = palette.luminary === "moon";
  // Sun direction unit vector — used so clouds get a highlight on the side
  // facing the sun and a soft shadow on the opposite side.
  const sunDirX = sunX < width * 0.5 ? -1 : sunX > width * 0.5 ? 1 : 0;

  // F-4 — season tint applied via the registered custom property so cross-
  // season changes interpolate the colour rather than snap-switching. The
  // fallback literal `background` keeps SSR / non-Baseline browsers happy.
  const seasonTint = season ? SEASON_TINT[season] : "rgba(255,255,255,0)";
  const skyVars = {
    ["--hamlet-season-tint" as never]: seasonTint,
    transition: "--hamlet-season-tint 1.6s ease-out",
  } as const;
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 pointer-events-none overflow-hidden"
      style={{ height, background: skyBackground, ...skyVars }}
    >
      {/* F-4 — season tint overlay. Reads `--hamlet-season-tint` so the
          colour interpolates smoothly when the season changes. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: "var(--hamlet-season-tint)" }}
      />
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0"
      >
        {/* Sky haze vignette — a wide radial fade tied to the luminary
            position, giving the upper-sky band a subtle volumetric pop. */}
        {!isMoon && (
          <ellipse
            cx={sunX}
            cy={Math.min(sunY + 8, height * 0.5)}
            rx={width * 0.65}
            ry={height * 0.55}
            fill={`url(#${DIORAMA_DEFS.sunHalo})`}
            opacity={0.55}
          />
        )}
        {/* Stars (night) — with a tiny 4-point cross sparkle on the
            brighter ones for a Ghibli-esque shimmer. */}
        {stars.map((s) => (
          <g
            key={s.id}
            transform={`translate(${s.x} ${s.y})`}
            style={{
              animation: `relayHamletTwinkle 2.4s ease-in-out ${s.delay}s infinite`,
            }}
          >
            <circle cx={0} cy={0} r={s.r} fill="#FFFDF0" opacity={0.9} />
            {s.r > 1 && (
              <g stroke="#FFFDF0" strokeWidth={0.35} opacity={0.7} strokeLinecap="round">
                <line x1={-2.2} y1={0} x2={2.2} y2={0} />
                <line x1={0} y1={-2.2} x2={0} y2={2.2} />
              </g>
            )}
          </g>
        ))}
        {/* Luminary — sun gets radial halo + 4 cross rays; moon gets
            craters + cool halo. */}
        <g transform={`translate(${sunX} ${sunY})`}>
          <g style={{ transformOrigin: "0 0", animation: "relayHamletSunPulse 4s ease-in-out infinite" }}>
            {/* Halo */}
            <circle
              cx={0}
              cy={0}
              r={32}
              fill={isMoon ? `url(#${DIORAMA_DEFS.moonHalo})` : `url(#${DIORAMA_DEFS.sunHalo})`}
              opacity={0.95}
            />
            {/* Outer soft glow disk */}
            <circle cx={0} cy={0} r={22} fill={sunFill} opacity={0.32} />
            {/* Core disk */}
            <circle cx={0} cy={0} r={14} fill={sunFill} />
            {isMoon && (
              <>
                <circle cx={5} cy={-3} r={11} fill={palette.sky.includes("0D1B3D") ? "#0D1B3D" : "#1A2B55"} />
                {/* Craters on the bright crescent */}
                <circle cx={-5} cy={-2} r={1.6} fill="rgba(180, 170, 150, 0.55)" />
                <circle cx={-2.4} cy={4.5} r={1.1} fill="rgba(180, 170, 150, 0.42)" />
                <circle cx={-7} cy={3.2} r={0.9} fill="rgba(160, 150, 130, 0.45)" />
              </>
            )}
            {/* Sun cross rays — short white-yellow strokes that fade out;
                rendered only for the sun, not the moon. */}
            {!isMoon && (
              <g stroke={sunFill} strokeOpacity={0.6} strokeLinecap="round">
                <line x1={-26} y1={0} x2={-18} y2={0} strokeWidth={1.4} />
                <line x1={18} y1={0} x2={26} y2={0} strokeWidth={1.4} />
                <line x1={0} y1={-26} x2={0} y2={-18} strokeWidth={1.4} />
                <line x1={0} y1={18} x2={0} y2={26} strokeWidth={1.4} />
                {/* Diagonal lighter rays */}
                <g strokeWidth={1} strokeOpacity={0.4}>
                  <line x1={-19} y1={-19} x2={-14} y2={-14} />
                  <line x1={19} y1={-19} x2={14} y2={-14} />
                  <line x1={-19} y1={19} x2={-14} y2={14} />
                  <line x1={19} y1={19} x2={14} y2={14} />
                </g>
              </g>
            )}
          </g>
        </g>
        {/* Clouds — volumetric blob with sun-side highlight + far-side
            shadow. Parent positions, child handles the drift animation. */}
        {clouds.map((c) => (
          <g
            key={c.id}
            transform={`translate(${c.x}, ${c.y}) scale(${c.scale})`}
            opacity={palette.tod === "night" ? 0.45 : 0.92}
          >
            <g
              style={{
                animation: `relayHamletCloudDrift ${c.dur}s linear ${c.delay}s infinite`,
              }}
            >
              <CloudPath sunDirX={sunDirX} />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}

function CloudPath({ sunDirX = 0 }: { sunDirX?: number }) {
  // Volumetric cloud — 5 overlapping ellipses, then a sun-facing highlight
  // sliver and an opposite-side cool shadow lobe so each cloud reads as a
  // soft 3D pillow rather than a flat blob.
  const hiX = sunDirX < 0 ? 2 : sunDirX > 0 ? 22 : 12;
  const shX = sunDirX < 0 ? 22 : sunDirX > 0 ? 2 : 12;
  return (
    <g>
      {/* Shadow lobe (underside, opposite the sun) */}
      <ellipse cx={shX} cy={11} rx={11} ry={4.4} fill="rgba(120, 130, 160, 0.45)" />
      {/* Main body — five ellipses stacked into a pillow shape */}
      <g fill={`url(#${DIORAMA_DEFS.cloudVolume})`} fillOpacity={0.96}>
        <ellipse cx={0} cy={8} rx={14} ry={7} />
        <ellipse cx={12} cy={5} rx={12} ry={8} />
        <ellipse cx={24} cy={9} rx={10} ry={6} />
        <ellipse cx={6} cy={3} rx={6} ry={4} />
        <ellipse cx={18} cy={3} rx={5.5} ry={3.6} />
      </g>
      {/* F-3 — feTurbulence puff overlay for volumetric softness. */}
      <g filter={`url(#${DIORAMA_DEFS.cloudPuff})`} opacity={0.35}>
        <ellipse cx={12} cy={6} rx={18} ry={8} fill="rgba(255, 255, 255, 0.95)" />
      </g>
      {/* Sun-side highlight — a slim bright sliver tucked on the lit edge */}
      <ellipse cx={hiX} cy={2} rx={5} ry={1.5} fill="rgba(255, 255, 240, 0.85)" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Ground band — soft pastel grass strip with subtle dotted pattern
// ---------------------------------------------------------------------------

export function GroundBand({
  palette,
  height,
}: {
  palette: SkyPalette;
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
      <svg width={w} height={h + 4} viewBox="0 0 28 48" aria-hidden>
        {/* Ground shadow */}
        <ellipse cx="14" cy="44" rx="10" ry="2" fill="rgba(0,0,0,0.28)" />
        {/* Trunk — bark grain */}
        <rect x="12" y="32" width="4" height="10" fill="#5D3A1F" />
        <line x1="13" y1="33" x2="13" y2="41" stroke="#3A2310" strokeWidth="0.4" />
        <line x1="15" y1="33" x2="15" y2="41" stroke="#3A2310" strokeWidth="0.4" />
        {/* Cone layers — each with darker shadow side + brighter lit side */}
        <polygon points="14,4 25,20 3,20" fill="#3F8A3E" />
        <polygon points="14,4 14,20 3,20" fill="#52A24E" opacity="0.85" />
        <polygon points="14,12 24,28 4,28" fill="#4FA255" />
        <polygon points="14,12 14,28 4,28" fill="#62B864" opacity="0.85" />
        <polygon points="14,20 23,34 5,34" fill="#3F8A3E" />
        <polygon points="14,20 14,34 5,34" fill="#52A24E" opacity="0.85" />
        {/* Tip highlight */}
        <polygon points="14,4 12,8 16,8" fill="#86CB66" opacity="0.85" />
        {nightLamp && (
          <circle cx="14" cy="14" r="2" fill="#FFE082" opacity="0.7" />
        )}
      </svg>
    );
  }
  if (kind === "oak") {
    return (
      <svg width={w} height={h + 4} viewBox="0 0 28 48" aria-hidden>
        {/* Ground shadow */}
        <ellipse cx="14" cy="44" rx="11" ry="2.2" fill="rgba(0,0,0,0.28)" />
        {/* Trunk + bark stripes */}
        <rect x="12" y="30" width="4" height="12" fill="#5D3A1F" />
        <line x1="13" y1="31" x2="13" y2="41" stroke="#3A2310" strokeWidth="0.4" />
        <line x1="15" y1="31" x2="15" y2="41" stroke="#3A2310" strokeWidth="0.4" />
        {/* Foliage shadow side (right + bottom) */}
        <circle cx="20" cy="22" r="6" fill="#3F8A3E" />
        <circle cx="14" cy="22" r="9" fill="#5EA044" />
        {/* Main mass */}
        <circle cx="14" cy="18" r="11" fill="#6CAF4F" />
        {/* Lit side (left + top) */}
        <circle cx="8" cy="22" r="6" fill="#7DBE5C" />
        <circle cx="14" cy="14" r="5" fill="#86CB66" />
        {/* Top highlight */}
        <circle cx="11" cy="11" r="2.4" fill="#A4DA82" opacity="0.85" />
      </svg>
    );
  }
  return (
    <svg width={w} height={h * 0.55 + 4} viewBox="0 0 28 28" aria-hidden>
      {/* Ground shadow */}
      <ellipse cx="14" cy="26" rx="11" ry="1.8" fill="rgba(0,0,0,0.24)" />
      {/* Shadow side */}
      <ellipse cx="19" cy="14" rx="6" ry="5" fill="#3F8A3E" />
      {/* Mid */}
      <ellipse cx="14" cy="16" rx="12" ry="7" fill="#6CAF4F" />
      {/* Lit side */}
      <ellipse cx="9" cy="13" rx="6" ry="5" fill="#7DBE5C" />
      {/* Highlight */}
      <ellipse cx="9" cy="11" rx="3" ry="2" fill="#A4DA82" opacity="0.8" />
    </svg>
  );
}

export function FlowerSvg({ hue }: { hue: number }) {
  const petalLit = `hsl(${hue}, 80%, 78%)`;
  const petalMid = `hsl(${hue}, 75%, 68%)`;
  const petalShadow = `hsl(${hue}, 65%, 54%)`;
  const center = `hsl(${(hue + 40) % 360}, 90%, 60%)`;
  const centerHi = `hsl(${(hue + 40) % 360}, 95%, 80%)`;
  return (
    <svg width={14} height={18} viewBox="0 0 14 18" aria-hidden>
      {/* Ground shadow */}
      <ellipse cx="7" cy="17" rx="4" ry="0.9" fill="rgba(0,0,0,0.22)" />
      <rect x="6.4" y="8" width="1.2" height="9" fill="#3F8A3E" />
      {/* Petals — each petal has a shadow lobe + lit lobe */}
      <g>
        {/* shadow first */}
        <circle cx="3.5" cy="7" r="2.4" fill={petalShadow} />
        <circle cx="10.5" cy="7" r="2.4" fill={petalShadow} />
        <circle cx="7" cy="10" r="2.4" fill={petalShadow} />
        {/* lit on top */}
        <circle cx="3.5" cy="6" r="2.4" fill={petalMid} />
        <circle cx="10.5" cy="6" r="2.4" fill={petalMid} />
        <circle cx="7" cy="3" r="2.4" fill={petalLit} />
        <circle cx="7" cy="9" r="2.4" fill={petalMid} />
      </g>
      {/* Center stamen */}
      <circle cx="7" cy="6" r="1.6" fill={center} />
      <circle cx="6.4" cy="5.4" r="0.7" fill={centerHi} />
    </svg>
  );
}

export function MailboxSvg() {
  return (
    <svg width={10} height={20} viewBox="0 0 10 20" aria-hidden>
      {/* Ground shadow */}
      <ellipse cx="5" cy="19" rx="3.4" ry="0.8" fill="rgba(0,0,0,0.28)" />
      {/* Post — wood grain */}
      <rect x="4" y="8" width="2" height="10" fill="#3A2A1F" />
      <line x1="5" y1="9" x2="5" y2="17" stroke="#1F140A" strokeWidth="0.3" />
      {/* Body — cast-iron base + highlight */}
      <rect x="0" y="2" width="10" height="7" rx="2" fill="#7B1F18" />
      <rect x="0" y="2" width="10" height="3" rx="2" fill="#C13B2C" />
      <rect x="0.6" y="2.5" width="9" height="1.2" rx="1" fill="#E25E4D" opacity="0.85" />
      {/* Slot + flag */}
      <rect x="2" y="4.5" width="2.2" height="1.8" rx="0.4" fill="#1A0F0C" />
      <rect x="2.2" y="4.7" width="1.8" height="0.4" fill="#FFFDF0" opacity="0.7" />
      <rect x="8" y="3" width="1" height="3" fill="#FFE082" />
      <rect x="8" y="3" width="1" height="0.6" fill="#FFF6C8" />
    </svg>
  );
}

export function NameplateSvg({ text }: { text: string }) {
  return (
    <svg width={26} height={14} viewBox="0 0 26 14" aria-hidden>
      {/* Drop shadow */}
      <rect x="1" y="2.2" width="25" height="11" rx="2" fill="rgba(0,0,0,0.22)" />
      {/* Wood plaque — grain via two stacked rects */}
      <rect x="0.5" y="0.5" width="25" height="11" rx="2" fill="#E9D7AE" stroke="#5C3D1F" strokeWidth="0.8" />
      <rect x="0.8" y="0.8" width="24.4" height="4" rx="1.6" fill="#F3E5C3" opacity="0.85" />
      <line x1="2" y1="6" x2="24" y2="6" stroke="#B98F58" strokeWidth="0.25" opacity="0.7" />
      <line x1="2" y1="9.2" x2="24" y2="9.2" stroke="#B98F58" strokeWidth="0.25" opacity="0.7" />
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
      {/* Body shadow underside */}
      <ellipse cx="7" cy="7" rx="4.5" ry="2" fill="#3A2566" opacity="0.6" />
      {/* Body */}
      <ellipse cx="7" cy="6" rx="4.5" ry="3" fill="#5C3D8A" />
      {/* Body highlight */}
      <ellipse cx="6" cy="5" rx="2.8" ry="1.4" fill="#8E68C0" opacity="0.7" />
      <circle cx="11" cy="4.5" r="2" fill="#5C3D8A" />
      <circle cx="10.5" cy="4" r="0.9" fill="#8E68C0" opacity="0.7" />
      <circle cx="11.5" cy="4" r="0.4" fill="#FFFDF0" />
      <path d="M12.5 4.5 L 14 4 L 12.7 5.2 Z" fill="#FFA726" />
      <path d="M3 6 Q 5 3 7 6" stroke="#3A2566" strokeWidth="0.8" fill="none" />
    </svg>
  );
}

export function StreetlampSvg({ lit }: { lit: boolean }) {
  return (
    <svg width={28} height={56} viewBox="0 0 28 56" aria-hidden overflow="visible">
      {/* Ground projection — only when lit. Sits well below the lamp base. */}
      {lit && (
        <ellipse
          cx="14"
          cy="54"
          rx="13"
          ry="3.4"
          fill={`url(#${DIORAMA_DEFS.lampGlow})`}
          opacity="0.85"
        />
      )}
      {/* Metallic post — gradient via overlaid rects */}
      <rect x="13" y="14" width="2" height="36" fill="#1F1F1F" />
      <rect x="13" y="14" width="1" height="36" fill="#4A4A4A" opacity="0.85" />
      {/* Base plate */}
      <rect x="10" y="48" width="8" height="3" rx="1" fill="#2A2A2A" />
      <rect x="10" y="48" width="8" height="1" rx="1" fill="#5A5A5A" opacity="0.7" />
      {/* Lamp housing */}
      <rect x="9" y="8" width="10" height="6" rx="1.5" fill="#2A2A2A" />
      <rect x="9" y="8" width="10" height="2" rx="1.5" fill="#5A5A5A" opacity="0.8" />
      {/* Bulb */}
      <rect x="11" y="10" width="6" height="3" fill={lit ? "#FFE082" : "#3A3A3A"} />
      {/* Light orb halo */}
      {lit && (
        <>
          <circle
            cx="14"
            cy="12"
            r="16"
            fill={`url(#${DIORAMA_DEFS.lampGlow})`}
            opacity="0.65"
            style={{ animation: "relayHamletLampGlow 3s ease-in-out infinite" }}
          />
          <circle cx="14" cy="12" r="2.4" fill="#FFF6C8" opacity="0.95" />
        </>
      )}
    </svg>
  );
}

export function ButterflySvg({ delay = 0, hue = 320 }: { delay?: number; hue?: number }) {
  const wingMain = `hsl(${hue}, 75%, 65%)`;
  const wingHi = `hsl(${hue}, 80%, 82%)`;
  const wingSh = `hsl(${hue}, 60%, 50%)`;
  const wingAlt = `hsl(${(hue + 30) % 360}, 75%, 70%)`;
  const wingAltHi = `hsl(${(hue + 30) % 360}, 80%, 85%)`;
  return (
    <svg
      width={16}
      height={12}
      viewBox="0 0 16 12"
      aria-hidden
      style={{ animation: `relayHamletButterfly 18s linear ${delay}s infinite` }}
    >
      {/* Left wing — shadow then main then highlight */}
      <ellipse cx="6" cy="7" rx="4" ry="2.6" fill={wingSh} opacity="0.85" />
      <ellipse cx="6" cy="6" rx="4" ry="3" fill={wingMain} />
      <ellipse cx="5" cy="5" rx="2" ry="1.2" fill={wingHi} opacity="0.85" />
      {/* Right wing */}
      <ellipse cx="10" cy="7" rx="4" ry="2.6" fill={wingSh} opacity="0.7" />
      <ellipse cx="10" cy="6" rx="4" ry="3" fill={wingAlt} />
      <ellipse cx="11" cy="5" rx="2" ry="1.2" fill={wingAltHi} opacity="0.85" />
      {/* Body */}
      <rect x="7.5" y="4" width="1" height="5" rx="0.4" fill="#3A2A1F" />
      <rect x="7.5" y="4" width="0.4" height="5" rx="0.2" fill="#6A4A3A" opacity="0.8" />
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
  resident,
}: {
  decor: YardDecor;
  cellW: number;
  cellH: number;
  nightLamps: boolean;
  /**
   * Out-of-house signal (gimmick A.3). When `kind === "home"`, render a
   * tiny resident standing on the front lawn. When `kind === "out"`, hang
   * an "Out" placard on the door. Omit/`undefined` to keep the original
   * yard behavior unchanged (back-compat with existing callers).
   */
  resident?: ResidentSignal;
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
      {resident && resident.kind === "home" && (
        // Anchor the resident to the bottom-right of the cell so they read
        // as "standing on the lawn next to the door" rather than floating.
        <span
          style={{
            position: "absolute",
            // Right side of the house front (door sits ~32% across), slightly
            // outside the door so the resident isn't visually blocked by it.
            left: cellW * 0.6,
            bottom: cellH * 0.1,
            transformOrigin: "bottom center",
            opacity: 0.95,
          }}
        >
          <ResidentAvatar
            agentKind={resident.agentKind}
            hue={resident.hue}
            sim={resident.sim}
          />
        </span>
      )}
      {resident && resident.kind === "out" && (
        // Sign hangs to the right of the door, level with the upper sash so
        // it reads as "tacked beside the door".
        <span
          style={{
            position: "absolute",
            // Door front is at ~cellW * 0.32 in HouseSvg's local frame, but
            // YardLayer covers the whole cell; the house is centered, so the
            // door sits roughly at cellW * 0.42 from the cell's left edge.
            left: cellW * 0.5,
            // Door top ~ cellH * 0.42 from the bottom (wallH * 0.55 of a
            // mid-sized house, with cellH ≈ wallH + roofH + padding).
            bottom: cellH * 0.34,
          }}
        >
          <OutSign cellW={cellW} />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resident signal — encodes "is anyone home right now?" for the yard layer.
// ---------------------------------------------------------------------------

export type ResidentSignal =
  | {
      kind: "home";
      agentKind: SimCardModel["sessionType"];
      hue: number;
      sim?: SimCardModel;
    }
  | { kind: "out" };

// ---------------------------------------------------------------------------
// ResidentAvatar — tiny standing sim used for the "at home" yard signal.
// Uses the same StandingMiniAvatar primitive as the park residents so the
// character family is consistent across active and park zones.
// ---------------------------------------------------------------------------

export function ResidentAvatar({
  agentKind,
  hue,
  sim,
}: {
  agentKind: SimCardModel["sessionType"];
  hue: number;
  sim?: SimCardModel;
}) {
  return (
    <span
      // Sized at ~70% so the resident reads as "small but visible" in front
      // of the house. Idle breathe is inherited from StandingMiniAvatar.
      style={{ display: "inline-block", transform: "scale(0.7)", transformOrigin: "bottom center" }}
    >
      <StandingMiniAvatar agentKind={agentKind} hue={hue} sim={sim} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// OutSign — small door placard for the "out" yard signal.
//
// Wood-grain rectangle with a key glyph + "OUT" letters, drawn at a size
// proportional to the cell so it scales with the house. Animated with a
// slow sway so it visually reads as hanging.
// ---------------------------------------------------------------------------

export function OutSign({ cellW }: { cellW: number }) {
  // Target ~ 18% of cellW for the sign width, clamped to sensible bounds so
  // it never disappears or swallows the door.
  const w = Math.max(16, Math.min(24, cellW * 0.18));
  const h = w * 0.7;
  return (
    <svg
      width={w}
      height={h + 4}
      viewBox={`0 0 ${w} ${h + 4}`}
      aria-hidden
      style={{
        animation: `relayHamletOutSignSway 3.6s ease-in-out infinite`,
        transformOrigin: `${w * 0.5}px 0px`,
        overflow: "visible",
      }}
    >
      {/* String — anchors the sign to the wall above. */}
      <line x1={w * 0.5} y1={0} x2={w * 0.5} y2={2.5} stroke="#3A2A1F" strokeWidth={0.6} />
      {/* Drop shadow */}
      <rect x={1.2} y={3.4} width={w - 1.2} height={h} rx={1.6} fill="rgba(0,0,0,0.32)" />
      {/* Wood plaque */}
      <rect x={0.6} y={2.6} width={w - 1.2} height={h} rx={1.6} fill="#C9A878" stroke="#5C3D1F" strokeWidth={0.7} />
      {/* Wood grain — two faint horizontal lines */}
      <line x1={2} y1={2.6 + h * 0.35} x2={w - 2} y2={2.6 + h * 0.35} stroke="#8B6A3E" strokeWidth={0.3} opacity={0.6} />
      <line x1={2} y1={2.6 + h * 0.65} x2={w - 2} y2={2.6 + h * 0.65} stroke="#8B6A3E" strokeWidth={0.3} opacity={0.6} />
      {/* "OUT" lettering — centered, monospace-ish stroke */}
      <text
        x={w * 0.5}
        y={2.6 + h * 0.62}
        textAnchor="middle"
        fontSize={Math.max(6, h * 0.55)}
        fontFamily="ui-monospace, monospace"
        fontWeight="700"
        fill="#3A2A1F"
        letterSpacing="0.4"
      >
        OUT
      </text>
    </svg>
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
// Avatar body — torso + collar + arms + hands + tiny legs + shoes, slotted
// underneath the SimAvatar / HeaderAvatar head sprites. The pose props are
// optional so existing callers keep working without changes; passing a
// `mood` lets the body lean / wave / cross arms in sync with the head's
// expression.
//
// Caller responsibility: ground shadow + idle breathe wrapping — both are
// applied at the parent group so the head + body breathe together.
// ---------------------------------------------------------------------------

import type { MoodKey } from "../_lib/fleet-hamlet";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";

export function AvatarBody({
  agentKind,
  width = 48,
  height = 22,
  mood,
}: {
  agentKind: SimCardModel["sessionType"];
  width?: number;
  height?: number;
  mood?: MoodKey;
}) {
  // Match the SimAvatar 48×48 head box; this strip slots underneath it.
  const colors = clothing(agentKind);
  const pose = mood ? getExpressionForMood(mood).pose : "idle";
  const centerX = width * 0.5;
  const torsoTop = height * 0.04;
  const torsoBottom = height - 6;
  const topW = width * 0.28;
  const botW = width * 0.44;
  const shoulderY = height * 0.11;
  const armW = width * 0.11;
  const handR = Math.max(1.2, width * 0.045);
  const armLen = Math.max(4, torsoBottom - shoulderY - handR * 1.55);
  const shoulderDx = topW / 2 + armW * 0.65;
  // Rotation conventions match BodyTorso in fleet-hamlet-avatar.tsx: SVG
  // rotate() is clockwise for positive degrees. LEFT arm POSITIVE swings
  // the hand inward across the chest; RIGHT arm NEGATIVE mirrors it.
  const leftArmRot =
    pose === "cross-arms"
      ? 70
      : pose === "crouch"
        ? -20
        : pose === "sigh"
          ? 8
          : pose === "step-forward"
            ? 10
            : 0;
  const rightArmRot =
    pose === "cross-arms"
      ? -70
      : pose === "wave"
        ? -28
        : pose === "crouch"
          ? 20
          : pose === "sigh"
            ? -8
            : pose === "step-forward"
              ? -10
              : 0;
  const stepFwd = pose === "step-forward";
  const sleeping = pose === "sleeping";
  return (
    <svg width={width} height={height + 6} viewBox={`0 0 ${width} ${height + 6}`} aria-hidden overflow="visible">
      {/* Ground shadow */}
      <ellipse cx={width / 2} cy={height + 3} rx={width * 0.34} ry={2.2} fill="rgba(0,0,0,0.32)" />
      {sleeping ? (
        // Lying-down torso for sleeping mood
        <g>
          <rect
            x={width * 0.18}
            y={height - 6}
            width={width * 0.64}
            height={6}
            rx={3}
            fill={colors.shirt}
          />
          <rect
            x={width * 0.18}
            y={height - 6}
            width={width * 0.64}
            height={1.5}
            rx={1}
            fill={colors.accent}
            opacity={0.7}
          />
        </g>
      ) : (
        <g>
          {/* Legs — two short trunks with shoes underneath */}
          <g>
            {/* Left leg */}
            <rect
              x={stepFwd ? width * 0.32 : width * 0.34}
              y={height - 6}
              width={width * 0.1}
              height={6}
              rx={1.2}
              fill="#4A382C"
            />
            <ellipse
              cx={stepFwd ? width * 0.37 : width * 0.39}
              cy={height + 0.5}
              rx={width * 0.08}
              ry={1.4}
              fill="#1F1410"
            />
            {/* Right leg */}
            <rect
              x={stepFwd ? width * 0.5 : width * 0.56}
              y={height - 6}
              width={width * 0.1}
              height={6}
              rx={1.2}
              fill="#4A382C"
            />
            <ellipse
              cx={stepFwd ? width * 0.55 : width * 0.61}
              cy={height + 0.5}
              rx={width * 0.08}
              ry={1.4}
              fill="#1F1410"
            />
          </g>
          {/* Torso barrel — pear silhouette: top narrows, bottom widens */}
          <path
            d={`M ${centerX - topW / 2} ${torsoTop}
                L ${centerX + topW / 2} ${torsoTop}
                L ${centerX + botW / 2} ${torsoBottom}
                L ${centerX - botW / 2} ${torsoBottom} Z`}
            fill={colors.shirt}
          />
          {/* Right-half shading */}
          <path
            d={`M ${centerX} ${torsoTop}
                L ${centerX + topW / 2} ${torsoTop}
                L ${centerX + botW / 2} ${torsoBottom}
                L ${centerX} ${torsoBottom} Z`}
            fill={colors.shirtDark}
            opacity={0.4}
          />
          {/* Rim-light stripe on the lit (left) edge */}
          <path
            d={`M ${centerX - topW / 2} ${torsoTop}
                L ${centerX - topW / 2 + width * 0.04} ${torsoTop}
                L ${centerX - botW / 2 + width * 0.04} ${torsoBottom}
                L ${centerX - botW / 2} ${torsoBottom} Z`}
            fill={colors.accent}
            opacity={0.85}
          />
          {/* Collar — V on top of the torso */}
          <path
            d={`M ${centerX - topW / 2} ${torsoTop}
                L ${centerX} ${height * 0.32}
                L ${centerX + topW / 2} ${torsoTop}
                L ${centerX + topW / 2 - width * 0.05} ${height * 0.02}
                L ${centerX} ${height * 0.23}
                L ${centerX - topW / 2 + width * 0.05} ${height * 0.02} Z`}
            fill={colors.accent}
          />
          {/* Two front buttons */}
          <circle cx={centerX} cy={height * 0.4 + 1} r={Math.max(0.6, width * 0.025)} fill={colors.shirtDark} />
          <circle cx={centerX} cy={height * 0.6 + 1} r={Math.max(0.6, width * 0.025)} fill={colors.shirtDark} />
          {/* Arms with hands — explicit foreground layer, shoulder-origin limbs. */}
          <g>
            <g transform={`translate(${centerX - shoulderDx}, ${shoulderY}) rotate(${leftArmRot})`}>
              <rect
                x={-armW / 2}
                y={0}
                width={armW}
                height={armLen}
                fill={pose === "cross-arms" ? colors.shirt : colors.shirtDark}
                rx={armW * 0.45}
              />
              {pose !== "cross-arms" && (
                <rect
                  x={-armW / 2}
                  y={0}
                  width={armW * 0.32}
                  height={armLen}
                  fill={colors.accent}
                  opacity={0.6}
                  rx={armW * 0.32}
                />
              )}
              <circle cx={0} cy={armLen + handR * 0.5} r={handR} fill="#F0CDA8" />
            </g>
            <g transform={`translate(${centerX + shoulderDx}, ${shoulderY}) rotate(${rightArmRot})`}>
              <g
                style={
                  pose === "wave"
                    ? {
                        animation: "relayHamletWaveHand 1.6s ease-in-out infinite",
                        transformOrigin: "0px 0px",
                      }
                    : undefined
                }
              >
                <rect
                  x={-armW / 2}
                  y={0}
                  width={armW}
                  height={armLen}
                  fill={colors.shirtDark}
                  rx={armW * 0.45}
                />
                <circle cx={0} cy={armLen + handR * 0.5} r={handR} fill="#F0CDA8" />
              </g>
            </g>
          </g>
        </g>
      )}
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
/* F-4 — @property registered custom properties for typed colour / number
 * interpolation across mood + season changes. Supported in Chrome 85+,
 * Safari 16.4+, Firefox 128+ (Baseline 2024). Browsers without support
 * fall back to instant transitions, which is the existing behaviour. */
@property --hamlet-mood-hue {
  syntax: "<angle>";
  inherits: true;
  initial-value: 40deg;
}
@property --hamlet-mood-saturation {
  syntax: "<percentage>";
  inherits: true;
  initial-value: 50%;
}
@property --hamlet-mood-lightness {
  syntax: "<percentage>";
  inherits: true;
  initial-value: 80%;
}
@property --hamlet-mood-bottom-lightness {
  syntax: "<percentage>";
  inherits: true;
  initial-value: 70%;
}
@property --hamlet-season-tint {
  syntax: "<color>";
  inherits: true;
  initial-value: rgba(255, 255, 255, 0);
}
@property --hamlet-breathe {
  syntax: "<number>";
  inherits: true;
  initial-value: 1;
}

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
@keyframes relayHamletWaveHand {
  0%, 100% { transform: rotate(-12deg); }
  50%      { transform: rotate(18deg); }
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
@keyframes relayHamletOutSignSway {
  0%, 100% { transform: rotate(-3deg); }
  50%      { transform: rotate(3deg); }
}
`;
