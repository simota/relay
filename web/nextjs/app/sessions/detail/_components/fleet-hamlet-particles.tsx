"use client";

// Fleet Hamlet — Particles, Walking Sims, Mini Avatars, Background Layers.
//
// Pure SVG + CSS keyframe components consumed by Neighborhood / House Plan
// / Events Banner. All animations are CSS-only (no JS rAF) and all SVG
// nodes per instance are kept small (≤ 12) so a Hamlet page stays under
// the ~300 SVG-node budget even with all layers active.

import { useMemo } from "react";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import { avatarPartsFromSeed, hashStringToInt } from "../_lib/fleet-hamlet";
import {
  type Accessories,
  type FallingPiece,
  type LightningBolt,
  type Season,
  type WalkingSimSpec,
  rainDrops,
  seasonParticles,
} from "../_lib/fleet-hamlet-particles";
import { AvatarBody } from "./fleet-hamlet-decor";
import { HAMLET_AVATAR_CSS, HeadFace, clothingForAgent } from "./fleet-hamlet-avatar";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";
import { DIORAMA_DEFS } from "../_lib/fleet-hamlet-diorama-tokens";

// ---------------------------------------------------------------------------
// Walking sims — small avatars that traverse the street
// ---------------------------------------------------------------------------

export function WalkingSimLayer({
  specs,
  width,
  yBase,
}: {
  specs: readonly WalkingSimSpec[];
  /** Horizontal pixel width of the active street; used to compute the path. */
  width: number;
  /** Pixel top of the street band that the sims walk on (above ground). */
  yBase: number;
}) {
  if (specs.length === 0 || width <= 80) return null;
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {specs.map((spec, i) => (
        <WalkingSim
          key={`${spec.sim.key}-${i}`}
          spec={spec}
          width={width}
          yBase={yBase}
        />
      ))}
    </div>
  );
}

function WalkingSim({
  spec,
  width,
  yBase,
}: {
  spec: WalkingSimSpec;
  width: number;
  yBase: number;
}) {
  const top = yBase + spec.topPx;
  // delayMs is negative — start mid-cycle so sims appear pre-placed.
  const delayS = -(spec.startOffset * (spec.durationMs / 1000));
  const durS = (spec.durationMs / 1000).toFixed(1);
  return (
    <span
      style={{
        position: "absolute",
        top,
        left: 0,
        width: 36,
        height: 30,
        animation: `relayHamletWalkPath ${durS}s linear ${delayS}s infinite`,
        // CSS variable used by the keyframe to traverse the full street.
        ["--relay-walk-distance" as unknown as string]: `${width + 40}px`,
        transform: spec.direction === -1 ? "scaleX(-1)" : undefined,
        transformOrigin: "center",
      }}
    >
      <span
        style={{
          display: "inline-block",
          // 4-frame steps() walk gives a sprite-style cadence. We keep
          // the existing walkBob keyframe as the cushion bounce on a
          // second wrapper so the rhythm reads as "step + breathe".
          animation: "relayHamletWalk4Frame 0.6s steps(4, end) infinite",
        }}
      >
        <span
          style={{
            display: "inline-block",
            animation: "relayHamletWalkBob 0.6s ease-in-out infinite",
          }}
        >
          <MiniSimAvatar agentKind={spec.sim.sessionType} hue={spec.sim.hue} sim={spec.sim} />
        </span>
      </span>
    </span>
  );
}

