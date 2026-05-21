"use client";

// Fleet Hamlet — avatar accessory primitives (Open Peeps-inspired).
//
// Pure SVG groups rendered inside the same `[-radius..+radius] x
// [-radius..+radius]` frame as `HeadFace`, and inside the BodyTorso local
// coordinate space (origin = neck base, height passed in). All accessory
// glyphs share the soft hand-drawn look of the existing village (line
// weight 0.5-0.8 relative to radius, rounded caps, warm Hamlet palette)
// so the Open Peeps inspiration reads consistently across the family.
//
// NOTE: no Open Peeps SVG files are imported — this is a style influence
// only, every path here is hand-authored.

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Kinds — keep these string-unions so deriveAccessories() can stay pure.
// ---------------------------------------------------------------------------

export type GlassesKind = "round" | "square" | "sunglasses" | "none";
export type MustacheKind = "handlebar" | "chevron" | "pencil" | "none";
export type BeardKind = "full" | "goatee" | "stubble" | "none";
export type EarringKind = "left" | "right" | "both" | "none";
export type ScarfKind = "striped" | "solid" | "knit" | "none";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StrokeWrap({ children }: { children: ReactNode }) {
  // Common stroke styling — Hamlet's hand-drawn aesthetic.
  return <g strokeLinecap="round" strokeLinejoin="round">{children}</g>;
}

// ---------------------------------------------------------------------------
// GlassesSvg — sits on the bridge of the nose (between the eyes).
//
// Eyes are drawn at y = -radius * 0.05 and x = ±radius * 0.4 in HeadFace,
// so the lens centers are placed exactly on those coordinates.
// ---------------------------------------------------------------------------

export function GlassesSvg({
  kind,
  radius,
}: {
  kind: Exclude<GlassesKind, "none">;
  radius: number;
}) {
  const r = radius;
  const ex = r * 0.4; // eye horizontal offset, must match HeadFace.Eyes
  const ey = -r * 0.05; // eye vertical position
  const sw = Math.max(0.7, r * 0.08);
  if (kind === "sunglasses") {
    return (
      <StrokeWrap>
        <g stroke="#1A1A1F" strokeWidth={sw} fill="rgba(28,28,38,0.92)">
          <rect
            x={-ex - r * 0.32}
            y={ey - r * 0.18}
            width={r * 0.62}
            height={r * 0.36}
            rx={r * 0.08}
          />
          <rect
            x={ex - r * 0.3}
            y={ey - r * 0.18}
            width={r * 0.62}
            height={r * 0.36}
            rx={r * 0.08}
          />
          {/* Bridge */}
          <line
            x1={-ex + r * 0.3}
            y1={ey}
            x2={ex - r * 0.3}
            y2={ey}
            stroke="#1A1A1F"
            strokeWidth={sw}
          />
          {/* Glint */}
          <line
            x1={-ex - r * 0.22}
            y1={ey - r * 0.1}
            x2={-ex - r * 0.06}
            y2={ey - r * 0.02}
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={sw * 0.7}
            fill="none"
          />
        </g>
      </StrokeWrap>
    );
  }
  if (kind === "square") {
    return (
      <StrokeWrap>
        <g stroke="#2A2018" strokeWidth={sw} fill="none">
          <rect
            x={-ex - r * 0.28}
            y={ey - r * 0.18}
            width={r * 0.56}
            height={r * 0.36}
            rx={r * 0.04}
          />
          <rect
            x={ex - r * 0.28}
            y={ey - r * 0.18}
            width={r * 0.56}
            height={r * 0.36}
            rx={r * 0.04}
          />
          <line x1={-ex + r * 0.28} y1={ey} x2={ex - r * 0.28} y2={ey} />
          {/* Temple stubs */}
          <line
            x1={-ex - r * 0.28}
            y1={ey - r * 0.08}
            x2={-ex - r * 0.4}
            y2={ey - r * 0.12}
          />
          <line
            x1={ex + r * 0.28}
            y1={ey - r * 0.08}
            x2={ex + r * 0.4}
            y2={ey - r * 0.12}
          />
        </g>
      </StrokeWrap>
    );
  }
  // round
  return (
    <StrokeWrap>
      <g stroke="#3A2A1F" strokeWidth={sw} fill="rgba(255,255,255,0.18)">
        <circle cx={-ex} cy={ey} r={r * 0.26} />
        <circle cx={ex} cy={ey} r={r * 0.26} />
        <line x1={-ex + r * 0.26} y1={ey} x2={ex - r * 0.26} y2={ey} stroke="#3A2A1F" />
        {/* Temple stubs */}
        <line
          x1={-ex - r * 0.26}
          y1={ey}
          x2={-ex - r * 0.42}
          y2={ey - r * 0.06}
        />
        <line
          x1={ex + r * 0.26}
          y1={ey}
          x2={ex + r * 0.42}
          y2={ey - r * 0.06}
        />
      </g>
    </StrokeWrap>
  );
}

