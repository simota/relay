"use client";

// Fleet Hamlet — Room Scene R6 F2: window-through-relationships overlay.
//
// Renders inside the existing RoomWindow's clip rect: a distant parent
// house on a far hill, 1-2 child silhouettes "playing" on the sill, and
// (optionally) a single best-friend silhouette walking past every 14s.
//
// The component owns no state; it just paints pure SVG with CSS-driven
// animation. Coordinates are absolute against the parent RoomWindow's
// box (windowBox prop), so the parent doesn't need to translate this
// component itself.

import type { WindowScene } from "../_lib/fleet-hamlet-room-window";

export interface WindowBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowSceneViewProps {
  scene: WindowScene;
  windowBox: WindowBox;
}

export function WindowSceneView({ scene, windowBox }: WindowSceneViewProps) {
  const { x, y, w, h } = windowBox;
  const hasAny =
    scene.parentHouse ||
    scene.playingChildren.length > 0 ||
    scene.passingFriend;
  if (!hasAny) return null;

  // Single clip so silhouettes don't bleed out past the window frame.
  const clipId = "relay-room-window-scene-clip";
  return (
    <g aria-hidden>
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* Far hills — soft silhouette so the parent house has somewhere
            to rest. Kept very low-contrast to not fight the sky gradient. */}
        <path
          d={`M ${x} ${y + h * 0.65}
              Q ${x + w * 0.25} ${y + h * 0.55} ${x + w * 0.5} ${y + h * 0.62}
              T ${x + w} ${y + h * 0.62}
              L ${x + w} ${y + h}
              L ${x} ${y + h} Z`}
          fill="rgba(60, 90, 80, 0.32)"
        />
        {scene.parentHouse && (
          <DistantHouseSvg
            hue={scene.parentHouse.hue}
            cx={x + w * 0.78}
            cy={y + h * 0.6}
          />
        )}
        {scene.playingChildren.map((child, i) => (
          <PlayingChildSvg
            key={i}
            hue={child.hue}
            cx={x + w * (0.18 + i * 0.18)}
            cy={y + h * 0.82}
            delay={i * 0.7}
          />
        ))}
        {scene.passingFriend && (
          <PassingFriendSvg
            hue={scene.passingFriend.hue}
            boxX={x}
            boxY={y + h * 0.5}
            boxW={w}
          />
        )}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Distant parent house — tiny gable roof + body, hue-coloured roof.
// ---------------------------------------------------------------------------

function DistantHouseSvg({
  hue,
  cx,
  cy,
}: {
  hue: number;
  cx: number;
  cy: number;
}) {
  const roof = `hsl(${hue}, 55%, 42%)`;
  const wall = `hsl(${hue}, 18%, 78%)`;
  const W = 14;
  const H = 10;
  return (
    <g>
      {/* shadow on the hill */}
      <ellipse cx={cx} cy={cy + H * 0.55} rx={W * 0.55} ry={1.2} fill="rgba(0,0,0,0.25)" />
      {/* body */}
      <rect
        x={cx - W / 2}
        y={cy - H * 0.4}
        width={W}
        height={H * 0.8}
        fill={wall}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={0.4}
      />
      {/* roof */}
      <polygon
        points={`${cx - W / 2 - 1},${cy - H * 0.4} ${cx + W / 2 + 1},${cy - H * 0.4} ${cx},${cy - H}`}
        fill={roof}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={0.4}
      />
      {/* tiny window glow */}
      <rect
        x={cx - 1.4}
        y={cy - H * 0.15}
        width={2.8}
        height={2.6}
        fill="#FFE9A5"
        opacity={0.85}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Playing child — micro avatar that bobs left-right.
// ---------------------------------------------------------------------------

function PlayingChildSvg({
  hue,
  cx,
  cy,
  delay,
}: {
  hue: number;
  cx: number;
  cy: number;
  delay: number;
}) {
  const skin = "hsl(30, 50%, 75%)";
  const shirt = `hsl(${hue}, 55%, 52%)`;
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <g
        style={{
          animation: `relayHamletChildPlay 2s ease-in-out ${delay}s infinite`,
        }}
      >
        {/* legs */}
        <rect x={-1.4} y={-3.5} width={1.1} height={3.5} fill="#3A2C24" />
        <rect x={0.3} y={-3.5} width={1.1} height={3.5} fill="#3A2C24" />
        {/* torso */}
        <rect x={-2.5} y={-7.5} width={5} height={4.2} fill={shirt} rx={1} />
        {/* head */}
        <circle cx={0} cy={-9.5} r={2.4} fill={skin} stroke="rgba(0,0,0,0.35)" strokeWidth={0.3} />
        {/* tiny eye dots */}
        <circle cx={-0.7} cy={-9.7} r={0.3} fill="#1a1a1a" />
        <circle cx={0.7} cy={-9.7} r={0.3} fill="#1a1a1a" />
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Passing friend — silhouette walking across the window.
// ---------------------------------------------------------------------------

function PassingFriendSvg({
  hue,
  boxX,
  boxY,
  boxW,
}: {
  hue: number;
  boxX: number;
  boxY: number;
  boxW: number;
}) {
  const shirt = `hsl(${hue}, 50%, 45%)`;
  const headSkin = `hsl(${hue}, 25%, 55%)`;
  // The walking distance covers boxW + 2*figure padding so the silhouette
  // exits the window before the loop snaps back.
  const start = boxX - 14;
  const sweep = boxW + 28;
  // Two nested groups so the SVG transform (positioning) and the CSS
  // animation transform (translation over time) don't fight each other.
  return (
    <g transform={`translate(${start}, ${boxY})`}>
      <g
        style={{
          animation: "relayHamletPassingFriend 14s linear infinite",
          ["--relay-hamlet-friend-sweep" as string]: `${sweep}px`,
        }}
      >
        {/* legs */}
        <rect x={-1.6} y={4} width={1.2} height={6} fill="#1f1d2a" />
        <rect x={0.4} y={4} width={1.2} height={6} fill="#1f1d2a" />
        {/* torso */}
        <rect x={-3} y={-2} width={6} height={7} fill={shirt} opacity={0.85} rx={1} />
        {/* head */}
        <circle cx={0} cy={-4.5} r={2.6} fill={headSkin} opacity={0.85} />
      </g>
    </g>
  );
}
