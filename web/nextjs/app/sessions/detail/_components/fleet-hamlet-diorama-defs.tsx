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

        {/* F-3 procedural textures — feTurbulence variants used as composited
            overlays on top of the source graphic (no path additions). All
            four keep their alpha low so the texture reads as a soft grain
            rather than a hard pattern. */}

        {/* Wood grain — anisotropic horizontal grain. baseFrequency x≫y so
            streaks run along the +x axis (door slabs / shelf planks / bench
            seats). Brown-tinted multiply via feColorMatrix. */}
        <filter id={D.woodGrain} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.08 0.7" numOctaves="2" seed="17" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.32
                    0 0 0 0 0.20
                    0 0 0 0 0.10
                    0 0 0 0.30 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Marble — isotropic low-frequency turbulence with multi-octave
            veining. Tinted cool-grey so it reads as polished stone. */}
        <filter id={D.marble} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="turbulence" baseFrequency="0.012 0.012" numOctaves="3" seed="19" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.55
                    0 0 0 0 0.55
                    0 0 0 0 0.60
                    0 0 0 0.22 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Cloud puff — soft fractal volume for puffy sky clouds. The
            `lighting-color` stays neutral white so applying to the
            existing cloud ellipse adds depth without changing hue. */}
        <filter id={D.cloudPuff} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" seed="23" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0.18 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Watercolor — high-frequency noise with composite over the source
            so seasonal particles (petals / leaves / snow) get a soft paper
            wash without losing their silhouette. */}
        <filter id={D.watercolor} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="2" seed="29" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.94
                    0 0 0 0 0.92
                    0 0 0 0 0.86
                    0 0 0 0.16 0"
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

        {/* ----------------------------------------------------------- */}
        {/* Room-Scene (interior D2) gradients                          */}
        {/* ----------------------------------------------------------- */}
        {/* Wall highlight band — bright on the lit (right) column. */}
        <linearGradient id={D.roomWallHighlightBand} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(255, 250, 230, 0)" />
          <stop offset="55%" stopColor="rgba(255, 250, 230, 0)" />
          <stop offset="80%" stopColor="rgba(255, 250, 230, 0.45)" />
          <stop offset="100%" stopColor="rgba(255, 250, 230, 0.05)" />
        </linearGradient>

        {/* Wall shadow band — soft darkening on the left column. */}
        <linearGradient id={D.roomWallShadowBand} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(20, 24, 50, 0.45)" />
          <stop offset="35%" stopColor="rgba(20, 24, 50, 0.0)" />
          <stop offset="100%" stopColor="rgba(20, 24, 50, 0)" />
        </linearGradient>

        {/* Window light beam on the floor — diagonal yellow streak. */}
        <linearGradient id={D.roomFloorBeam} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 234, 160, 0.55)" />
          <stop offset="65%" stopColor="rgba(255, 234, 160, 0.20)" />
          <stop offset="100%" stopColor="rgba(255, 234, 160, 0)" />
        </linearGradient>

        {/* Pendant lamp volumetric cone — top bright, fading to nothing. */}
        <linearGradient id={D.roomLampCone} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 232, 168, 0.55)" />
          <stop offset="40%" stopColor="rgba(255, 226, 150, 0.22)" />
          <stop offset="100%" stopColor="rgba(255, 220, 140, 0)" />
        </linearGradient>

        {/* Warm pocket under the lamp (radial). */}
        <radialGradient id={D.roomLampWarmPocket} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255, 196, 120, 0.55)" />
          <stop offset="60%" stopColor="rgba(255, 170, 90, 0.18)" />
          <stop offset="100%" stopColor="rgba(255, 140, 70, 0)" />
        </radialGradient>

        {/* Window glass reflection — small upper-left highlight. */}
        <linearGradient id={D.roomWindowReflection} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.5)" />
          <stop offset="40%" stopColor="rgba(255, 255, 255, 0.12)" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
        </linearGradient>

        {/* Gold metal — used by trophies, frames, crown plinth. */}
        <linearGradient id={D.roomMetalGold} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F8DD8A" />
          <stop offset="40%" stopColor="#E5B14B" />
          <stop offset="70%" stopColor="#B98620" />
          <stop offset="100%" stopColor="#8B6914" />
        </linearGradient>

        {/* Silver metal — fan blades, fridge handles. */}
        <linearGradient id={D.roomMetalSilver} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F2F2F0" />
          <stop offset="50%" stopColor="#C0BEB8" />
          <stop offset="100%" stopColor="#7E7C75" />
        </linearGradient>

        {/* Surface gloss — diagonal sheen for whiteboard / appliance fronts. */}
        <linearGradient id={D.roomGloss} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.65)" />
          <stop offset="35%" stopColor="rgba(255, 255, 255, 0.10)" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
        </linearGradient>

        {/* Glass — for vases / fishbowls / spring-blossom vessel. */}
        <linearGradient id={D.roomGlass} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.7)" />
          <stop offset="45%" stopColor="rgba(220, 235, 245, 0.45)" />
          <stop offset="100%" stopColor="rgba(180, 200, 220, 0.55)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