// ---------------------------------------------------------------------------
// MustacheSvg — under the nose, just above the mouth line (y ≈ r*0.32).
// ---------------------------------------------------------------------------

export function MustacheSvg({
  kind,
  radius,
}: {
  kind: Exclude<MustacheKind, "none">;
  radius: number;
}) {
  const r = radius;
  const y = r * 0.3;
  if (kind === "handlebar") {
    // Curled-up tips on both sides.
    return (
      <StrokeWrap>
        <path
          d={`M ${-r * 0.4} ${y}
              Q ${-r * 0.22} ${y + r * 0.12} 0 ${y}
              Q ${r * 0.22} ${y + r * 0.12} ${r * 0.4} ${y}
              Q ${r * 0.52} ${y - r * 0.05} ${r * 0.5} ${y - r * 0.18}
              Q ${r * 0.36} ${y - r * 0.04} ${r * 0.34} ${y + r * 0.04}
              L ${-r * 0.34} ${y + r * 0.04}
              Q ${-r * 0.36} ${y - r * 0.04} ${-r * 0.5} ${y - r * 0.18}
              Q ${-r * 0.52} ${y - r * 0.05} ${-r * 0.4} ${y} Z`}
          fill="#2A1810"
          stroke="#1A0E08"
          strokeWidth={Math.max(0.4, r * 0.05)}
        />
      </StrokeWrap>
    );
  }
  if (kind === "chevron") {
    // Wide, thick straight bar with slight droop at edges.
    return (
      <StrokeWrap>
        <path
          d={`M ${-r * 0.42} ${y - r * 0.04}
              Q ${-r * 0.36} ${y + r * 0.12} ${-r * 0.18} ${y + r * 0.1}
              L ${r * 0.18} ${y + r * 0.1}
              Q ${r * 0.36} ${y + r * 0.12} ${r * 0.42} ${y - r * 0.04}
              Q ${r * 0.3} ${y - r * 0.02} ${r * 0.18} ${y - r * 0.02}
              L ${-r * 0.18} ${y - r * 0.02}
              Q ${-r * 0.3} ${y - r * 0.02} ${-r * 0.42} ${y - r * 0.04} Z`}
          fill="#3A2418"
        />
      </StrokeWrap>
    );
  }
  // pencil — thin under-nose line
  return (
    <line
      x1={-r * 0.22}
      y1={y + r * 0.02}
      x2={r * 0.22}
      y2={y + r * 0.02}
      stroke="#2A1810"
      strokeWidth={Math.max(0.6, r * 0.09)}
      strokeLinecap="round"
    />
  );
}

// ---------------------------------------------------------------------------
// BeardSvg — wraps the lower jaw / chin area. Drawn behind mouth.
// ---------------------------------------------------------------------------