function MiniSimAvatar({
  agentKind,
  hue,
  sim,
}: {
  agentKind: SimCardModel["sessionType"];
  hue: number;
  /** Optional full sim — when present, the mini avatar uses its mood
   *  expression + deterministic face features. */
  sim?: SimCardModel;
}) {
  // Derive a deterministic seed even if the caller didn't pass a sim
  // (street walkers re-use the agentKind+hue to keep the look stable).
  const seed = sim?.avatarSeed ?? hashStringToInt(`${agentKind}:${hue}`);
  const stage = sim?.stage.key;
  const parts = useMemo(() => avatarPartsFromSeed(seed, stage), [seed, stage]);
  const moodKey = sim?.mood.key ?? "happy";
  const expression = useMemo(() => getExpressionForMood(moodKey), [moodKey]);
  const clothes = clothingForAgent(agentKind);
  // Compact 22×30 sprite: head r=5 centered at (11, 6), body 8×11 below.
  return (
    <svg width={22} height={30} viewBox="0 0 22 30" aria-hidden overflow="visible">
      {/* Ground contact: dark shadow + agent-colour foot ring so walkers
          read as planted on the path instead of floating over it. */}
      <ellipse cx={11} cy={28.5} rx={6.8} ry={1.35} fill="rgba(0,0,0,0.3)" />
      <ellipse
        cx={11}
        cy={27.9}
        rx={5}
        ry={0.85}
        fill={clothes.accent}
        opacity={0.42}
      />
      <g
        style={{
          animation: `relayHamletIdleBreathe 4s ease-in-out ${parts.breatheDelay}s infinite`,
          transformOrigin: "center",
        }}
      >
        {/* Torso barrel — small enough that we skip rim-light stripes */}
        <path
          d={`M 7 11 L 7.5 14 L 7 22 L 15 22 L 14.5 14 L 15 11 Z`}
          fill={clothes.shirt}
          stroke="rgba(25,25,25,0.32)"
          strokeWidth={0.3}
        />
        <path
          d={`M 11 11 L 15 11 L 14.5 14 L 15 22 L 11 22 Z`}
          fill={clothes.shirtDark}
          opacity={0.45}
        />
        {/* Collar V */}
        <path d="M 8 11 L 11 13 L 14 11 L 11 14 Z" fill={clothes.accent} />
        {/* Legs + shoes */}
        <rect x={8} y={22} width={2} height={4.5} rx={0.6} fill="#4A382C" />
        <rect x={12} y={22} width={2} height={4.5} rx={0.6} fill="#4A382C" />
        <ellipse cx={9} cy={27} rx={1.4} ry={0.6} fill="#1F1410" />
        <ellipse cx={13} cy={27} rx={1.4} ry={0.6} fill="#1F1410" />
        {/* Head — translate to (11, 6) and render the shared face primitive */}
        <g transform="translate(11, 6)">
          <HeadFace
            parts={parts}
            expression={expression}
            radius={5}
            enableBlink={false}
            enableCheeks={false}
          />
        </g>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Mini avatar — used inside House Plan room cards
// ---------------------------------------------------------------------------

export function MiniAvatar({
  sim,
  accessories,
}: {
  sim: SimCardModel;
  accessories?: Accessories;
}) {
  return (
    <span
      className="inline-flex flex-col items-center"
      style={{ width: 30, height: 40 }}
      aria-hidden
    >
      <span style={{ position: "relative", width: 24, height: 24 }}>
        <MiniSimAvatar agentKind={sim.sessionType} hue={sim.hue} sim={sim} />
        {accessories?.hat && accessories.hat !== "none" && (
          <span
            style={{
              position: "absolute",
              top: -4,
              left: 2,
              pointerEvents: "none",
            }}
          >
            <HatSvg kind={accessories.hat} />
          </span>
        )}
        {accessories?.crown && (
          <span
            style={{
              position: "absolute",
              top: -7,
              left: 4,
              pointerEvents: "none",
              animation: "relayHamletTwinkle 2s ease-in-out infinite",
            }}
          >
            <CrownSvg />
          </span>
        )}
      </span>
      <AvatarBody agentKind={sim.sessionType} width={24} height={10} mood={sim.mood.key} />
      {accessories?.badge && (
        <span
          className="mt-0.5 px-1 text-[7px] font-mono rounded border"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
            color: "var(--color-fg-muted)",
            lineHeight: 1.2,
          }}
        >
          {accessories.badge}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hat / Crown / Badge SVGs — small accessory glyphs
// ---------------------------------------------------------------------------

export function HatSvg({ kind }: { kind: "scholar" | "cap" | "tophat" }) {
  if (kind === "scholar") {
    // Mortarboard
    return (
      <svg width={16} height={9} viewBox="0 0 16 9" aria-hidden>
        <polygon points="8,1 15,4 8,7 1,4" fill="#1F1F2A" />
        <rect x="5" y="5" width="6" height="2" fill="#1F1F2A" />
        <line x1="15" y1="4" x2="15" y2="8" stroke="#C13B2C" strokeWidth="0.6" />
        <circle cx="15" cy="8" r="0.8" fill="#FFE082" />
      </svg>
    );
  }
  if (kind === "cap") {
    // Baseball cap
    return (
      <svg width={16} height={8} viewBox="0 0 16 8" aria-hidden>
        <path d="M2 5 Q 4 1 8 1 Q 12 1 13 5 Z" fill="#3A8AC0" />
        <rect x="2" y="5" width="13" height="1.5" rx="0.6" fill="#2C6B98" />
        <circle cx="8" cy="3" r="0.8" fill="#FFE082" />
      </svg>
    );
  }
  // tophat
  return (
    <svg width={14} height={10} viewBox="0 0 14 10" aria-hidden>
      <rect x="3" y="0" width="8" height="7" rx="0.6" fill="#1A1A1F" />
      <rect x="1" y="7" width="12" height="1.5" rx="0.4" fill="#1A1A1F" />
      <rect x="3" y="4" width="8" height="1" fill="#5C3D8A" />
    </svg>
  );
}

export function CrownSvg() {
  return (
    <svg width={14} height={8} viewBox="0 0 14 8" aria-hidden>
      <polygon
        points="1,7 2,2 4,5 7,1 10,5 12,2 13,7"
        fill="#FFC857"
        stroke="#A6781E"
        strokeWidth="0.4"
      />
      <circle cx="7" cy="3" r="0.8" fill="#E0476B" />
      <circle cx="3" cy="5" r="0.5" fill="#3A8AC0" />
      <circle cx="11" cy="5" r="0.5" fill="#3A8AC0" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Mountain range — distant parallax backdrop
// ---------------------------------------------------------------------------

export function MountainRange({
  width,
  height,
  season,
}: {
  width: number;
  height: number;
  season: Season;
}) {
  const tip = season === "winter" ? "#F0F4FA" : season === "autumn" ? "#9C3F2E" : "#6F5C82";
  const base = season === "winter" ? "#7F8FA8" : season === "autumn" ? "#5C4533" : "#4E3F6A";
  const lit = season === "winter" ? "#A8B8D0" : season === "autumn" ? "#7A6048" : "#7062A0";
  const shadow = season === "winter" ? "#56627C" : season === "autumn" ? "#3D2C20" : "#2F2548";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="absolute inset-x-0 pointer-events-none"
      style={{ bottom: 0 }}
    >
      {/* Far range — desaturated, low-contrast back layer */}
      <polygon
        points={`0,${height} ${width * 0.1},${height * 0.62} ${width * 0.28},${height * 0.78} ${width * 0.42},${height * 0.55} ${width * 0.6},${height * 0.7} ${width * 0.78},${height * 0.6} ${width},${height * 0.72} ${width},${height}`}
        fill={base}
        opacity={0.32}
      />
      {/* Far-range cloud shadows — horizontal soft bands */}
      <ellipse
        cx={width * 0.32}
        cy={height * 0.7}
        rx={width * 0.18}
        ry={3}
        fill="rgba(20, 26, 40, 0.18)"
      />
      <ellipse
        cx={width * 0.7}
        cy={height * 0.66}
        rx={width * 0.22}
        ry={3}
        fill="rgba(20, 26, 40, 0.15)"
      />

      {/* Mid range — base silhouette */}
      <polygon
        points={`0,${height} ${width * 0.18},${height * 0.45} ${width * 0.35},${height * 0.65} ${width * 0.5},${height * 0.35} ${width * 0.68},${height * 0.6} ${width * 0.85},${height * 0.5} ${width},${height * 0.65} ${width},${height}`}
        fill={base}
        opacity={0.6}
      />
      {/* Shadow side of each peak (right slope) */}
      <polygon
        points={`${width * 0.18},${height * 0.45} ${width * 0.35},${height * 0.65} ${width * 0.18},${height * 0.65}`}
        fill={shadow}
        opacity={0.55}
      />
      <polygon
        points={`${width * 0.5},${height * 0.35} ${width * 0.68},${height * 0.6} ${width * 0.5},${height * 0.6}`}
        fill={shadow}
        opacity={0.55}
      />
      <polygon
        points={`${width * 0.85},${height * 0.5} ${width},${height * 0.65} ${width * 0.85},${height * 0.65}`}
        fill={shadow}
        opacity={0.55}
      />
      {/* Lit side of each peak (left slope) */}
      <polygon
        points={`${width * 0.18},${height * 0.45} ${width * 0.18},${height * 0.65} ${width * 0.05},${height * 0.7}`}
        fill={lit}
        opacity={0.55}
      />
      <polygon
        points={`${width * 0.5},${height * 0.35} ${width * 0.5},${height * 0.6} ${width * 0.36},${height * 0.62}`}
        fill={lit}
        opacity={0.55}
      />
      <polygon
        points={`${width * 0.85},${height * 0.5} ${width * 0.85},${height * 0.65} ${width * 0.72},${height * 0.62}`}
        fill={lit}
        opacity={0.5}
      />

      {/* Snowcap / autumn tip on the main peak + secondary peak */}
      <polygon
        points={`${width * 0.45},${height * 0.45} ${width * 0.5},${height * 0.35} ${width * 0.55},${height * 0.45}`}
        fill={tip}
        opacity={season === "winter" ? 0.95 : 0.7}
      />
      <polygon
        points={`${width * 0.155},${height * 0.5} ${width * 0.18},${height * 0.45} ${width * 0.21},${height * 0.5}`}
        fill={tip}
        opacity={season === "winter" ? 0.85 : 0.5}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Weather — rain + lightning overlays
// ---------------------------------------------------------------------------

export function RainLayer({
  width,
  height,
  count = 28,
}: {
  width: number;
  height: number;
  count?: number;
}) {
  const drops = useMemo(() => rainDrops(count, width), [count, width]);
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 pointer-events-none overflow-hidden"
      style={{ top: 0, height, width }}
    >
      {drops.map((d) => (
        <span
          key={d.id}
          style={{
            position: "absolute",
            top: -d.length,
            left: `${d.xPct}%`,
            width: 1,
            height: d.length,
            background: "linear-gradient(to bottom, rgba(180,200,230,0) 0%, rgba(180,200,230,0.85) 100%)",
            animation: `relayHamletRain ${d.duration.toFixed(2)}s linear ${d.delay.toFixed(2)}s infinite`,
            ["--relay-rain-distance" as unknown as string]: `${height + 20}px`,
          }}
        />
      ))}
    </div>
  );
}

export function LightningOverlay({
  bolts,
  width,
  height,
}: {
  bolts: readonly LightningBolt[];
  width: number;
  height: number;
}) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ width, height }}
    >
      {bolts.map((b, i) => (
        <span
          key={i}
          className="absolute inset-0"
          style={{
            background: "rgba(255, 255, 240, 0.85)",
            animation: `relayHamletLightning ${b.cycle.toFixed(1)}s linear ${b.delay.toFixed(1)}s infinite`,
            opacity: 0,
          }}
        />
      ))}
      {/* Bolt path on the brightest peak */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0"
        aria-hidden
        style={{
          animation: bolts[0]
            ? `relayHamletLightning ${bolts[0].cycle.toFixed(1)}s linear ${bolts[0].delay.toFixed(1)}s infinite`
            : undefined,
          opacity: 0,
        }}
      >
        <path
          d={`M ${width * 0.5} 0 L ${width * 0.46} ${height * 0.25} L ${width * 0.52} ${height * 0.32} L ${width * 0.44} ${height * 0.55}`}
          stroke="#FFFFFF"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season particle layers — petals / leaves / snow
// ---------------------------------------------------------------------------

export function SeasonParticleLayer({
  season,
  width,
  height,
  count = 12,
  seed = 1,
}: {
  season: Season;
  width: number;
  height: number;
  count?: number;
  seed?: number;
}) {
  const pieces = useMemo(
    () => seasonParticles(season, count, seed),
    [season, count, seed],
  );
  if (season === "summer") return null;
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 pointer-events-none overflow-hidden"
      style={{ top: 0, width, height }}
    >
      {pieces.map((p) => (
        <SeasonParticle key={p.id} piece={p} season={season} height={height} />
      ))}
    </div>
  );
}

function SeasonParticle({
  piece,
  season,
  height,
}: {
  piece: FallingPiece;
  season: Season;
  height: number;
}) {
  const anim =
    season === "winter"
      ? "relayHamletSnow"
      : season === "autumn"
      ? "relayHamletLeaf"
      : "relayHamletPetal";
  return (
    <span
      style={{
        position: "absolute",
        top: -10,
        left: `${piece.xPct}%`,
        transform: `scale(${piece.scale})`,
        animation: `${anim} ${piece.duration.toFixed(1)}s linear ${piece.delay.toFixed(1)}s infinite`,
        ["--relay-fall-distance" as unknown as string]: `${height + 20}px`,
        ["--relay-fall-sway" as unknown as string]: `${piece.sway}px`,
      }}
    >
      <SeasonGlyph season={season} hue={piece.hue} />
    </span>
  );
}

function SeasonGlyph({ season, hue }: { season: Season; hue: number }) {
  // F-3 — apply a watercolor wash filter to season particles so petals /
  // leaves / snow read as a soft paper sketch rather than crisp shapes.
  const wash = `url(#${DIORAMA_DEFS.watercolor})`;
  if (season === "winter") {
    return (
      <svg width={6} height={6} viewBox="0 0 6 6" aria-hidden>
        <circle cx={3} cy={3} r={2.6} fill="#FFFFFF" opacity={0.95} filter={wash} />
      </svg>
    );
  }
  if (season === "autumn") {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
        <path
          d="M5 1 C 7 2 9 3 9 5 C 9 7 7 8 5 9 C 3 8 1 7 1 5 C 1 3 3 2 5 1 Z"
          fill={`hsl(${hue}, 80%, 50%)`}
          opacity={0.85}
          filter={wash}
        />
        <line x1="5" y1="1" x2="5" y2="9" stroke="#5D3A1F" strokeWidth="0.4" />
      </svg>
    );
  }
  // spring petal
  return (
    <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden>
      <ellipse cx={4} cy={4} rx={3.5} ry={2} fill={`hsl(${hue}, 80%, 78%)`} opacity={0.9} filter={wash} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Event particle bursts — ember / ghost / star / checkmark
// ---------------------------------------------------------------------------

export function EmberBurst({ count = 8 }: { count?: number }) {
  const pieces = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => {
      const k = (i * 211 + 3) >>> 0;
      return {
        id: i,
        x: 10 + ((k * 7) % 80),
        delay: -((k % 20) / 10),
        dur: 1.6 + ((k % 20) / 10),
        hue: 10 + (k % 24),
      };
    });
  }, [count]);
  return (
    <span
      aria-hidden
      className="absolute inset-0 pointer-events-none overflow-hidden"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.x}%`,
            bottom: 0,
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: `hsl(${p.hue}, 90%, 60%)`,
            boxShadow: `0 0 4px hsla(${p.hue}, 95%, 60%, 0.85)`,
            animation: `relayHamletEmber ${p.dur.toFixed(2)}s ease-out ${p.delay.toFixed(2)}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function GhostFloat() {
  return (
    <span
      aria-hidden
      className="absolute inset-0 pointer-events-none overflow-hidden"
    >
      <svg
        width={22}
        height={28}
        viewBox="0 0 22 28"
        className="absolute"
        style={{
          left: "50%",
          top: "10%",
          marginLeft: -11,
          animation: "relayHamletGhost 4s ease-in-out infinite",
        }}
      >
        <path
          d="M3 12 Q 3 3 11 3 Q 19 3 19 12 L 19 22 L 16 25 L 13 22 L 11 25 L 9 22 L 6 25 L 3 22 Z"
          fill="rgba(255,255,255,0.7)"
          stroke="rgba(200,200,220,0.55)"
          strokeWidth="0.8"
        />
        <circle cx={8} cy={11} r={1.2} fill="#1F1F2A" />
        <circle cx={14} cy={11} r={1.2} fill="#1F1F2A" />
      </svg>
    </span>
  );
}

export function StarBurst({ count = 6 }: { count?: number }) {
  const pieces = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const dist = 18 + ((i * 7) % 8);
      return {
        id: i,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        delay: -(i * 0.12),
      };
    });
  }, [count]);
  return (
    <span
      aria-hidden
      className="absolute inset-0 pointer-events-none overflow-hidden"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            left: "50%",
            top: "40%",
            width: 8,
            height: 8,
            marginLeft: -4,
            marginTop: -4,
            color: "#FFC857",
            ["--relay-burst-dx" as unknown as string]: `${p.dx}px`,
            ["--relay-burst-dy" as unknown as string]: `${p.dy}px`,
            animation: `relayHamletStarBurst 1.8s ease-out ${p.delay.toFixed(2)}s infinite`,
          }}
        >
          <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden>
            <polygon
              points="4,0 5,3 8,3 5.5,5 6.5,8 4,6 1.5,8 2.5,5 0,3 3,3"
              fill="#FFC857"
              stroke="#A6781E"
              strokeWidth="0.3"
            />
          </svg>
        </span>
      ))}
    </span>
  );
}

