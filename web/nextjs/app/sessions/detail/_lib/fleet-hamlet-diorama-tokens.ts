// Fleet Hamlet — Cinematic Diorama tokens (D2 pass).
//
// Centralized constants for the "Monument Valley × Ghibli" diorama look.
// Consumed by the Neighborhood SVG sprites + `<HamletDioramaDefs>` filter
// stack. Light direction + tone math is kept here so individual sprites can
// pick the right highlight / shadow side without re-deriving the angle.
//
// All values are dimensionless gradients / opacities so they scale with the
// SVG viewBox. JS callers also get the raw constants so they can pick a
// gradient id from the shared `<defs>` without hardcoding.

import type { SkyPalette } from "./fleet-hamlet-decor";

// ---------------------------------------------------------------------------
// Light angle + intensity
// ---------------------------------------------------------------------------

// Default light angle (radians, 0 = +x). Diorama scenes look best with the
// sun slightly above-left so highlights fall on the upper-left of each
// volume and cast shadows lean right.
export const DIORAMA_LIGHT_ANGLE_RAD = -Math.PI * 0.27; // ~ -48.6°

// Highlight side of a face — used by sprites to decide which half gets the
// brighter band. "left" means the left ~25-30% of the front face brightens.
export type LightSide = "left" | "right";
export const DIORAMA_LIGHT_SIDE: LightSide = "left";

// ---------------------------------------------------------------------------
// 3-tone shading offsets (HSL lightness deltas relative to a base hue)
// ---------------------------------------------------------------------------

export const DIORAMA_TONE = {
  highlight: 14, // +L: bright side of a face
  mid: 0,        //  L: flat mid-tone
  shadow: -16,   // -L: darkened side of a face
  deepShadow: -28, // -L: cast shadow / underside
} as const;

// ---------------------------------------------------------------------------
// Cast shadow + depth fog
// ---------------------------------------------------------------------------

export const DIORAMA_CAST_SHADOW = {
  // Base ground-shadow (opaque-ish dark below a volume).
  base: "rgba(20, 24, 32, 0.34)",
  // Softer halo around the base, used to fade the shadow edge.
  soft: "rgba(20, 24, 32, 0.12)",
} as const;

export const DIORAMA_DEPTH_FOG = {
  // Near (in-front) layer — barely touches the color.
  near: "rgba(255, 255, 255, 0.04)",
  // Far layer — desaturates distant mountains a bit.
  far: "rgba(220, 228, 240, 0.22)",
} as const;

// ---------------------------------------------------------------------------
// Shared SVG `<defs>` ids — sprites reference these by string
// ---------------------------------------------------------------------------

export const DIORAMA_DEFS = {
  // Filter ids
  noise: "hamletNoise",
  tile: "hamletTileTexture",
  stucco: "hamletStuccoTexture",
  brick: "hamletBrickTexture",
  frosted: "hamletFrostedGlass",
  paperNoise: "hamletPaperNoise",
  // Gradient ids
  sunHalo: "hamletSunHalo",
  moonHalo: "hamletMoonHalo",
  cloudVolume: "hamletCloudVolume",
  windowGlass: "hamletWindowGlass",
  windowGlassLit: "hamletWindowGlassLit",
  lampGlow: "hamletLampGlow",
  bubblePaper: "hamletBubblePaper",
  // Room-scene-specific gradients (D2 interior pass)
  roomWallHighlightBand: "hamletRoomWallHighBand",
  roomWallShadowBand: "hamletRoomWallShadowBand",
  roomFloorBeam: "hamletRoomFloorBeam",
  roomLampCone: "hamletRoomLampCone",
  roomLampWarmPocket: "hamletRoomLampWarmPocket",
  roomWindowReflection: "hamletRoomWindowRefl",
  roomMetalGold: "hamletRoomMetalGold",
  roomMetalSilver: "hamletRoomMetalSilver",
  roomGloss: "hamletRoomGloss",
  roomGlass: "hamletRoomGlass",
} as const;

// ---------------------------------------------------------------------------
// Room-scene interior tokens (D2 indoor pass)
//
// Interior lighting flips the dominant light direction slightly: pendant
// lamps sit near the upper-right of the back wall, so highlight bands sit
// on the right column and shadow bands on the left. Window light comes
// from the upper-left of the back wall, so the floor beam tilts down-right.
// ---------------------------------------------------------------------------

export const DIORAMA_ROOM = {
  /** Opacity of the highlight band on the lit wall side. */
  wallHighlightOpacity: 0.16,
  /** Opacity of the shadow band on the dark wall side. */
  wallShadowOpacity: 0.18,
  /** Opacity of the floor light beam from the window. */
  floorBeamOpacity: 0.18,
  /** Opacity of the under-emoji shadow ellipse. */
  furnitureShadowOpacity: 0.22,
  /** Opacity of the volumetric pendant lamp cone (only at night). */
  lampConeOpacity: 0.18,
  /** Opacity of the warm pocket under the lamp (night only). */
  lampWarmOpacity: 0.22,
} as const;

// ---------------------------------------------------------------------------
// Time-of-day → light tint helper. Hours are 0-23 local; we map them to a
// warm/cool tint pair so dawn glows orange, noon is white-yellow, evening is
// salmon-violet, and night is moon-blue. Pure helper — no DOM.
// ---------------------------------------------------------------------------

export interface DioramaLight {
  /** Highlight tint color — added on top of an HSL face fill. */
  highlightColor: string;
  /** Shadow tint color — multiplied onto the shadow band. */
  shadowColor: string;
  /** Ground-cast direction multiplier (-1 = left, +1 = right). */
  castX: number;
  /** Ground-cast opacity. */
  castOpacity: number;
}

export function getDioramaLightForPalette(palette: SkyPalette): DioramaLight {
  if (palette.tod === "morning") {
    return {
      highlightColor: "rgba(255, 220, 160, 0.55)",
      shadowColor: "rgba(60, 70, 110, 0.30)",
      castX: 1,
      castOpacity: 0.35,
    };
  }
  if (palette.tod === "noon") {
    return {
      highlightColor: "rgba(255, 250, 220, 0.65)",
      shadowColor: "rgba(40, 50, 80, 0.28)",
      castX: 0.4,
      castOpacity: 0.42,
    };
  }
  if (palette.tod === "evening") {
    return {
      highlightColor: "rgba(255, 170, 120, 0.55)",
      shadowColor: "rgba(80, 50, 90, 0.34)",
      castX: -1,
      castOpacity: 0.42,
    };
  }
  // night
  return {
    highlightColor: "rgba(190, 210, 255, 0.30)",
    shadowColor: "rgba(10, 14, 30, 0.45)",
    castX: 0.2,
    castOpacity: 0.18,
  };
}
