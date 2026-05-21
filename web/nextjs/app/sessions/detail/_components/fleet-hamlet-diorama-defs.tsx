"use client";

// Fleet Hamlet — Cinematic Diorama `<defs>` (D2 pass).
//
// A single absolutely-positioned 0×0 SVG that owns every shared
// gradient + filter used by the Neighborhood diorama. Mounted once at the
// root of the scene; sprites reference the ids via `fill="url(#...)"` or
// `filter="url(#...)"`.
//
// SVG `<defs>` are globally addressable inside the same document, so a
// single hidden SVG provides them to every other SVG container in the
// Neighborhood (sky / mountains / houses / yard / streetlamps / chat
// bubbles). This keeps per-sprite SVG node counts low while still letting
// each volume pick up textures and tinted gradients.

import { DIORAMA_DEFS } from "../_lib/fleet-hamlet-diorama-tokens";

const D = DIORAMA_DEFS;

export function HamletDioramaDefs() {
  return (
    <svg
      aria-hidden
      width={0}
      height={0}
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <defs>
        {/* -----------------------------------------------------------
           Filters
           ----------------------------------------------------------- */}
        {/* Gentle paper-style noise — re-used by chat bubbles. */}
        <filter id={D.noise} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="3"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.85
                    0 0 0 0 0.85
                    0 0 0 0 0.85
                    0 0 0 0.18 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Roof tile texture — soft horizontal banding. */}
        <filter id={D.tile} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="turbulence" baseFrequency="0.04 0.7" numOctaves="2" seed="5" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0.14 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Wall stucco texture — subtle fine noise. */}
        <filter id={D.stucco} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="7" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.4
                    0 0 0 0 0.4
                    0 0 0 0 0.4
                    0 0 0 0.08 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Chimney brick — small offset block pattern. */}
        <filter id={D.brick} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="turbulence" baseFrequency="1.6 0.5" numOctaves="1" seed="11" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.2
                    0 0 0 0 0.1
                    0 0 0 0 0.05
                    0 0 0 0.22 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Frosted glass for windows. */}
        <filter id={D.frosted} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="13" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0.10 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Chat-bubble paper noise — slightly stronger than `noise`. */}
        <filter id={D.paperNoise} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="2" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.95
                    0 0 0 0 0.93
                    0 0 0 0 0.88
                    0 0 0 0.10 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* -----------------------------------------------------------
           Gradients
           ----------------------------------------------------------- */}
        {/* Sun radial halo — center-bright fading to transparent. */}
        <radialGradient id={D.sunHalo} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255, 252, 220, 0.95)" />
          <stop offset="35%" stopColor="rgba(255, 236, 170, 0.55)" />
          <stop offset="100%" stopColor="rgba(255, 220, 140, 0)" />
        </radialGradient>

        {/* Moon halo — cool blue glow. */}
        <radialGradient id={D.moonHalo} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(240, 240, 220, 0.9)" />
          <stop offset="50%" stopColor="rgba(180, 200, 240, 0.32)" />
          <stop offset="100%" stopColor="rgba(120, 140, 200, 0)" />
        </radialGradient>

        {/* Cloud volume — bright-top, cool-shadow-bottom for ellipse fills. */}
        <linearGradient id={D.cloudVolume} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.96)" />
          <stop offset="55%" stopColor="rgba(244, 246, 252, 0.92)" />
          <stop offset="100%" stopColor="rgba(200, 212, 230, 0.78)" />
        </linearGradient>

        {/* Window glass — pale cool grad, top is brighter highlight. */}
        <linearGradient id={D.windowGlass} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="hsl(205, 60%, 78%)" />
          <stop offset="55%" stopColor="hsl(212, 45%, 58%)" />
          <stop offset="100%" stopColor="hsl(220, 35%, 32%)" />
        </linearGradient>

        {/* Window glass when lit — warm interior light pushed through. */}
        <linearGradient id={D.windowGlassLit} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="hsl(48, 100%, 80%)" />
          <stop offset="60%" stopColor="hsl(40, 95%, 65%)" />
          <stop offset="100%" stopColor="hsl(28, 85%, 52%)" />
        </linearGradient>

        {/* Streetlamp glow — radial yellow → transparent. */}
        <radialGradient id={D.lampGlow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255, 240, 170, 0.85)" />
          <stop offset="45%" stopColor="rgba(255, 224, 130, 0.36)" />
          <stop offset="100%" stopColor="rgba(255, 220, 130, 0)" />
        </radialGradient>

        {/* Chat-bubble inner paper gradient (subtle highlight along the top). */}
        <linearGradient id={D.bubblePaper} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.9)" />
          <stop offset="40%" stopColor="rgba(255, 255, 255, 0.0)" />
          <stop offset="100%" stopColor="rgba(0, 0, 0, 0.04)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