export function BeardSvg({
  kind,
  radius,
}: {
  kind: Exclude<BeardKind, "none">;
  radius: number;
}) {
  const r = radius;
  if (kind === "full") {
    // Full jawline coverage from cheek to cheek.
    return (
      <path
        d={`M ${-r * 0.78} ${r * 0.18}
            Q ${-r * 0.82} ${r * 0.7} ${-r * 0.45} ${r * 0.95}
            Q 0 ${r * 1.08} ${r * 0.45} ${r * 0.95}
            Q ${r * 0.82} ${r * 0.7} ${r * 0.78} ${r * 0.18}
            Q ${r * 0.6} ${r * 0.35} ${r * 0.3} ${r * 0.36}
            Q 0 ${r * 0.42} ${-r * 0.3} ${r * 0.36}
            Q ${-r * 0.6} ${r * 0.35} ${-r * 0.78} ${r * 0.18} Z`}
        fill="#3A2418"
        opacity={0.92}
      />
    );
  }
  if (kind === "goatee") {
    // Small chin patch only.
    return (
      <path
        d={`M ${-r * 0.22} ${r * 0.52}
            Q 0 ${r * 1.0} ${r * 0.22} ${r * 0.52}
            Q ${r * 0.1} ${r * 0.6} 0 ${r * 0.58}
            Q ${-r * 0.1} ${r * 0.6} ${-r * 0.22} ${r * 0.52} Z`}
        fill="#3A2418"
        opacity={0.92}
      />
    );
  }
  // stubble — soft dotted texture along the jaw
  return (
    <g fill="#3A2418" opacity={0.42}>
      {[
        [-0.55, 0.55],
        [-0.4, 0.7],
        [-0.22, 0.82],
        [0, 0.86],
        [0.22, 0.82],
        [0.4, 0.7],
        [0.55, 0.55],
        [-0.28, 0.5],
        [0.28, 0.5],
      ].map(([dx, dy], i) => (
        <circle key={i} cx={(dx ?? 0) * r} cy={(dy ?? 0) * r} r={r * 0.06} />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// EarringSvg — small stud or hoop under the ear. Ear centers are at
// (±radius*0.95, radius*0.08) per HeadFace.
// ---------------------------------------------------------------------------

export function EarringSvg({
  side,
  radius,
}: {
  side: Exclude<EarringKind, "none">;
  radius: number;
}) {
  const r = radius;
  const earY = r * 0.28;
  const earX = r * 0.95;
  function Stud({ x }: { x: number }) {
    return (
      <g>
        {/* drop */}
        <ellipse cx={x} cy={earY + r * 0.08} rx={r * 0.08} ry={r * 0.11} fill="#FFC857" />
        {/* glint */}
        <ellipse
          cx={x - r * 0.025}
          cy={earY + r * 0.05}
          rx={r * 0.025}
          ry={r * 0.035}
          fill="#FFF6D8"
        />
        {/* tiny pin */}
        <line
          x1={x}
          y1={earY - r * 0.02}
          x2={x}
          y2={earY + r * 0.02}
          stroke="#A6781E"
          strokeWidth={Math.max(0.4, r * 0.04)}
        />
      </g>
    );
  }
  return (
    <g aria-hidden>
      {(side === "left" || side === "both") && <Stud x={-earX} />}
      {(side === "right" || side === "both") && <Stud x={earX} />}
    </g>
  );
}

// ---------------------------------------------------------------------------
// ScarfSvg — wraps around the neck just below the head. Drawn inside the
// BodyTorso group; origin = neck base (0, 0), so we render the scarf as a
// band centered on the neck and a small dangling end.
// ---------------------------------------------------------------------------

export function ScarfSvg({
  kind,
  width,
}: {
  kind: Exclude<ScarfKind, "none">;
  /** Approx torso width (same as BodyTorso's `w`); scales the scarf. */
  width: number;
}) {
  const w = width;
  // Scarf band height ~ 24% of torso width. Sits straddling the collar
  // (y around 0..h*0.18 inside BodyTorso). The torso's `torsoTop` is
  // `h*0.05`, so we anchor at y = h*0.05 .. h*0.22.
  const bandY = 0;
  const bandH = w * 0.32;
  const palette =
    kind === "striped"
      ? { base: "#C13B2C", stripe: "#FFF6D8" }
      : kind === "solid"
      ? { base: "#5C3D8A", stripe: "#3F2A60" }
      : { base: "#8A6A3F", stripe: "#5C4528" }; // knit
  return (
    <g aria-hidden>
      {/* Back wrap around neck */}
      <path
        d={`M ${-w * 0.5} ${bandY + bandH * 0.2}
            Q 0 ${bandY - bandH * 0.15} ${w * 0.5} ${bandY + bandH * 0.2}
            L ${w * 0.5} ${bandY + bandH * 0.95}
            Q 0 ${bandY + bandH * 0.55} ${-w * 0.5} ${bandY + bandH * 0.95} Z`}
        fill={palette.base}
      />
      {/* Stripes / knit pattern */}
      {kind === "striped" && (
        <g stroke={palette.stripe} strokeWidth={bandH * 0.12} strokeLinecap="round">
          <line
            x1={-w * 0.42}
            y1={bandY + bandH * 0.4}
            x2={w * 0.42}
            y2={bandY + bandH * 0.4}
          />
          <line
            x1={-w * 0.42}
            y1={bandY + bandH * 0.7}
            x2={w * 0.42}
            y2={bandY + bandH * 0.7}
          />
        </g>
      )}
      {kind === "knit" && (
        <g stroke={palette.stripe} strokeWidth={bandH * 0.06} opacity={0.85}>
          {[0.3, 0.5, 0.7].map((dy, i) => (
            <path
              key={i}
              d={`M ${-w * 0.42} ${bandY + bandH * dy}
                  q ${w * 0.06} ${-bandH * 0.08} ${w * 0.12} 0
                  t ${w * 0.12} 0
                  t ${w * 0.12} 0
                  t ${w * 0.12} 0
                  t ${w * 0.12} 0
                  t ${w * 0.12} 0
                  t ${w * 0.12} 0`}
              fill="none"
            />
          ))}
        </g>
      )}
      {/* Dangling end on the right side */}
      <path
        d={`M ${w * 0.34} ${bandY + bandH * 0.8}
            L ${w * 0.5} ${bandY + bandH * 0.85}
            L ${w * 0.55} ${bandY + bandH * 2.1}
            L ${w * 0.36} ${bandY + bandH * 2.0} Z`}
        fill={palette.base}
        opacity={0.95}
      />
      {/* fringe */}
      <g stroke={palette.stripe} strokeWidth={Math.max(0.5, bandH * 0.06)}>
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={w * 0.38 + i * (w * 0.045)}
            y1={bandY + bandH * 2.05}
            x2={w * 0.38 + i * (w * 0.045)}
            y2={bandY + bandH * 2.25}
          />
        ))}
      </g>
    </g>
  );
}
