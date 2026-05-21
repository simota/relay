"use client";

// Fleet Hamlet — Street props SVG layer.
//
// Renders the StreetProp[] picked by `_lib/fleet-hamlet-street-props.ts` as
// a single absolutely-positioned layer behind the houses (z between road and
// house). Each prop is a small pure-SVG sprite — utility pole, billboard,
// bench, vending machine, bus stop, trash can, traffic sign, plus seasonal
// addons (puddle / fallen leaves / snow pile).
//
// Visual language follows the existing Hamlet decor: 0.6-1.0px strokes,
// drop-shadows via subtle ellipses, two-tone shading via stacked rects.
// Inspired by Codrops' Generative CSS Worlds 2:1 dimetric block placement,
// but rendered as flat 2D SVG so we keep the existing isometric-ish vibe.

import type { StreetProp, StreetPropKind } from "../_lib/fleet-hamlet-street-props";

interface StreetPropsLayerProps {
  props: readonly StreetProp[];
  cellW: number;
  cellH: number;
  totalW: number;
  totalH: number;
  /** Lit/dusk flag — controls billboard / vending neon. */
  litLamps?: boolean;
}

export function StreetPropsLayer({
  props,
  cellW,
  cellH,
  totalW,
  totalH,
  litLamps = false,
}: StreetPropsLayerProps) {
  if (props.length === 0) return null;
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{ width: totalW, height: totalH }}
    >
      {props.map((p) => {
        const left = p.col * cellW + p.offsetX * cellW;
        const top = p.row * cellH + p.offsetY * cellH;
        return (
          <span
            key={p.id}
            className="absolute"
            style={{
              left,
              top,
              transform: "translate(-50%, -100%)",
              // Z-order — puddles / fallen leaves sit on the ground (behind
              // everything else); poles and billboards are tall and should
              // still feel like backdrop, so we keep them under the houses.
              opacity: p.kind === "puddle" || p.kind === "fallen-leaves" ? 0.85 : 0.95,
            }}
          >
            <StreetPropSvg prop={p} cellH={cellH} litLamps={litLamps} />
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind sprite dispatcher
// ---------------------------------------------------------------------------

function StreetPropSvg({
  prop,
  cellH,
  litLamps,
}: {
  prop: StreetProp;
  cellH: number;
  litLamps: boolean;
}) {
  switch (prop.kind) {
    case "utility-pole":
      return <UtilityPoleSvg height={Math.max(48, cellH * 0.6)} />;
    case "billboard":
      return <BillboardSvg label={prop.label ?? "OPEN"} hue={prop.hue ?? 35} lit={litLamps} />;
    case "bench":
      return <BenchSvg />;
    case "vending":
      return <VendingMachineSvg hue={prop.hue ?? 200} lit={litLamps} />;
    case "bus-stop":
      return <BusStopSvg />;
    case "trash":
      return <TrashCanSvg />;
    case "traffic-sign":
      return <TrafficSignSvg label={prop.label ?? "STOP"} />;
    case "puddle":
      return <PuddleSvg />;
    case "fallen-leaves":
      return <FallenLeavesSvg />;
    case "snow-pile":
      return <SnowPileSvg />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// UtilityPole — slim wooden post with crossbar + cables drifting offscreen
// ---------------------------------------------------------------------------

function UtilityPoleSvg({ height }: { height: number }) {
  const H = Math.max(40, Math.floor(height));
  const W = 18;
  return (
    <svg width={W} height={H + 4} viewBox={`0 0 ${W} ${H + 4}`} aria-hidden overflow="visible">
      {/* Ground shadow */}
      <ellipse cx={W / 2} cy={H + 2} rx={5} ry={1.4} fill="rgba(0,0,0,0.32)" />
      {/* Post */}
      <rect x={W / 2 - 0.8} y={6} width={1.6} height={H - 6} fill="#5D3A1F" />
      <rect x={W / 2 - 0.8} y={6} width={0.6} height={H - 6} fill="#7A5232" opacity={0.85} />
      {/* Crossbar */}
      <rect x={1} y={10} width={W - 2} height={1.4} fill="#3A2310" />
      <rect x={1} y={10} width={W - 2} height={0.5} fill="#5D3A1F" opacity={0.8} />
      {/* Insulators — small white cylinders */}
      <rect x={2.5} y={8.4} width={1.6} height={2.2} fill="#E0DBC8" stroke="#3A2310" strokeWidth={0.3} />
      <rect x={W - 4.1} y={8.4} width={1.6} height={2.2} fill="#E0DBC8" stroke="#3A2310" strokeWidth={0.3} />
      <rect x={W / 2 - 0.8} y={6.4} width={1.6} height={1.8} fill="#E0DBC8" stroke="#3A2310" strokeWidth={0.3} />
      {/* Cables — sag off both sides; rendered with overflow:visible so they
          extend beyond the SVG box and read as continuous lines across the
          street. */}
      <path d={`M 3.3 9.5 Q -30 14, -80 16`} stroke="#1F140A" strokeWidth={0.6} fill="none" opacity={0.6} />
      <path d={`M ${W - 3.3} 9.5 Q ${W + 30} 14, ${W + 80} 16`} stroke="#1F140A" strokeWidth={0.6} fill="none" opacity={0.6} />
      <path d={`M 3.3 11.5 Q -30 18, -80 22`} stroke="#1F140A" strokeWidth={0.5} fill="none" opacity={0.45} />
      <path d={`M ${W - 3.3} 11.5 Q ${W + 30} 18, ${W + 80} 22`} stroke="#1F140A" strokeWidth={0.5} fill="none" opacity={0.45} />
      {/* Transformer barrel */}
      <rect x={W / 2 - 2.2} y={H * 0.3} width={4.4} height={6} rx={1} fill="#3A3A3A" stroke="#1F1F1F" strokeWidth={0.4} />
      <rect x={W / 2 - 2.2} y={H * 0.3} width={1.4} height={6} rx={1} fill="#5A5A5A" opacity={0.7} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Billboard — square sign on two posts with text
// ---------------------------------------------------------------------------

function BillboardSvg({ label, hue, lit }: { label: string; hue: number; lit: boolean }) {
  const W = 42;
  const H = 36;
  const boardFill = `hsl(${hue}, 60%, 70%)`;
  const boardShadow = `hsl(${hue}, 55%, 50%)`;
  return (
    <svg width={W} height={H + 4} viewBox={`0 0 ${W} ${H + 4}`} aria-hidden>
      {/* Ground shadow */}
      <ellipse cx={W / 2} cy={H + 2} rx={W * 0.35} ry={1.6} fill="rgba(0,0,0,0.3)" />
      {/* Posts */}
      <rect x={W * 0.25} y={H * 0.55} width={1.6} height={H * 0.45} fill="#3A2310" />
      <rect x={W * 0.7} y={H * 0.55} width={1.6} height={H * 0.45} fill="#3A2310" />
      {/* Board shadow underlay */}
      <rect x={2} y={3} width={W - 4} height={H * 0.55} rx={1.2} fill={boardShadow} />
      {/* Board face */}
      <rect x={2} y={2} width={W - 4} height={H * 0.55} rx={1.2} fill={boardFill} stroke="#3A2310" strokeWidth={0.7} />
      {/* Board highlight band */}
      <rect x={2.6} y={2.6} width={W - 5.2} height={H * 0.12} rx={1} fill={`hsl(${hue}, 70%, 85%)`} opacity={0.7} />
      {/* Frame inner border */}
      <rect x={3.4} y={3.4} width={W - 6.8} height={H * 0.55 - 2.8} rx={0.8} fill="none" stroke="#5C3D1F" strokeWidth={0.35} opacity={0.6} />
      {/* Text */}
      <text
        x={W / 2}
        y={H * 0.36}
        textAnchor="middle"
        fontSize={H * 0.18}
        fontFamily="ui-monospace, monospace"
        fontWeight="700"
        fill="#1F140A"
        letterSpacing="0.4"
      >
        {label}
      </text>
      {/* Lit glow when dusk/night */}
      {lit && (
        <rect
          x={2}
          y={2}
          width={W - 4}
          height={H * 0.55}
          rx={1.2}
          fill="hsl(48, 95%, 65%)"
          opacity={0.18}
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Bench — slatted wood bench with two end legs
// ---------------------------------------------------------------------------

function BenchSvg() {
  const W = 36;
  const H = 14;
  return (
    <svg width={W} height={H + 2} viewBox={`0 0 ${W} ${H + 2}`} aria-hidden>
      {/* Ground shadow */}
      <ellipse cx={W / 2} cy={H + 1} rx={W * 0.42} ry={1.4} fill="rgba(0,0,0,0.32)" />
      {/* Backrest */}
      <rect x={4} y={1} width={W - 8} height={2.2} rx={0.6} fill="#7A5232" />
      <rect x={4} y={1} width={W - 8} height={0.8} rx={0.6} fill="#A5784C" opacity={0.85} />
      {/* Slats — seat */}
      <rect x={3} y={5} width={W - 6} height={2.2} rx={0.6} fill="#8B5E36" />
      <rect x={3} y={7.6} width={W - 6} height={2.2} rx={0.6} fill="#7A5232" />
      {/* Slat highlight */}
      <rect x={3.4} y={5.4} width={W - 6.8} height={0.6} fill="#B98F58" opacity={0.7} />
      {/* Legs */}
      <rect x={4} y={9.8} width={2.2} height={H - 9.8} fill="#3A2310" />
      <rect x={W - 6.2} y={9.8} width={2.2} height={H - 9.8} fill="#3A2310" />
      {/* Leg shadows on the right side */}
      <rect x={5.2} y={9.8} width={1} height={H - 9.8} fill="#1F140A" opacity={0.7} />
      <rect x={W - 5.2} y={9.8} width={1} height={H - 9.8} fill="#1F140A" opacity={0.7} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// VendingMachine — tall slim box with button grid + bottle row
// ---------------------------------------------------------------------------

function VendingMachineSvg({ hue, lit }: { hue: number; lit: boolean }) {
  const W = 18;
  const H = 34;
  const body = `hsl(${hue}, 55%, 45%)`;
  const bodyHi = `hsl(${hue}, 60%, 65%)`;
  const bodyShadow = `hsl(${hue}, 60%, 30%)`;
  return (
    <svg width={W} height={H + 2} viewBox={`0 0 ${W} ${H + 2}`} aria-hidden>
      {/* Ground shadow */}
      <ellipse cx={W / 2} cy={H + 1} rx={W * 0.5} ry={1.4} fill="rgba(0,0,0,0.34)" />
      {/* Body */}
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={1.2} fill={body} stroke="#1F140A" strokeWidth={0.6} />
      {/* Body highlight stripe on left */}
      <rect x={1} y={1} width={3} height={H - 2} rx={1.2} fill={bodyHi} opacity={0.6} />
      {/* Body shadow stripe on right */}
      <rect x={W - 4} y={1} width={3} height={H - 2} rx={1.2} fill={bodyShadow} opacity={0.55} />
      {/* Bottle display window — upper 50% */}
      <rect x={2.5} y={3} width={W - 5} height={H * 0.42} fill={lit ? "hsl(48, 90%, 80%)" : "hsl(200, 25%, 75%)"} stroke="#1F140A" strokeWidth={0.4} />
      {/* Bottles inside — 3 cols × 2 rows */}
      <g>
        {[0, 1, 2].map((c) =>
          [0, 1].map((r) => {
            const bx = 3.4 + c * 3.4;
            const by = 4 + r * (H * 0.16);
            const bh = H * 0.13;
            const bottleHue = (hue + 40 + c * 60 + r * 30) % 360;
            return (
              <g key={`b-${c}-${r}`}>
                <rect x={bx} y={by} width={2.4} height={bh} rx={0.6} fill={`hsl(${bottleHue}, 80%, 60%)`} />
                <rect x={bx} y={by} width={0.8} height={bh} rx={0.4} fill={`hsl(${bottleHue}, 80%, 80%)`} opacity={0.85} />
              </g>
            );
          }),
        )}
      </g>
      {/* Button grid — lower right */}
      <g fill="#1F140A">
        {[0, 1, 2, 3].map((i) => (
          <rect key={`btn-${i}`} x={W - 5} y={H * 0.55 + i * 2.2} width={3} height={1.6} rx={0.4} fill="#3A3A3A" />
        ))}
      </g>
      {/* Coin slot + dispenser */}
      <rect x={3} y={H * 0.55} width={6} height={1.4} fill="#1F140A" />
      <rect x={3} y={H * 0.78} width={W - 6} height={4} rx={0.6} fill="#1F140A" />
      <rect x={3.6} y={H * 0.78 + 0.4} width={W - 7.2} height={3.2} rx={0.4} fill="#3A3A3A" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// BusStop — pole + flag sign + simple shelter roof + small bench
// ---------------------------------------------------------------------------

function BusStopSvg() {
  const W = 32;
  const H = 44;
  return (
    <svg width={W} height={H + 2} viewBox={`0 0 ${W} ${H + 2}`} aria-hidden>
      {/* Ground shadow */}
      <ellipse cx={W / 2} cy={H + 1} rx={W * 0.42} ry={1.6} fill="rgba(0,0,0,0.32)" />
      {/* Shelter roof */}
      <rect x={2} y={6} width={W - 4} height={3} rx={0.6} fill="#3F8A6E" />
      <rect x={2} y={6} width={W - 4} height={1} fill="#5EAB8E" opacity={0.85} />
      {/* Shelter back pane */}
      <rect x={4} y={9} width={W - 8} height={H * 0.45} fill="hsl(200, 25%, 78%)" stroke="#3A2310" strokeWidth={0.4} opacity={0.7} />
      {/* Side posts */}
      <rect x={3} y={9} width={1.4} height={H - 12} fill="#2A2A2A" />
      <rect x={W - 4.4} y={9} width={1.4} height={H - 12} fill="#2A2A2A" />
      {/* Bench inside shelter */}
      <rect x={5} y={H * 0.58} width={W - 10} height={2} rx={0.4} fill="#7A5232" />
      <rect x={5} y={H * 0.65} width={W - 10} height={1.4} fill="#5D3A1F" />
      {/* Sign post + flag */}
      <rect x={W * 0.18 - 0.8} y={2} width={1.6} height={H - 6} fill="#2A2A2A" />
      <rect x={W * 0.06} y={2} width={9} height={5} rx={0.6} fill="#C13B2C" />
      <rect x={W * 0.06} y={2} width={9} height={1.6} rx={0.6} fill="#E25E4D" opacity={0.85} />
      <text
        x={W * 0.18}
        y={5.5}
        textAnchor="middle"
        fontSize={3.2}
        fontFamily="ui-monospace, monospace"
        fontWeight="700"
        fill="#FFFDF0"
      >
        BUS
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// TrashCan — short cylinder with lid + handle
// ---------------------------------------------------------------------------

function TrashCanSvg() {
  const W = 14;
  const H = 18;
  return (
    <svg width={W} height={H + 2} viewBox={`0 0 ${W} ${H + 2}`} aria-hidden>
      {/* Ground shadow */}
      <ellipse cx={W / 2} cy={H + 1} rx={W * 0.45} ry={1.2} fill="rgba(0,0,0,0.32)" />
      {/* Body */}
      <rect x={2} y={4} width={W - 4} height={H - 5} rx={1.2} fill="#3A6F3A" stroke="#1F140A" strokeWidth={0.5} />
      {/* Body highlight */}
      <rect x={2} y={4} width={2.2} height={H - 5} rx={1.2} fill="#5C9A5C" opacity={0.7} />
      {/* Body band */}
      <rect x={2} y={H * 0.5} width={W - 4} height={1.2} fill="#1F140A" opacity={0.55} />
      {/* Lid */}
      <ellipse cx={W / 2} cy={3.6} rx={W * 0.45} ry={1.8} fill="#2A4A2A" stroke="#1F140A" strokeWidth={0.5} />
      {/* Lid handle */}
      <rect x={W / 2 - 1.4} y={2} width={2.8} height={1.4} rx={0.6} fill="#1F140A" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// TrafficSign — octagon STOP or arrow on a thin pole
// ---------------------------------------------------------------------------

function TrafficSignSvg({ label }: { label: string }) {
  const W = 16;
  const H = 36;
  const isStop = label === "STOP";
  const fill = isStop ? "#C13B2C" : "#E5C100";
  const hi = isStop ? "#E25E4D" : "#F5E25E";
  return (
    <svg width={W} height={H + 2} viewBox={`0 0 ${W} ${H + 2}`} aria-hidden>
      {/* Ground shadow */}
      <ellipse cx={W / 2} cy={H + 1} rx={3} ry={1.2} fill="rgba(0,0,0,0.3)" />
      {/* Pole */}
      <rect x={W / 2 - 0.8} y={H * 0.32} width={1.6} height={H * 0.68} fill="#2A2A2A" />
      {/* Sign */}
      {isStop ? (
        <polygon
          points={`${W * 0.2},2 ${W * 0.8},2 ${W - 1},${H * 0.13} ${W - 1},${H * 0.25} ${W * 0.8},${H * 0.36} ${W * 0.2},${H * 0.36} 1,${H * 0.25} 1,${H * 0.13}`}
          fill={fill}
          stroke="#1F140A"
          strokeWidth={0.5}
        />
      ) : (
        <rect x={1} y={2} width={W - 2} height={H * 0.34} rx={0.6} fill={fill} stroke="#1F140A" strokeWidth={0.5} />
      )}
      {/* Highlight */}
      <rect x={2.5} y={3.4} width={W - 5} height={2} fill={hi} opacity={0.6} />
      {/* Label */}
      <text
        x={W / 2}
        y={H * 0.23}
        textAnchor="middle"
        fontSize={isStop ? 4.4 : 6}
        fontFamily="ui-monospace, monospace"
        fontWeight="700"
        fill="#FFFDF0"
      >
        {label}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Puddle — flat ellipse with reflection highlight
// ---------------------------------------------------------------------------

function PuddleSvg() {
  return (
    <svg width={28} height={10} viewBox="0 0 28 10" aria-hidden>
      <ellipse cx={14} cy={6} rx={13} ry={3.4} fill="hsl(210, 45%, 35%)" opacity={0.6} />
      <ellipse cx={14} cy={5.4} rx={12} ry={3} fill="hsl(210, 55%, 50%)" opacity={0.55} />
      {/* Reflection highlight */}
      <ellipse cx={10} cy={4.6} rx={4} ry={0.8} fill="hsl(210, 70%, 85%)" opacity={0.7} />
      <ellipse cx={18} cy={5.6} rx={2} ry={0.4} fill="hsl(210, 70%, 90%)" opacity={0.55} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// FallenLeaves — small cluster of overlapping leaf shapes on the ground
// ---------------------------------------------------------------------------

function FallenLeavesSvg() {
  return (
    <svg width={26} height={12} viewBox="0 0 26 12" aria-hidden>
      <g opacity={0.85}>
        <ellipse cx={6} cy={9} rx={3.2} ry={1.6} fill="hsl(28, 70%, 50%)" transform="rotate(-12 6 9)" />
        <ellipse cx={12} cy={8} rx={3.6} ry={1.8} fill="hsl(18, 75%, 48%)" transform="rotate(8 12 8)" />
        <ellipse cx={18} cy={9.5} rx={3.4} ry={1.6} fill="hsl(38, 80%, 55%)" transform="rotate(-4 18 9.5)" />
        <ellipse cx={22} cy={7.5} rx={2.8} ry={1.4} fill="hsl(12, 70%, 42%)" transform="rotate(16 22 7.5)" />
        <ellipse cx={9} cy={6} rx={2.6} ry={1.3} fill="hsl(42, 80%, 58%)" transform="rotate(20 9 6)" />
      </g>
      {/* Veins */}
      <g stroke="hsl(15, 50%, 25%)" strokeWidth={0.3} opacity={0.6}>
        <line x1={4} y1={9} x2={8} y2={9.3} />
        <line x1={10} y1={8} x2={14} y2={8.1} />
        <line x1={16} y1={9.5} x2={20} y2={9.5} />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SnowPile — soft white mound for winter
// ---------------------------------------------------------------------------

function SnowPileSvg() {
  return (
    <svg width={22} height={10} viewBox="0 0 22 10" aria-hidden>
      <ellipse cx={11} cy={9} rx={10} ry={2.4} fill="rgba(0,0,0,0.25)" />
      <ellipse cx={11} cy={7.5} rx={10} ry={3.2} fill="#F5F8FA" />
      <ellipse cx={8} cy={6.5} rx={4} ry={1.2} fill="#FFFFFF" opacity={0.95} />
      <ellipse cx={15} cy={7} rx={3} ry={0.9} fill="#FFFFFF" opacity={0.85} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Public re-exports — kept so tests / future Storybook stories can pull just
// the sprite they need.
// ---------------------------------------------------------------------------

export const STREET_PROP_KINDS: readonly StreetPropKind[] = [
  "utility-pole",
  "billboard",
  "bench",
  "vending",
  "bus-stop",
  "trash",
  "traffic-sign",
  "puddle",
  "fallen-leaves",
  "snow-pile",
];