export function CheckmarkBloom() {
  return (
    <span
      aria-hidden
      className="absolute inset-0 pointer-events-none overflow-hidden"
    >
      <svg
        width={28}
        height={28}
        viewBox="0 0 28 28"
        className="absolute"
        style={{
          left: "50%",
          top: "40%",
          marginLeft: -14,
          marginTop: -14,
          animation: "relayHamletCheckBloom 1.6s ease-out infinite",
        }}
      >
        <circle cx={14} cy={14} r={12} fill="hsla(140, 60%, 45%, 0.35)" />
        <path
          d="M7 14 L 12 19 L 21 9"
          stroke="#3FA250"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Event burst dispatcher — pick the right effect by kind
// ---------------------------------------------------------------------------

export function EventBurst({ kind }: { kind: string }) {
  switch (kind) {
    case "fire":
      return <EmberBurst />;
    case "reaper":
      return <GhostFloat />;
    case "achievement":
      return <StarBurst />;
    case "quest":
      return <CheckmarkBloom />;
    case "birthday":
    case "wedding":
    case "baby":
    case "celebrate":
      // The existing ConfettiBurst covers these — caller can render it.
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helper — deterministic seed for a card collection
// ---------------------------------------------------------------------------

export function seedFromCards(cards: readonly SimCardModel[]): number {
  let s = 0;
  for (const c of cards) s = (s + hashStringToInt(c.key)) >>> 0;
  return s || 1;
}

// ---------------------------------------------------------------------------
// Shared particle keyframes — inject once per consumer view via:
//   <style>{PARTICLE_CSS}</style>
// ---------------------------------------------------------------------------

export const PARTICLE_CSS = `
@keyframes relayHamletWalkPath {
  0%   { transform: translate(0, 0); }
  100% { transform: translate(var(--relay-walk-distance, 600px), 0); }
}
@keyframes relayHamletWalkBob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1.5px); }
}
@keyframes relayHamletRain {
  0%   { transform: translate(0, 0); opacity: 0; }
  10%  { opacity: 0.85; }
  100% { transform: translate(-4px, var(--relay-rain-distance, 200px)); opacity: 0; }
}
@keyframes relayHamletLightning {
  0%, 92%, 100% { opacity: 0; }
  93%           { opacity: 0.85; }
  95%           { opacity: 0; }
  96%           { opacity: 0.7; }
  98%           { opacity: 0; }
}
@keyframes relayHamletPetal {
  0%   { transform: translate(0, 0) rotate(0deg); opacity: 0; }
  10%  { opacity: 0.9; }
  100% { transform: translate(var(--relay-fall-sway, 12px), var(--relay-fall-distance, 220px)) rotate(360deg); opacity: 0; }
}
@keyframes relayHamletLeaf {
  0%   { transform: translate(0, 0) rotate(-20deg); opacity: 0; }
  10%  { opacity: 0.85; }
  50%  { transform: translate(var(--relay-fall-sway, 14px), calc(var(--relay-fall-distance, 220px) * 0.5)) rotate(120deg); }
  100% { transform: translate(calc(var(--relay-fall-sway, 14px) * -1), var(--relay-fall-distance, 220px)) rotate(360deg); opacity: 0; }
}
@keyframes relayHamletSnow {
  0%   { transform: translate(0, 0); opacity: 0; }
  10%  { opacity: 0.95; }
  100% { transform: translate(var(--relay-fall-sway, 8px), var(--relay-fall-distance, 220px)); opacity: 0; }
}
@keyframes relayHamletEmber {
  0%   { transform: translate(0, 0) scale(0.6); opacity: 0; }
  20%  { opacity: 1; }
  100% { transform: translate(0, -30px) scale(0.2); opacity: 0; }
}
@keyframes relayHamletGhost {
  0%, 100% { transform: translate(0, 0); opacity: 0.55; }
  50%      { transform: translate(4px, -10px); opacity: 0.85; }
}
@keyframes relayHamletStarBurst {
  0%   { transform: translate(0, 0) scale(0.4); opacity: 0; }
  20%  { opacity: 1; }
  100% { transform: translate(var(--relay-burst-dx, 0), var(--relay-burst-dy, 0)) scale(1.1); opacity: 0; }
}
@keyframes relayHamletCheckBloom {
  0%   { transform: scale(0.4); opacity: 0; }
  30%  { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}
@keyframes relayHamletWindowGlow {
  0%, 100% { fill-opacity: 0.85; filter: drop-shadow(0 0 1px currentColor); }
  50%      { fill-opacity: 1;    filter: drop-shadow(0 0 3px currentColor); }
}
@media (prefers-reduced-motion: reduce) {
  /* Stops every Hamlet particle / walker / weather animation when the
     OS-level "reduce motion" preference is on. */
  [style*="relayHamletWalkPath"],
  [style*="relayHamletWalkBob"],
  [style*="relayHamletRain"],
  [style*="relayHamletLightning"],
  [style*="relayHamletPetal"],
  [style*="relayHamletLeaf"],
  [style*="relayHamletSnow"],
  [style*="relayHamletEmber"],
  [style*="relayHamletGhost"],
  [style*="relayHamletStarBurst"],
  [style*="relayHamletCheckBloom"],
  [style*="relayHamletWindowGlow"] {
    animation: none !important;
  }
}
${HAMLET_AVATAR_CSS}
`;
