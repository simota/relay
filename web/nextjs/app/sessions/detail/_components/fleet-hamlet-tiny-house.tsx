"use client";

// Fleet Hamlet — Tiny House 3D (Three.js compact architectural miniature).
//
// Used when the village has so many households that the regular HouseSvg
// shrinks into compact mode, or for Park households. Renders a Three.js
// 3D architectural cottage with pitched shingle roof, half-timber walls,
// glowing windows, and optional fire/bustle effects via the shared offscreen
// WebGL renderer.

import type { LifeEvent } from "../_lib/fleet-hamlet-events";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import type { Bustle } from "../_lib/fleet-hamlet-bustle";
import { ThreeHouseView } from "./fleet-hamlet-three-house";

interface TinyHouseSvgProps {
  sim: SimCardModel;
  /** Pixel size (square box). Caller is responsible for layout. */
  size: number;
  /** Recently-active → windows lit. */
  chimneyActive: boolean;
  /** Selected / highlighted in the panel — adds a soft drop shadow. */
  highlight?: boolean;
  /** Park residents — dim + no window glow. */
  dim?: boolean;
  /** Top-priority event — only `fire` and `achievement` render at tiny scale. */
  event?: LifeEvent;
  /** Night-time window glow. */
  windowsLit?: boolean;
  /** Tiny mode shows only minimal bustle (one note + aura at lively+). */
  bustle?: Bustle;
}

export function TinyHouseSvg({
  sim,
  size,
  chimneyActive,
  highlight,
  dim,
  event,
  windowsLit,
  bustle,
}: TinyHouseSvgProps) {
  return (
    <ThreeHouseView
      sim={sim}
      width={size}
      height={size}
      sizeVariant="tiny"
      chimneyActive={chimneyActive}
      highlight={highlight}
      dim={dim}
      event={event}
      windowsLit={windowsLit}
      bustle={bustle}
    />
  );
}
