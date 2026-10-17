"use client";

// Fleet Hamlet — Realistic 3D Architectural House & Cutaway Room Diorama Engine (Three.js).
//
// Provides:
//   1. `ThreeHouseView` — 3D architectural exterior renderer for Neighborhood
//      houses (`sm`, `md`, `lg`), Park / overflow `TinyHouseSvg`, and House Plan
//      headers / showcase cards.
//   2. `ThreeRoomDioramaView` — 3D cutaway interior room diorama for `RoomScene`
//      with 3D walls, hardwood/marble floors, 3D window with volumetric light
//      beam, 3D pendant lamp with PointLight, 3D room-specific furniture,
//      3D pets, and 3D articulated resident / guest / visitor characters.

import { useRef } from "react";
import * as THREE from "three";
import {
  avatarPartsFromSeed,
  hashStringToInt,
  type SimCardModel,
} from "../_lib/fleet-hamlet";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";
import type { Bustle } from "../_lib/fleet-hamlet-bustle";
import type { TimeOfDay } from "../_lib/fleet-hamlet-decor";
import type { LifeEvent } from "../_lib/fleet-hamlet-events";
import type { RoomKind } from "../_lib/fleet-hamlet-house";
import {
  agentHueShift,
  hashRepoToHue,
  type HouseSize,
  type WeatherKind,
} from "../_lib/fleet-hamlet-layout";
import type { RoomAvatarMotion } from "../_lib/fleet-hamlet-outing";
import type {
  BeardKind,
  EarringKind,
  GlassesKind,
  MustacheKind,
  ScarfKind,
} from "../_lib/fleet-hamlet-particles";
import type { MoodPalette, Pet } from "../_lib/fleet-hamlet-room-companion";
import type { ContainerContents } from "../_lib/fleet-hamlet-room-containers";
import type { RoomPalette } from "../_lib/fleet-hamlet-room-furniture";
import type { RoomGuest } from "../_lib/fleet-hamlet-room-guests";
import type { AchievementBundle } from "../_lib/fleet-hamlet-room-life";
import type { RoomState } from "../_lib/fleet-hamlet-room-state";
import type { TemporalDecor } from "../_lib/fleet-hamlet-room-temporal";
import {
  animateCharacterRig3D,
  buildCharacterRig3D,
  buildSimsPlumbob3D,
  type CharacterClothingColors,
  type CharacterRig3D,
  type CharacterStylePreset,
} from "./fleet-hamlet-three-character";
import {
  ThreeStageCanvas,
  getBrickWallTexture,
  getFabricWeaveTexture,
  getGrassLawnTexture,
  getMarbleFloorTexture,
  getPlasterWallTexture,
  getRoofShingleTexture,
  getWoodPlankTexture,
} from "./fleet-hamlet-three-stage";

// ---------------------------------------------------------------------------
// 1. ThreeHouseView — Realistic 3D Architectural House (SimCity / The Sims Lot)
// ---------------------------------------------------------------------------

export interface ThreeHouseViewProps {
  sim: SimCardModel;
  width: number;
  height: number;
  sizeVariant?: HouseSize | "tiny";
  chimneyActive?: boolean;
  highlight?: boolean;
  dim?: boolean;
  event?: LifeEvent;
  windowsLit?: boolean;
  bustle?: Bustle;
  /** Optional resident standing in the front yard. */
  showYardResident?: boolean;
  /** Allow drag-to-orbit camera (e.g. in House Plan showcase). */
  interactiveOrbit?: boolean;
  className?: string;
}

export interface HouseRig3D {
  root: THREE.Group;
  smokePuffs: { mesh: THREE.Mesh; phase: number; baseX: number; baseY: number; baseZ: number }[];
  windowMaterials: THREE.MeshStandardMaterial[];
  windowLight: THREE.PointLight | null;
  fireCones: THREE.Mesh[];
  achievementHalo: THREE.Mesh | null;
  plumbobGroup: THREE.Group | null;
  bustleOrbs: THREE.Mesh[];
  yardResident: CharacterRig3D | null;
  bustleHues: readonly number[];
  chimneyActive: boolean;
  dim: boolean;
  windowsLit: boolean;
  roofHue: number;
}

export function ThreeHouseView({
  sim,
  width,
  height,
  sizeVariant = "md",
  chimneyActive = false,
  highlight = false,
  dim = false,
  event,
  windowsLit = false,
  bustle,
  showYardResident = false,
  interactiveOrbit = false,
  className,
}: ThreeHouseViewProps) {
  const houseRigRef = useRef<HouseRig3D | null>(null);
  const roofHue = hashRepoToHue(sim.repo);
  const wallHue = (roofHue + agentHueShift(sim.sessionType) + 360) % 360;
  const bustleIntensity = bustle && !dim ? bustle.intensity : "quiet";

  const sceneKey = [
    sim.key,
    sizeVariant,
    roofHue,
    wallHue,
    chimneyActive ? "chimney" : "nochimney",
    highlight ? "hi" : "nohi",
    dim ? "dim" : "nodim",
    windowsLit ? "lit" : "unlit",
    event?.kind ?? "noevent",
    bustleIntensity,
    showYardResident ? "res" : "nores",
  ].join(":");

  return (
    <ThreeStageCanvas
      width={width}
      height={height}
      fov={28}
      fpsCap={sizeVariant === "tiny" ? 20 : 28}
      interactiveOrbit={interactiveOrbit}
      sceneKey={sceneKey}
      className={className}
      setupScene={(scene, camera) => {
        // Lighting tailored to SimCity / The Sims isometric sunlight
        const isLit = (chimneyActive || windowsLit) && !dim;
        const hemi = new THREE.HemisphereLight(
          dim ? 0x9ab0d6 : 0xfff8ee,
          dim ? 0x1e293b : 0x3b5932,
          dim ? 0.95 : 1.4,
        );
        scene.add(hemi);

        const sunLight = new THREE.DirectionalLight(
          dim ? 0xadc5f0 : 0xfff3dc,
          dim ? 1.1 : 2.05,
        );
        sunLight.position.set(-3.2, 5.6, 4.2);
        scene.add(sunLight);

        const fillLight = new THREE.DirectionalLight(0x9ec5ff, 0.65);
        fillLight.position.set(3.5, 2.5, 2.2);
        scene.add(fillLight);

        if (highlight) {
          const rim = new THREE.PointLight(0x4ade80, 2.1, 6.5);
          rim.position.set(0, 2.8, -1.8);
          scene.add(rim);
        }

        const rig = buildHouse3D({
          sim,
          sizeVariant,
          roofHue,
          wallHue,
          chimneyActive,
          highlight,
          dim,
          event,
          windowsLit: isLit,
          bustle,
          showYardResident,
        });
        houseRigRef.current = rig;
        scene.add(rig.root);

        // True SimCity / The Sims 3/4 Isometric Lot Camera Framing
        if (sizeVariant === "tiny") {
          camera.position.set(2.35, 2.15, 2.65);
          camera.lookAt(0, 0.58, 0);
        } else if (sizeVariant === "sm") {
          camera.position.set(2.65, 2.38, 3.05);
          camera.lookAt(0, 0.68, 0);
        } else if (sizeVariant === "lg") {
          camera.position.set(3.15, 2.75, 3.55);
          camera.lookAt(0, 0.85, 0);
        } else {
          camera.position.set(2.85, 2.52, 3.25);
          camera.lookAt(0, 0.75, 0);
        }
      }}
      onFrame={(_scene, _camera, elapsedSec, _deltaSec, pointer) => {
        const rig = houseRigRef.current;
        if (!rig) return;

        // Isometric 3/4 orientation + hover/drag orbit
        const baseYaw = -0.18;
        const hoverYaw = pointer.hovered ? pointer.localX * 0.25 : 0;
        const hoverPitch = pointer.hovered ? -pointer.localY * 0.08 : 0;
        rig.root.rotation.y = baseYaw + hoverYaw + pointer.orbitYaw;
        rig.root.rotation.x = hoverPitch + pointer.orbitPitch;

        // Animate 3D volumetric chimney smoke puffs
        if (rig.chimneyActive && !rig.dim) {
          for (const puff of rig.smokePuffs) {
            const p = (elapsedSec * 0.55 + puff.phase) % 1;
            puff.mesh.position.set(
              puff.baseX + Math.sin(p * Math.PI * 2 + puff.phase * 4) * 0.08 + p * 0.18,
              puff.baseY + p * 0.85,
              puff.baseZ - p * 0.08,
            );
            const s = 0.45 + Math.sin(p * Math.PI) * 0.85;
            puff.mesh.scale.setScalar(s);
            const mat = puff.mesh.material as THREE.MeshStandardMaterial;
            mat.opacity = (1 - p) * 0.72;
          }
        }

        // Animate window glow pulse when bustle or night glow is active
        if (rig.windowMaterials.length > 0 && (rig.windowsLit || rig.chimneyActive) && !rig.dim) {
          const pulse = 0.75 + Math.sin(elapsedSec * 2.8) * 0.25;
          for (let i = 0; i < rig.windowMaterials.length; i++) {
            const mat = rig.windowMaterials[i];
            if (!mat) continue;
            if (rig.bustleHues.length > 0) {
              const hue = rig.bustleHues[(i + Math.floor(elapsedSec * 1.5)) % rig.bustleHues.length] ?? 48;
              mat.emissive.setHSL(hue / 360, 0.85, 0.52);
              mat.emissiveIntensity = 0.95 * pulse;
            } else {
              mat.emissiveIntensity = 0.78 * pulse;
            }
          }
          if (rig.windowLight) {
            rig.windowLight.intensity = 1.25 * pulse;
          }
        }

        // Animate fire cones
        for (let i = 0; i < rig.fireCones.length; i++) {
          const cone = rig.fireCones[i];
          if (!cone) continue;
          cone.scale.y = 0.8 + Math.sin(elapsedSec * 12 + i * 2.1) * 0.35;
          cone.rotation.z = Math.sin(elapsedSec * 8 + i) * 0.14;
        }

        // Animate achievement halo
        if (rig.achievementHalo) {
          rig.achievementHalo.rotation.z = elapsedSec * 1.4;
          rig.achievementHalo.position.y =
            rig.achievementHalo.userData.baseY + Math.sin(elapsedSec * 2.5) * 0.06;
        }

        // Animate rooftop Sims Plumbob crystal
        if (rig.plumbobGroup) {
          rig.plumbobGroup.rotation.y = elapsedSec * 2.2;
          const baseY = (rig.plumbobGroup.userData.baseY as number | undefined) ?? 2.1;
          rig.plumbobGroup.position.y = baseY + Math.sin(elapsedSec * 3.1) * 0.055;
        }

        // Animate bustle musical orbs
        for (let i = 0; i < rig.bustleOrbs.length; i++) {
          const orb = rig.bustleOrbs[i];
          if (!orb) continue;
          const phase = (elapsedSec * 0.65 + i * 0.33) % 1;
          orb.position.y = orb.userData.baseY + phase * 0.65;
          orb.position.x = orb.userData.baseX + Math.sin(phase * Math.PI * 2 + i) * 0.14;
          orb.scale.setScalar(Math.sin(phase * Math.PI) * 1.1);
        }

        // Animate yard resident if present
        if (rig.yardResident) {
          animateCharacterRig3D(rig.yardResident, elapsedSec, pointer);
        }
      }}
    />
  );
}

export function buildHouse3D({
  sim,
  sizeVariant,
  roofHue,
  wallHue,
  chimneyActive,
  highlight,
  dim,
  event,
  windowsLit,
  bustle,
  showYardResident,
}: {
  sim: SimCardModel;
  sizeVariant: HouseSize | "tiny";
  roofHue: number;
  wallHue: number;
  chimneyActive: boolean;
  highlight: boolean;
  dim: boolean;
  event?: LifeEvent;
  windowsLit: boolean;
  bustle?: Bustle;
  showYardResident: boolean;
}): HouseRig3D {
  const root = new THREE.Group();
  const isTiny = sizeVariant === "tiny";
  const isLg = sizeVariant === "lg";
  const isMd = sizeVariant === "md";

  const roofTex = getRoofShingleTexture();
  const brickTex = getBrickWallTexture();
  const plasterTex = getPlasterWallTexture();
  const woodTex = getWoodPlankTexture();
  const grassTex = getGrassLawnTexture();

  // Palette & Materials
  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${wallHue}, ${dim ? 20 : 35}%, ${dim ? 52 : 76}%)`),
    roughness: 0.75,
    metalness: 0.02,
    map: plasterTex ?? null,
    bumpMap: plasterTex ?? null,
    bumpScale: 0.015,
  });
  const foundationMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#6e6a64"),
    roughness: 0.85,
    map: brickTex ?? null,
    bumpMap: brickTex ?? null,
    bumpScale: 0.02,
  });
  const timberMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("hsl(25, 38%, 24%)"),
    roughness: 0.72,
    map: woodTex ?? null,
  });
  const roofMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(`hsl(${roofHue}, ${dim ? 38 : 66}%, ${dim ? 36 : 46}%)`),
    roughness: 0.48,
    metalness: 0.08,
    clearcoat: 0.16,
    map: roofTex ?? null,
    bumpMap: roofTex ?? null,
    bumpScale: 0.03,
  });
  const roofTrimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${roofHue}, 45%, 76%)`),
    roughness: 0.42,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("hsl(24, 52%, 28%)"),
    roughness: 0.55,
    map: woodTex ?? null,
  });
  const chimneyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("hsl(14, 48%, 38%)"),
    roughness: 0.82,
    map: brickTex ?? null,
    bumpMap: brickTex ?? null,
    bumpScale: 0.025,
  });

  // 1. SimCity Zoned Residential Lot Base (Earth Slab + Lawn + Sidewalk + Curb + Driveway)
  const plotW = isLg ? 2.25 : isMd ? 2.0 : 1.75;
  const plotD = isLg ? 1.95 : isMd ? 1.75 : 1.58;

  // Sub-surface SimCity earth/bedrock pedestal slab
  const earthSlabMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(dim ? "#334155" : "#5c4938"),
    roughness: 0.92,
  });
  const earthSlab = new THREE.Mesh(
    new THREE.BoxGeometry(plotW + 0.06, 0.12, plotD + 0.22),
    earthSlabMat,
  );
  earthSlab.position.set(0, -0.04, 0.08);
  root.add(earthSlab);

  // Zoned lawn surface
  const lawnMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(dim ? "#3b5238" : highlight ? "#4ade80" : "#52a744"),
    roughness: 0.85,
    map: grassTex ?? null,
  });
  const lawnPlot = new THREE.Mesh(
    new THREE.BoxGeometry(plotW, 0.1, plotD),
    lawnMat,
  );
  lawnPlot.position.set(0, 0.05, 0);
  root.add(lawnPlot);

  // SimCity R-Zone glowing lot perimeter border when active or highlighted
  if (!dim) {
    const zoneBorderMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(highlight ? "#22e55e" : "#4ade80"),
      emissive: new THREE.Color(highlight ? "#16a34a" : "#15803d"),
      emissiveIntensity: highlight ? 0.65 : 0.25,
      roughness: 0.4,
    });
    const borderFront = new THREE.Mesh(
      new THREE.BoxGeometry(plotW + 0.02, 0.02, 0.035),
      zoneBorderMat,
    );
    borderFront.position.set(0, 0.105, plotD * 0.5);
    root.add(borderFront);
  }

  // Front concrete sidewalk & asphalt street curb strip (SimCity street edge)
  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(dim ? "#64748b" : "#cbd5e1"),
    roughness: 0.78,
  });
  const sidewalk = new THREE.Mesh(
    new THREE.BoxGeometry(plotW + 0.04, 0.08, 0.2),
    sidewalkMat,
  );
  sidewalk.position.set(0, 0.045, plotD * 0.5 + 0.1);
  root.add(sidewalk);

  const asphaltMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(dim ? "#1e293b" : "#334155"),
    roughness: 0.88,
  });
  const roadStrip = new THREE.Mesh(
    new THREE.BoxGeometry(plotW + 0.06, 0.05, 0.16),
    asphaltMat,
  );
  roadStrip.position.set(0, 0.028, plotD * 0.5 + 0.26);
  root.add(roadStrip);

  // Flagstone path from sidewalk to front door
  const pathStoneMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#b8b2a6"),
    roughness: 0.76,
  });
  for (let i = 0; i < 3; i++) {
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry(0.28 - i * 0.02, 0.025, 0.14),
      pathStoneMat,
    );
    stone.position.set(0, 0.105, plotD * 0.2 + i * 0.16);
    root.add(stone);
  }

  // Driveway + Parked 3D Miniature SimCity Car on md / lg lots
  if (!isTiny && (isMd || isLg)) {
    const driveX = plotW * 0.34;
    const driveway = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.02, 0.72),
      asphaltMat,
    );
    driveway.position.set(driveX, 0.102, plotD * 0.16);
    root.add(driveway);

    // 3D Miniature Sedan Car parked on driveway
    const carGrp = buildMiniCar3D((roofHue + 180) % 360, windowsLit);
    carGrp.position.set(driveX, 0.11, plotD * 0.18);
    carGrp.scale.setScalar(isLg ? 0.85 : 0.75);
    root.add(carGrp);
  }

  // White Picket Fence & Red-Flag Mailbox at front-left of lot
  if (!isTiny) {
    const fenceMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.5,
    });
    for (let p = 0; p < 4; p++) {
      const picket = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.18, 0.02),
        fenceMat,
      );
      picket.position.set(-plotW * 0.42 + p * 0.12, 0.18, plotD * 0.45);
      root.add(picket);
    }
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.025, 0.025),
      fenceMat,
    );
    rail.position.set(-plotW * 0.24, 0.21, plotD * 0.45);
    root.add(rail);

    // Mailbox on post
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.24, 8),
      timberMat,
    );
    post.position.set(-plotW * 0.15, 0.22, plotD * 0.42);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.07, 0.13),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.4 }),
    );
    box.position.set(-plotW * 0.15, 0.34, plotD * 0.42);
    root.add(post, box);
  }

  // 2. Main House Body & Stone Foundation Plinth
  const bodyW = isLg ? 1.38 : isMd ? 1.22 : 1.05;
  const bodyH = isLg ? 1.18 : isMd ? 0.96 : 0.78;
  const bodyD = isLg ? 1.08 : isMd ? 0.96 : 0.86;
  const plinthH = 0.14;
  const baseY = 0.1;

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 1.04, plinthH, bodyD * 1.04),
    foundationMat,
  );
  plinth.position.set(0, baseY + plinthH * 0.5, -0.05);
  root.add(plinth);

  const wallCenterY = baseY + plinthH + bodyH * 0.5;
  const mainWalls = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW, bodyH, bodyD),
    wallMat,
  );
  mainWalls.position.set(0, wallCenterY, -0.05);
  root.add(mainWalls);

  // Half-timber architectural corner posts & horizontal beam
  const postThick = 0.045;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(postThick, bodyH, postThick),
        timberMat,
      );
      post.position.set(
        sx * (bodyW * 0.5 - postThick * 0.3),
        wallCenterY,
        -0.05 + sz * (bodyD * 0.5 - postThick * 0.3),
      );
      root.add(post);
    }
  }
  if (!isTiny) {
    const midBeam = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 1.02, 0.04, bodyD * 1.02),
      timberMat,
    );
    midBeam.position.set(0, baseY + plinthH + bodyH * 0.55, -0.05);
    root.add(midBeam);
  }

  // Optional Side Wing for `lg` manor houses
  if (isLg) {
    const wingW = 0.58;
    const wingH = bodyH * 0.78;
    const wingD = bodyD * 0.82;
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(wingW, wingH, wingD),
      wallMat,
    );
    wing.position.set(-bodyW * 0.58, baseY + plinthH + wingH * 0.5, -0.02);
    root.add(wing);

    const wingRoof = createGableRoofMesh(wingW * 1.15, 0.42, wingD * 1.14, roofMat, roofTrimMat);
    wingRoof.position.set(-bodyW * 0.58, baseY + plinthH + wingH, -0.02);
    root.add(wingRoof);
  }

  // 3. Pitched Gable Roof with Overhanging Eaves & Fascia Trim
  const roofH = isLg ? 0.68 : isMd ? 0.58 : 0.5;
  const eaveY = baseY + plinthH + bodyH;
  const mainRoof = createGableRoofMesh(
    bodyW * 1.16,
    roofH,
    bodyD * 1.16,
    roofMat,
    roofTrimMat,
  );
  mainRoof.position.set(0, eaveY, -0.05);
  root.add(mainRoof);

  // 4. Front Door, Porch Step, & Overhang Portico (for md/lg)
  const frontZ = -0.05 + bodyD * 0.5;
  const doorW = 0.24;
  const doorH = 0.44;
  const doorX = isLg || isMd ? -bodyW * 0.14 : 0;

  // Door frame & recessed panel
  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(doorW + 0.06, doorH + 0.04, 0.05),
    timberMat,
  );
  doorFrame.position.set(doorX, baseY + plinthH + doorH * 0.5, frontZ + 0.01);
  root.add(doorFrame);

  const doorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(doorW, doorH, 0.045),
    doorMat,
  );
  doorPanel.position.set(doorX, baseY + plinthH + doorH * 0.5, frontZ + 0.015);
  root.add(doorPanel);

  // Brass doorknob
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.024, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xffd54f, metalness: 0.9, roughness: 0.15 }),
  );
  knob.position.set(doorX + doorW * 0.34, baseY + plinthH + doorH * 0.46, frontZ + 0.048);
  root.add(knob);

  // Porch overhang & columns on md / lg
  if (isMd || isLg) {
    const porchW = 0.44;
    const porchD = 0.24;
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(porchW, 0.045, porchD),
      roofMat,
    );
    canopy.position.set(doorX, baseY + plinthH + doorH + 0.06, frontZ + porchD * 0.45);
    canopy.rotation.x = 0.18;
    root.add(canopy);

    for (const s of [-1, 1] as const) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.028, doorH + 0.04, 10),
        roofTrimMat,
      );
      col.position.set(
        doorX + s * (porchW * 0.42),
        baseY + plinthH + doorH * 0.5,
        frontZ + porchD * 0.8,
      );
      root.add(col);
    }
  }

  // 5. Deep-Set 3D Mullioned Windows with Shutters & Interior Glow
  const windowMaterials: THREE.MeshStandardMaterial[] = [];
  const winGlowColor = new THREE.Color(
    windowsLit ? "#ffd56b" : `hsl(${(roofHue + 45) % 360}, 90%, 66%)`,
  );

  const addWindow3D = (wx: number, wy: number, wz: number, rotY = 0, wSize = 0.23) => {
    const winGrp = new THREE.Group();
    winGrp.position.set(wx, wy, wz);
    winGrp.rotation.y = rotY;

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(wSize + 0.05, wSize + 0.05, 0.05),
      timberMat,
    );
    winGrp.add(frame);

    const glassMat = new THREE.MeshStandardMaterial({
      color: windowsLit ? 0xfff3c4 : 0x334155,
      emissive: windowsLit ? winGlowColor : new THREE.Color(0x000000),
      emissiveIntensity: windowsLit ? 0.85 : 0,
      roughness: 0.12,
      metalness: 0.2,
    });
    windowMaterials.push(glassMat);

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(wSize, wSize, 0.03),
      glassMat,
    );
    glass.position.z = 0.012;
    winGrp.add(glass);

    // Cross mullions
    const mullionV = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, wSize, 0.042),
      roofTrimMat,
    );
    mullionV.position.z = 0.015;
    const mullionH = new THREE.Mesh(
      new THREE.BoxGeometry(wSize, 0.022, 0.042),
      roofTrimMat,
    );
    mullionH.position.z = 0.015;
    winGrp.add(mullionV, mullionH);

    // Window sill
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(wSize + 0.09, 0.03, 0.08),
      foundationMat,
    );
    sill.position.set(0, -wSize * 0.5 - 0.02, 0.02);
    winGrp.add(sill);

    // Wooden shutters on non-tiny windows
    if (!isTiny) {
      const shutterMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(`hsl(${roofHue}, 42%, 34%)`),
        roughness: 0.65,
      });
      for (const side of [-1, 1] as const) {
        const shutter = new THREE.Mesh(
          new THREE.BoxGeometry(wSize * 0.32, wSize + 0.02, 0.03),
          shutterMat,
        );
        shutter.position.set(side * (wSize * 0.68), 0, 0.018);
        winGrp.add(shutter);
      }
    }

    root.add(winGrp);
  };

  if (isTiny) {
    addWindow3D(bodyW * 0.24, baseY + plinthH + bodyH * 0.55, frontZ + 0.01, 0, 0.22);
  } else if (sizeVariant === "sm") {
    addWindow3D(-bodyW * 0.28, baseY + plinthH + bodyH * 0.55, frontZ + 0.01, 0, 0.22);
    addWindow3D(bodyW * 0.28, baseY + plinthH + bodyH * 0.55, frontZ + 0.01, 0, 0.22);
  } else if (isMd) {
    addWindow3D(bodyW * 0.26, baseY + plinthH + bodyH * 0.45, frontZ + 0.01, 0, 0.24);
    addWindow3D(0, eaveY + roofH * 0.28, frontZ - 0.02, 0, 0.19);
    // Side wall window
    addWindow3D(bodyW * 0.5 + 0.01, baseY + plinthH + bodyH * 0.52, -0.05, Math.PI / 2, 0.22);
  } else {
    // Grand `lg` 2-story windows
    addWindow3D(bodyW * 0.26, baseY + plinthH + bodyH * 0.32, frontZ + 0.01, 0, 0.24);
    addWindow3D(-bodyW * 0.24, baseY + plinthH + bodyH * 0.76, frontZ + 0.01, 0, 0.22);
    addWindow3D(bodyW * 0.26, baseY + plinthH + bodyH * 0.76, frontZ + 0.01, 0, 0.22);
    addWindow3D(bodyW * 0.5 + 0.01, baseY + plinthH + bodyH * 0.45, -0.05, Math.PI / 2, 0.22);
  }

  let windowLight: THREE.PointLight | null = null;
  if (windowsLit && !dim) {
    windowLight = new THREE.PointLight(0xffd27e, 1.35, 3.2);
    windowLight.position.set(0.15, baseY + plinthH + bodyH * 0.5, frontZ + 0.45);
    root.add(windowLight);
  }

  // 6. Brick Chimney & Animated 3D Smoke Puffs
  const chimneyX = bodyW * 0.28;
  const chimneyZ = -0.18;
  const chimneyTopY = eaveY + roofH * 0.88;
  const chimneyStack = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, roofH * 0.85, 0.18),
    chimneyMat,
  );
  chimneyStack.position.set(chimneyX, eaveY + roofH * 0.42, chimneyZ);
  root.add(chimneyStack);

  const chimneyCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.045, 0.22),
    foundationMat,
  );
  chimneyCap.position.set(chimneyX, chimneyTopY, chimneyZ);
  root.add(chimneyCap);

  const smokePuffs: HouseRig3D["smokePuffs"] = [];
  const bustleHues = bustle && bustle.intensity !== "quiet" ? bustle.subagentHues : [];
  if (chimneyActive && !dim) {
    const puffCount = isTiny ? 3 : 5;
    for (let i = 0; i < puffCount; i++) {
      const hue = bustleHues.length > 0 ? (bustleHues[i % bustleHues.length] ?? roofHue) : roofHue;
      const sat = bustleHues.length > 0 ? 75 : 22;
      const light = bustleHues.length > 0 ? 72 : 88;
      const puffMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(`hsl(${hue}, ${sat}%, ${light}%)`),
        roughness: 0.9,
        transparent: true,
        opacity: 0.65,
      });
      const puffMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.095, 10, 10),
        puffMat,
      );
      const baseX = chimneyX;
      const baseY = chimneyTopY + 0.06;
      const baseZ = chimneyZ;
      puffMesh.position.set(baseX, baseY, baseZ);
      root.add(puffMesh);
      smokePuffs.push({
        mesh: puffMesh,
        phase: i / puffCount,
        baseX,
        baseY,
        baseZ,
      });
    }
  }

  // 7. Yard Tree & Bush Foliage (Non-tiny)
  if (!isTiny) {
    const treeGrp = new THREE.Group();
    treeGrp.position.set(plotW * 0.36, baseY, plotD * 0.12);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.055, 0.32, 8),
      timberMat,
    );
    trunk.position.y = 0.16;
    treeGrp.add(trunk);

    const foliageMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(dim ? "#2d4c2b" : "#4b9640"),
      roughness: 0.75,
    });
    for (let l = 0; l < 3; l++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.24 - l * 0.045, 0.28, 10),
        foliageMat,
      );
      cone.position.y = 0.32 + l * 0.15;
      treeGrp.add(cone);
    }
    root.add(treeGrp);
  }

  // 8. Event Overlays (Fire / Achievement / Bustle)
  const fireCones: THREE.Mesh[] = [];
  if (event?.kind === "fire") {
    const fireMat = new THREE.MeshStandardMaterial({
      color: 0xff5722,
      emissive: 0xff3d00,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.12 - i * 0.02, 0.34, 8),
        fireMat,
      );
      flame.position.set((i - 1) * 0.14, eaveY + roofH * 0.85, -0.05);
      root.add(flame);
      fireCones.push(flame);
    }
  }

  let achievementHalo: THREE.Mesh | null = null;
  if (event?.kind === "achievement") {
    const haloMat = new THREE.MeshStandardMaterial({
      color: 0xffd54f,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.65,
      metalness: 0.85,
      roughness: 0.18,
    });
    achievementHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.03, 8, 24),
      haloMat,
    );
    achievementHalo.rotation.x = Math.PI / 2;
    const haloY = eaveY + roofH + 0.18;
    achievementHalo.position.set(0, haloY, -0.05);
    achievementHalo.userData.baseY = haloY;
    root.add(achievementHalo);
  }

  const bustleOrbs: THREE.Mesh[] = [];
  if (bustle && bustle.intensity !== "quiet" && !dim) {
    const orbCount = bustle.intensity === "party" ? 4 : 2;
    for (let i = 0; i < orbCount; i++) {
      const hue = bustle.subagentHues[i % Math.max(1, bustle.subagentHues.length)] ?? 48;
      const orbMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(`hsl(${hue}, 85%, 65%)`),
        emissive: new THREE.Color(`hsl(${hue}, 85%, 50%)`),
        emissiveIntensity: 0.7,
        roughness: 0.2,
      });
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), orbMat);
      const bx = (i - (orbCount - 1) * 0.5) * 0.28;
      const by = eaveY + roofH * 0.65;
      orb.position.set(bx, by, 0.1);
      orb.userData.baseX = bx;
      orb.userData.baseY = by;
      root.add(orb);
      bustleOrbs.push(orb);
    }
  }

  // 9. Rooftop Sims Plumbob Crystal (Active or Highlighted Houses)
  let plumbobGroup: THREE.Group | null = null;
  if ((chimneyActive || highlight) && !dim) {
    const pMood =
      event?.kind === "fire" || sim.mood.key === "stressed"
        ? "crimson"
        : sim.mood.key === "bored"
          ? "amber"
          : sim.mood.key === "asleep"
            ? "aqua"
            : "emerald";
    plumbobGroup = buildSimsPlumbob3D(isTiny ? 0.13 : highlight ? 0.19 : 0.15, pMood);
    const pBaseY = eaveY + roofH + (isTiny ? 0.26 : 0.34);
    plumbobGroup.position.set(0, pBaseY, -0.05);
    plumbobGroup.userData.baseY = pBaseY;
    root.add(plumbobGroup);
  }

  // 10. Optional 3D Resident in Yard
  let yardResident: CharacterRig3D | null = null;
  if (showYardResident && !isTiny) {
    const parts = avatarPartsFromSeed(sim.avatarSeed, sim.stage.key);
    const expression = getExpressionForMood(sim.mood.key);
    const clothes: CharacterClothingColors = {
      shirt: `hsl(${sim.hue}, 58%, 52%)`,
      shirtDark: `hsl(${sim.hue}, 62%, 36%)`,
      accent: `hsl(${sim.hue}, 75%, 76%)`,
    };
    yardResident = buildCharacterRig3D({
      parts,
      expression,
      clothing: clothes,
      mode: "full",
      showGroundShadow: true,
    });
    yardResident.root.scale.setScalar(0.38);
    yardResident.root.position.set(-plotW * 0.3, baseY, plotD * 0.25);
    root.add(yardResident.root);
  }

  return {
    root,
    smokePuffs,
    windowMaterials,
    windowLight,
    fireCones,
    achievementHalo,
    plumbobGroup,
    bustleOrbs,
    yardResident,
    bustleHues,
    chimneyActive,
    dim,
    windowsLit,
    roofHue,
  };
}

export function buildMiniCar3D(hue: number, lightsOn = false): THREE.Group {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(`hsl(${hue}, 72%, 48%)`),
    roughness: 0.25,
    metalness: 0.35,
    clearcoat: 0.85,
  });
  const cabinMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(`hsl(${hue}, 65%, 56%)`),
    roughness: 0.25,
    metalness: 0.25,
    clearcoat: 0.85,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.12,
    metalness: 0.6,
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.85,
  });

  // Lower chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.52), bodyMat);
  chassis.position.y = 0.065;
  car.add(chassis);

  // Upper cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.28), cabinMat);
  cabin.position.set(0, 0.14, -0.02);
  car.add(cabin);

  // Windshield & rear window
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.245, 0.065, 0.29), glassMat);
  windshield.position.set(0, 0.138, -0.02);
  car.add(windshield);

  // 4 Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.035, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const sx of [-0.14, 0.14]) {
    for (const sz of [-0.15, 0.15]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(sx, 0.042, sz);
      car.add(w);
    }
  }

  // Headlights
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: lightsOn ? 0xfacc15 : 0x000000,
    emissiveIntensity: lightsOn ? 1.4 : 0,
  });
  for (const sx of [-0.09, 0.09]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.02), headMat);
    hl.position.set(sx, 0.07, 0.26);
    car.add(hl);
  }

  return car;
}

function createGableRoofMesh(
  w: number,
  h: number,
  d: number,
  roofMat: THREE.Material,
  trimMat: THREE.Material,
): THREE.Group {
  const grp = new THREE.Group();
  const halfW = w * 0.5;
  const slopeLen = Math.hypot(halfW, h);
  const slopeAngle = Math.atan2(h, halfW);
  const plateThick = 0.055;

  // Left & Right pitched roof slopes
  for (const side of [-1, 1] as const) {
    const slope = new THREE.Mesh(
      new THREE.BoxGeometry(slopeLen, plateThick, d),
      roofMat,
    );
    slope.position.set(side * (halfW * 0.5), h * 0.5, 0);
    slope.rotation.z = -side * slopeAngle;
    grp.add(slope);
  }

  // Front & Back triangular gable pediments
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-halfW * 0.92, 0);
  gableShape.lineTo(halfW * 0.92, 0);
  gableShape.lineTo(0, h * 0.96);
  gableShape.closePath();

  const gableGeo = new THREE.ExtrudeGeometry(gableShape, {
    depth: d * 0.88,
    bevelEnabled: false,
  });
  gableGeo.translate(0, 0, -d * 0.44);
  const gableMesh = new THREE.Mesh(gableGeo, trimMat);
  grp.add(gableMesh);

  // Ridge beam cap
  const ridge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, d * 1.02, 10),
    trimMat,
  );
  ridge.rotation.x = Math.PI / 2;
  ridge.position.set(0, h + 0.01, 0);
  grp.add(ridge);

  return grp;
}

// ---------------------------------------------------------------------------
// 2. ThreeRoomDioramaView — The Sims 3/4 Isometric Cutaway Dollhouse
// ---------------------------------------------------------------------------

export interface ThreeRoomDioramaViewProps {
  card: SimCardModel;
  roomKind: RoomKind;
  palette: RoomPalette;
  moodPalette: MoodPalette;
  tod: TimeOfDay;
  weather: WeatherKind;
  isDark: boolean;
  roomState: RoomState;
  achievements: AchievementBundle;
  temporal: TemporalDecor;
  containerContents: ContainerContents;
  pets: readonly Pet[];
  guests: readonly RoomGuest[];
  hasRecentUserMessage: boolean;
  motion: RoomAvatarMotion;
  stylePreset: CharacterStylePreset;
  clothing: CharacterClothingColors;
  accessories: {
    glasses: GlassesKind;
    mustache: MustacheKind;
    beard: BeardKind;
    earring: EarringKind;
    scarf: ScarfKind;
    hat: "scholar" | "cap" | "tophat" | "none";
    crown: boolean;
  };
}

export interface RoomDioramaRig3D {
  root: THREE.Group;
  residentRig: CharacterRig3D;
  visitorRig: CharacterRig3D | null;
  guestRigs: { rig: CharacterRig3D; phase: number; baseX: number; baseZ: number }[];
  petMeshes: { grp: THREE.Group; pet: Pet }[];
  lampLight: THREE.PointLight;
  motion: RoomAvatarMotion;
}

export function ThreeRoomDioramaView(props: ThreeRoomDioramaViewProps) {
  const {
    card,
    roomKind,
    palette,
    moodPalette,
    tod,
    weather,
    isDark,
    roomState,
    achievements,
    temporal,
    containerContents,
    pets,
    guests,
    hasRecentUserMessage,
    motion,
    stylePreset,
    clothing,
    accessories,
  } = props;

  const dioramaRef = useRef<RoomDioramaRig3D | null>(null);

  const sceneKey = [
    card.key,
    roomKind,
    card.mood.key,
    tod,
    weather,
    isDark ? "dark" : "day",
    roomState.plantStage,
    roomState.plantsWilted ? "wilt" : "fresh",
    roomState.messLevel,
    achievements.hasCrown ? "crown" : "nocrown",
    achievements.hasTrophy ? "trophy" : "notrophy",
    achievements.hasCarpet ? "carpet" : "nocarpet",
    temporal.isChristmas ? "xmas" : "noxmas",
    pets.length,
    guests.length,
    hasRecentUserMessage ? "visitor" : "novisitor",
    motion,
  ].join(":");

  return (
    <ThreeStageCanvas
      width={360}
      height={220}
      fov={30}
      fpsCap={28}
      interactiveOrbit
      sceneKey={sceneKey}
      className="w-full h-full"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
      setupScene={(scene, camera) => {
        // Interior + Window lighting (The Sims warm dollhouse lighting)
        const hemi = new THREE.HemisphereLight(
          isDark ? 0x5c6f9e : 0xfff8f0,
          isDark ? 0x1e2238 : 0x5c4a38,
          isDark ? 0.85 : 1.5,
        );
        scene.add(hemi);

        // Sunlight / Moonlight entering from the top-left window
        const windowDirLight = new THREE.DirectionalLight(
          tod === "evening"
            ? 0xff9e6d
            : isDark
              ? 0x8ab4f8
              : 0xfff5dc,
          isDark ? 0.85 : 1.85,
        );
        windowDirLight.position.set(-2.6, 3.6, 2.8);
        scene.add(windowDirLight);

        // Ceiling pendant lamp PointLight (at right-center cx ≈ 0.9)
        const lampLight = new THREE.PointLight(
          isDark ? 0xffe082 : 0xfff3c4,
          isDark ? 2.5 : 1.2,
          7.5,
        );
        lampLight.position.set(0.95, 1.85, 0.2);
        scene.add(lampLight);

        const diorama = buildRoomDiorama3D(props, lampLight);
        dioramaRef.current = diorama;
        scene.add(diorama.root);

        // Elevated 3/4 Isometric Sims Dollhouse Camera
        camera.position.set(0.58, 2.28, 3.92);
        camera.lookAt(0, 0.58, 0);
      }}
      onFrame={(_scene, camera, elapsedSec, _deltaSec, pointer) => {
        const d = dioramaRef.current;
        if (!d) return;

        // Isometric 3/4 Dollhouse rotation + drag orbit + hover parallax
        const baseIsoYaw = -0.22;
        const hoverYaw = pointer.hovered ? pointer.localX * 0.14 : 0;
        const hoverPitch = pointer.hovered ? -pointer.localY * 0.06 : 0;
        d.root.rotation.y = baseIsoYaw + hoverYaw + pointer.orbitYaw;
        d.root.rotation.x = hoverPitch + pointer.orbitPitch;

        camera.position.set(0.58, 2.28, 3.92);
        camera.lookAt(0, 0.58, 0);

        // Animate Resident Character (`working`, `walking`, or `resting`)
        const resRig = d.residentRig;
        if (d.motion === "walking") {
          resRig.options.motion = "walking";
          animateCharacterRig3D(resRig, elapsedSec, pointer);
          // Pace smoothly across the room floor between x = -0.35 and x = +0.95
          const cycle = (elapsedSec * 0.18) % 1;
          const pingPong = cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2;
          const dir = cycle < 0.5 ? -1 : 1;
          resRig.root.position.x = 0.85 - pingPong * 1.2;
          resRig.root.rotation.y = dir * 0.95;
        } else if (d.motion === "resting") {
          resRig.options.motion = "resting";
          animateCharacterRig3D(resRig, elapsedSec, pointer);
        } else {
          resRig.options.motion = "working";
          animateCharacterRig3D(resRig, elapsedSec, pointer);
          resRig.root.rotation.y = -0.25 + (pointer.hovered ? pointer.localX * 0.2 : 0);
        }

        // Animate Visitor
        if (d.visitorRig) {
          animateCharacterRig3D(d.visitorRig, elapsedSec, pointer);
        }

        // Animate Sub-Agent Guests
        for (const g of d.guestRigs) {
          animateCharacterRig3D(g.rig, elapsedSec + g.phase, pointer);
        }

        // Animate 3D Pets
        for (const p of d.petMeshes) {
          const t = elapsedSec * 2.5 + p.pet.index;
          if (p.pet.state === "asleep") {
            p.grp.scale.set(1, 0.92 + Math.sin(t * 0.8) * 0.05, 1);
          } else {
            p.grp.position.y = Math.abs(Math.sin(t * 1.6)) * 0.03;
            p.grp.rotation.y = Math.sin(t * 1.2) * 0.18;
          }
        }
      }}
    />
  );
}

export function buildRoomDiorama3D(
  props: ThreeRoomDioramaViewProps,
  lampLight: THREE.PointLight,
): RoomDioramaRig3D {
  const {
    card,
    roomKind,
    palette,
    moodPalette,
    tod,
    isDark,
    roomState,
    achievements,
    temporal,
    containerContents,
    pets,
    guests,
    hasRecentUserMessage,
    motion,
    stylePreset,
    clothing,
    accessories,
  } = props;

  const root = new THREE.Group();
  const woodTex = getWoodPlankTexture();
  const marbleTex = getMarbleFloorTexture();
  const plasterTex = getPlasterWallTexture();
  const fabricTex = getFabricWeaveTexture();

  // Room dimensions in 3D space (mapped to match 360x220 perspective)
  const roomW = 4.1;
  const roomH = 2.15;
  const roomD = 2.35;
  const backZ = -roomD * 0.48;
  const frontZ = roomD * 0.48;
  const wallThick = 0.14;

  // 1. The Sims L-Corner Cutaway Walls with Architectural Cross-Section Trim
  const wallColor = new THREE.Color(
    `hsl(${moodPalette.wallH}, ${moodPalette.wallS}%, ${isDark ? Math.max(24, moodPalette.wallBottomL - 16) : moodPalette.wallL}%)`,
  );
  const wallMat = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.78,
    map: plasterTex ?? null,
    bumpMap: plasterTex ?? null,
    bumpScale: 0.01,
  });
  const cutawayCapMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(isDark ? "#94a3b8" : "#f8fafc"),
    roughness: 0.45,
  });
  const subFloorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(isDark ? "#1e293b" : "#475569"),
    roughness: 0.85,
  });

  // Back full-height wall + cutaway top cross-section cap
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(roomW + wallThick, roomH, wallThick),
    wallMat,
  );
  backWall.position.set(0, roomH * 0.5, backZ);
  const backCap = new THREE.Mesh(
    new THREE.BoxGeometry(roomW + wallThick + 0.02, 0.04, wallThick + 0.02),
    cutawayCapMat,
  );
  backCap.position.set(0, roomH + 0.02, backZ);
  root.add(backWall, backCap);

  // Left full-height wall (forming The Sims L-corner cutaway on the left-back)
  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThick, roomH, roomD),
    wallMat,
  );
  leftWall.position.set(-roomW * 0.5, roomH * 0.5, 0);
  const leftCap = new THREE.Mesh(
    new THREE.BoxGeometry(wallThick + 0.02, 0.04, roomD + 0.02),
    cutawayCapMat,
  );
  leftCap.position.set(-roomW * 0.5, roomH + 0.02, 0);
  root.add(leftWall, leftCap);

  // Right stepped cutaway wall (tall at back corner, sliced down to Sims 0.22m half-wall in front)
  const rightBackStubD = roomD * 0.32;
  const rightWallTall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThick, roomH * 0.72, rightBackStubD),
    wallMat,
  );
  rightWallTall.position.set(
    roomW * 0.5,
    roomH * 0.36,
    backZ + rightBackStubD * 0.5,
  );
  const rightWallTallCap = new THREE.Mesh(
    new THREE.BoxGeometry(wallThick + 0.02, 0.04, rightBackStubD + 0.02),
    cutawayCapMat,
  );
  rightWallTallCap.position.set(
    roomW * 0.5,
    roomH * 0.72 + 0.02,
    backZ + rightBackStubD * 0.5,
  );
  root.add(rightWallTall, rightWallTallCap);

  // Low cutaway lip along Front & Right edges (signature Sims cutaway wall rim)
  const lipH = 0.18;
  const frontLip = new THREE.Mesh(
    new THREE.BoxGeometry(roomW + wallThick, lipH, wallThick * 0.85),
    wallMat,
  );
  frontLip.position.set(0, lipH * 0.5, frontZ);
  const frontLipCap = new THREE.Mesh(
    new THREE.BoxGeometry(roomW + wallThick + 0.02, 0.035, wallThick * 0.9),
    cutawayCapMat,
  );
  frontLipCap.position.set(0, lipH + 0.018, frontZ);
  root.add(frontLip, frontLipCap);

  const rightLipD = roomD - rightBackStubD;
  const rightLip = new THREE.Mesh(
    new THREE.BoxGeometry(wallThick * 0.85, lipH, rightLipD),
    wallMat,
  );
  rightLip.position.set(
    roomW * 0.5,
    lipH * 0.5,
    backZ + rightBackStubD + rightLipD * 0.5,
  );
  const rightLipCap = new THREE.Mesh(
    new THREE.BoxGeometry(wallThick * 0.9, 0.035, rightLipD + 0.02),
    cutawayCapMat,
  );
  rightLipCap.position.set(
    roomW * 0.5,
    lipH + 0.018,
    backZ + rightBackStubD + rightLipD * 0.5,
  );
  root.add(rightLip, rightLipCap);

  // Thick 3D Sims Dollhouse Foundation Pedestal beneath the floor
  const subFloor = new THREE.Mesh(
    new THREE.BoxGeometry(roomW + wallThick * 1.2, 0.24, roomD + wallThick * 1.2),
    subFloorMat,
  );
  subFloor.position.set(0, -0.16, 0);
  root.add(subFloor);

  // Wooden baseboard & wainscot molding
  const moldingMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#5a3e28"),
    roughness: 0.55,
    map: woodTex ?? null,
  });
  const baseboard = new THREE.Mesh(
    new THREE.BoxGeometry(roomW, 0.09, 0.1),
    moldingMat,
  );
  baseboard.position.set(0, 0.045, backZ + 0.05);
  root.add(baseboard);

  // 2. 3D Floor + The Sims Build/Live Mode Tile Grid Lines
  const isMarble = roomKind === "trophy" || roomKind === "reception";
  const floorMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(isMarble ? "#e8e6e1" : palette.floorNear),
    roughness: isMarble ? 0.22 : 0.54,
    metalness: isMarble ? 0.08 : 0.02,
    clearcoat: isMarble ? 0.4 : 0.16,
    map: (isMarble ? marbleTex : woodTex) ?? null,
    bumpMap: (isMarble ? marbleTex : woodTex) ?? null,
    bumpScale: 0.015,
  });
  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(roomW, 0.08, roomD),
    floorMat,
  );
  floorMesh.position.set(0, -0.04, 0);
  root.add(floorMesh);

  // Subtle Sims floor tile grid lines
  const gridMat = new THREE.MeshBasicMaterial({
    color: isDark ? 0x94a3b8 : 0x475569,
    transparent: true,
    opacity: 0.16,
  });
  for (let gx = -1.5; gx <= 1.5; gx += 0.6) {
    const lineX = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.004, roomD - 0.12),
      gridMat,
    );
    lineX.position.set(gx, 0.003, 0);
    root.add(lineX);
  }
  for (let gz = -0.9; gz <= 0.9; gz += 0.6) {
    const lineZ = new THREE.Mesh(
      new THREE.BoxGeometry(roomW - 0.12, 0.004, 0.012),
      gridMat,
    );
    lineZ.position.set(0, 0.003, gz);
    root.add(lineZ);
  }

  // Area rug or Lv 9+ Red Carpet
  const rugMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(achievements.hasCarpet ? "#b91c1c" : palette.accent),
    roughness: 0.85,
    bumpMap: fabricTex ?? null,
    bumpScale: 0.02,
  });
  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, 0.018, 1.15),
    rugMat,
  );
  rug.position.set(0.25, 0.009, 0.18);
  root.add(rug);

  // 3. 3D Architectural Window on Back-Left Wall (x ≈ -1.15, y ≈ 1.42)
  const winGroup = new THREE.Group();
  winGroup.position.set(-1.12, 1.38, backZ + 0.05);

  const skyHex =
    tod === "night"
      ? 0x0f172a
      : tod === "evening"
        ? 0xf97316
        : tod === "morning"
          ? 0xfde68a
          : 0x7dd3fc;
  const winGlassMat = new THREE.MeshBasicMaterial({ color: skyHex });
  const winGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.72),
    winGlassMat,
  );
  winGroup.add(winGlass);

  // Sun / Moon orb inside window
  const luminaryMesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 16),
    new THREE.MeshBasicMaterial({
      color: tod === "night" ? 0xfef3c7 : 0xfde047,
    }),
  );
  luminaryMesh.position.set(tod === "morning" ? -0.24 : 0.22, 0.14, 0.005);
  winGroup.add(luminaryMesh);

  // Window frame & cross mullions
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xfaf6ec,
    roughness: 0.4,
  });
  const winFrameTop = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.05, 0.06), frameMat);
  winFrameTop.position.y = 0.37;
  const winFrameBot = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.06, 0.09), frameMat);
  winFrameBot.position.y = -0.37;
  const winMullionV = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.72, 0.04), frameMat);
  const winMullionH = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.035, 0.04), frameMat);
  winGroup.add(winFrameTop, winFrameBot, winMullionV, winMullionH);

  // Velvet curtains on left & right of window
  const curtainMat = new THREE.MeshStandardMaterial({
    color: 0xb93838,
    roughness: 0.75,
    bumpMap: fabricTex ?? null,
    bumpScale: 0.015,
  });
  for (const side of [-1, 1] as const) {
    const drape = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.085, 0.82, 10),
      curtainMat,
    );
    drape.position.set(side * 0.54, -0.02, 0.04);
    winGroup.add(drape);
  }
  root.add(winGroup);

  // 4. 3D Ceiling Pendant Lamp (x ≈ 0.95, y ≈ 2.05)
  const lampGrp = new THREE.Group();
  lampGrp.position.set(0.95, 2.05, 0.15);
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.35, 8),
    moldingMat,
  );
  cord.position.y = 0.08;
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.16, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x4a3320,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  shade.position.y = -0.08;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffe9a5,
      emissive: 0xffd54f,
      emissiveIntensity: isDark ? 1.5 : 0.6,
    }),
  );
  bulb.position.y = -0.14;
  lampGrp.add(cord, shade, bulb);
  root.add(lampGrp);

  // 5. 3D Room-Specific Furniture
  buildRoomFurniture3D({
    root,
    roomKind,
    backZ,
    woodTex,
    fabricTex,
    roomState,
    achievements,
    temporal,
    containerContents,
  });

  // 6. 3D Pets on the Floor
  const petMeshes: RoomDioramaRig3D["petMeshes"] = [];
  for (let i = 0; i < Math.min(pets.length, 2); i++) {
    const pet = pets[i];
    if (!pet) continue;
    const petGrp = buildPet3D(pet);
    petGrp.position.set(-0.25 + i * 0.48, 0.02, 0.42);
    root.add(petGrp);
    petMeshes.push({ grp: petGrp, pet });
  }

  // 7. 3D Guest Sub-Agents
  const guestRigs: RoomDioramaRig3D["guestRigs"] = [];
  for (let i = 0; i < Math.min(guests.length, 3); i++) {
    const g = guests[i];
    if (!g) continue;
    const gParts = avatarPartsFromSeed(g.seed);
    const gExpr = getExpressionForMood("happy");
    const gRig = buildCharacterRig3D({
      parts: gParts,
      expression: gExpr,
      clothing: {
        shirt: `hsl(${g.hue}, 58%, 52%)`,
        shirtDark: `hsl(${g.hue}, 62%, 36%)`,
        accent: `hsl(${g.hue}, 75%, 75%)`,
      },
      mode: "full",
    });
    gRig.root.scale.setScalar(0.54);
    const gx = (g.cx / 360 - 0.5) * 3.2;
    const gz = -0.35 + (i % 2) * 0.28;
    gRig.root.position.set(gx, 0.01, gz);
    root.add(gRig.root);
    guestRigs.push({ rig: gRig, phase: g.phase, baseX: gx, baseZ: gz });
  }

  // 8. 3D Human Visitor (when user sent message in last 5m)
  let visitorRig: CharacterRig3D | null = null;
  if (hasRecentUserMessage) {
    const vParts = avatarPartsFromSeed(hashStringToInt("user-visitor"));
    const vExpr = getExpressionForMood("happy");
    visitorRig = buildCharacterRig3D({
      parts: vParts,
      expression: vExpr,
      clothing: {
        shirt: "hsl(28, 78%, 56%)",
        shirtDark: "hsl(24, 72%, 40%)",
        accent: "hsl(40, 85%, 78%)",
      },
      mode: "full",
    });
    visitorRig.root.scale.setScalar(0.64);
    visitorRig.root.position.set(-0.78, 0.01, 0.35);
    visitorRig.root.rotation.y = 0.32;
    root.add(visitorRig.root);
  }

  // 9. 3D Resident Avatar (`RoomAvatar`)
  const resParts = avatarPartsFromSeed(card.avatarSeed, card.stage.key);
  const resExpr = getExpressionForMood(card.mood.key);
  const residentRig = buildCharacterRig3D({
    parts: resParts,
    expression: resExpr,
    clothing,
    stylePreset,
    mode: "full",
    motion:
      motion === "working"
        ? "working"
        : motion === "walking"
          ? "walking"
          : "resting",
    glasses: accessories.glasses,
    mustache: accessories.mustache,
    beard: accessories.beard,
    earring: accessories.earring,
    scarf: accessories.scarf,
    hat: accessories.hat,
    crown: accessories.crown,
  });
  residentRig.root.scale.setScalar(0.68);
  residentRig.root.position.set(0.55, 0.01, 0.38);
  residentRig.root.rotation.y = -0.25;
  root.add(residentRig.root);

  return {
    root,
    residentRig,
    visitorRig,
    guestRigs,
    petMeshes,
    lampLight,
    motion,
  };
}

function buildRoomFurniture3D({
  root,
  roomKind,
  backZ,
  woodTex,
  fabricTex,
  roomState,
  achievements,
  temporal,
  containerContents,
}: {
  root: THREE.Group;
  roomKind: RoomKind;
  backZ: number;
  woodTex: THREE.CanvasTexture | null;
  fabricTex: THREE.CanvasTexture | null;
  roomState: RoomState;
  achievements: AchievementBundle;
  temporal: TemporalDecor;
  containerContents: ContainerContents;
}) {
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x5c3d24,
    roughness: 0.55,
    map: woodTex ?? null,
  });
  const warmWoodMat = new THREE.MeshStandardMaterial({
    color: 0x8c6239,
    roughness: 0.5,
    map: woodTex ?? null,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.7,
    roughness: 0.3,
  });

  // A. Bookshelf on back-left / center-left wall
  const showBookshelf =
    roomKind === "library" ||
    roomKind === "workshop" ||
    roomKind === "study" ||
    roomKind === "reception";
  if (showBookshelf) {
    const shelfGrp = new THREE.Group();
    shelfGrp.position.set(-0.22, 0.52, backZ + 0.18);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 1.04, 0.24),
      darkWoodMat,
    );
    shelfGrp.add(frame);

    const bookCount = Math.min(12, Math.max(4, containerContents.bookCount));
    for (let i = 0; i < bookCount; i++) {
      const row = Math.floor(i / 4);
      const col = i % 4;
      const hue =
        containerContents.bookHues[i % Math.max(1, containerContents.bookHues.length)] ??
        (i * 47) % 360;
      const bookMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(`hsl(${hue}, 65%, 48%)`),
        roughness: 0.5,
      });
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.2, 0.18),
        bookMat,
      );
      book.position.set(-0.18 + col * 0.11, 0.32 - row * 0.3, 0.04);
      shelfGrp.add(book);
    }
    root.add(shelfGrp);
  }

  // B. Fridge for `living` / `nursery`
  if (roomKind === "living" || roomKind === "nursery") {
    const fridgeGrp = new THREE.Group();
    fridgeGrp.position.set(-0.28, 0.52, backZ + 0.22);
    const fridgeMat = new THREE.MeshPhysicalMaterial({
      color: 0xe2e8f0,
      roughness: 0.25,
      metalness: 0.2,
      clearcoat: 0.5,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.04, 0.36), fridgeMat);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.28, 0.04), metalMat);
    handle.position.set(0.18, 0.12, 0.19);
    fridgeGrp.add(body, handle);
    root.add(fridgeGrp);
  }

  // C. Workstation Desk + Monitor + Chair (for workshop / study / library)
  if (roomKind === "workshop" || roomKind === "study" || roomKind === "library") {
    const deskGrp = new THREE.Group();
    deskGrp.position.set(1.05, 0, -0.25);

    const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.52), warmWoodMat);
    top.position.y = 0.52;
    deskGrp.add(top);

    for (const sx of [-0.42, 0.42]) {
      for (const sz of [-0.2, 0.2]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.52, 8),
          metalMat,
        );
        leg.position.set(sx, 0.26, sz);
        deskGrp.add(leg);
      }
    }

    // 3D Widescreen Monitor on stand
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.14, 10), metalMat);
    stand.position.set(0, 0.6, -0.08);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.03), metalMat);
    bezel.position.set(0, 0.76, -0.08);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.47, 0.29),
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        emissive: 0x1e3a8a,
        emissiveIntensity: 0.85,
        roughness: 0.15,
      }),
    );
    screen.position.set(0, 0.76, -0.062);
    deskGrp.add(stand, bezel, screen);
    root.add(deskGrp);
  } else {
    // Plush 3D Sofa & Coffee Table (for living / reception / nursery / trophy)
    const sofaGrp = new THREE.Group();
    sofaGrp.position.set(1.0, 0, -0.32);
    const sofaMat = new THREE.MeshStandardMaterial({
      color: 0x3b6e8c,
      roughness: 0.78,
      bumpMap: fabricTex ?? null,
      bumpScale: 0.015,
    });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.24, 0.48), sofaMat);
    seat.position.y = 0.16;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.38, 0.14), sofaMat);
    back.position.set(0, 0.38, -0.18);
    for (const side of [-1, 1] as const) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.5), sofaMat);
      arm.position.set(side * 0.48, 0.24, 0);
      sofaGrp.add(arm);
    }
    sofaGrp.add(seat, back);
    root.add(sofaGrp);
  }

  // D. 4-Stage Growing 3D Potted Plant (Left foreground/corner)
  const plantGrp = new THREE.Group();
  plantGrp.position.set(-1.38, 0, 0.22);
  const potMat = new THREE.MeshStandardMaterial({
    color: 0xb85d38,
    roughness: 0.7,
  });
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.1, 0.22, 12),
    potMat,
  );
  pot.position.y = 0.11;
  plantGrp.add(pot);

  const foliageColor = roomState.plantsWilted
    ? 0x7c5836
    : roomState.plantStage >= 2
      ? 0x2e7d32
      : 0x4caf50;
  const leafMat = new THREE.MeshStandardMaterial({
    color: foliageColor,
    roughness: 0.65,
  });
  const scaleBump = 0.65 + roomState.plantStage * 0.28;
  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(0.18 * scaleBump, 12, 10),
    leafMat,
  );
  crown.position.y = 0.26 + roomState.plantStage * 0.08;
  if (roomState.plantsWilted) {
    crown.position.x = 0.06;
    crown.scale.set(1.1, 0.65, 1);
  }
  plantGrp.add(crown);
  root.add(plantGrp);

  // E. 3D Trophy & Crown Pedestal (when achieved)
  if (achievements.hasTrophy || achievements.hasCrown) {
    const pedGrp = new THREE.Group();
    pedGrp.position.set(-0.85, 0, -0.42);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 0.42, 14),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3 }),
    );
    pillar.position.y = 0.21;
    pedGrp.add(pillar);

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd54f,
      metalness: 0.9,
      roughness: 0.15,
      emissive: 0x785200,
      emissiveIntensity: 0.3,
    });
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.04, 0.18, 14),
      goldMat,
    );
    cup.position.y = 0.52;
    pedGrp.add(cup);
    root.add(pedGrp);
  }

  // F. Christmas Tree (December)
  if (temporal.isChristmas) {
    const treeGrp = new THREE.Group();
    treeGrp.position.set(1.52, 0, 0.28);
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.24 - i * 0.05, 0.32, 10),
        pineMat,
      );
      cone.position.y = 0.25 + i * 0.18;
      treeGrp.add(cone);
    }
    root.add(treeGrp);
  }
}

function buildPet3D(pet: Pet): THREE.Group {
  const grp = new THREE.Group();
  const colorHex =
    pet.kind === "cat"
      ? 0xf59e0b
      : pet.kind === "dog"
        ? 0xa16207
        : pet.kind === "bird"
          ? 0x38bdf8
          : 0xfbbf24;
  const furMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.65,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), furMat);
  body.scale.set(1.25, 0.85, 0.9);
  body.position.y = 0.08;
  grp.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), furMat);
  head.position.set(0.08, 0.15, 0.03);
  grp.add(head);

  // Ears
  for (const s of [-1, 1] as const) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.055, 6), furMat);
    ear.position.set(0.08, 0.22, 0.03 + s * 0.045);
    grp.add(ear);
  }

  return grp;
}

// ---------------------------------------------------------------------------
// 3. ThreeSimCityStage — Full-Stage 3D SimCity Isometric City & Park Diorama
// ---------------------------------------------------------------------------

export interface ThreeSimCityStageProps {
  width: number;
  height: number;
  tod: TimeOfDay;
  weather: WeatherKind;
  season: "spring" | "summer" | "autumn" | "winter";
  cols: number;
  rows: number;
  hasPark: boolean;
}

export interface SimCityWorldRig3D {
  root: THREE.Group;
  vehicles: {
    grp: THREE.Group;
    axis: "x" | "z";
    coord: number;
    dir: 1 | -1;
    speed: number;
    phase: number;
    span: number;
  }[];
  fountainJets: THREE.Mesh[];
  clouds: { grp: THREE.Group; baseX: number; speed: number }[];
  waterMesh: THREE.Mesh;
}

export function ThreeSimCityStage({
  width,
  height,
  tod,
  weather,
  season,
  cols,
  rows,
  hasPark,
}: ThreeSimCityStageProps) {
  const worldRef = useRef<SimCityWorldRig3D | null>(null);
  const isNight = tod === "night" || tod === "evening";

  const sceneKey = [
    tod,
    weather,
    season,
    cols,
    rows,
    hasPark ? "park" : "nopark",
  ].join(":");

  return (
    <ThreeStageCanvas
      width={Math.max(320, width)}
      height={Math.max(220, height)}
      fov={32}
      fpsCap={26}
      sceneKey={sceneKey}
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%" }}
      setupScene={(scene, camera) => {
        // Atmospheric fog for SimCity depth
        const fogColor =
          tod === "night"
            ? 0x0f172a
            : tod === "evening"
              ? 0x3b2d4a
              : weather === "stormy"
                ? 0x475569
                : 0xcbe7ff;
        scene.fog = new THREE.FogExp2(fogColor, 0.032);

        const hemi = new THREE.HemisphereLight(
          isNight ? 0x64748b : 0xfff8eb,
          isNight ? 0x0f172a : 0x2f5228,
          isNight ? 0.85 : 1.45,
        );
        scene.add(hemi);

        const sunLight = new THREE.DirectionalLight(
          tod === "evening" ? 0xff9e6d : isNight ? 0x93c5fd : 0xfff4d6,
          isNight ? 1.05 : 1.95,
        );
        sunLight.position.set(-6.5, 9.5, 6.2);
        scene.add(sunLight);

        const world = buildSimCityWorld3D({
          tod,
          weather,
          season,
          cols: Math.max(2, Math.min(6, cols)),
          rows: Math.max(1, Math.min(4, rows)),
          hasPark,
        });
        worldRef.current = world;
        scene.add(world.root);

        // Elevated SimCity isometric-style overview camera
        camera.position.set(0, 7.6, 11.4);
        camera.lookAt(0, -0.35, -0.4);
      }}
      onFrame={(_scene, _camera, elapsedSec) => {
        const w = worldRef.current;
        if (!w) return;

        // Animate 3D SimCity street traffic (cars & buses)
        for (const v of w.vehicles) {
          const t = ((elapsedSec * v.speed + v.phase) % 1) * 2 - 1; // -1 .. +1
          const pos = t * v.span * v.dir;
          if (v.axis === "x") {
            v.grp.position.x = pos;
            v.grp.position.z = v.coord;
            v.grp.rotation.y = v.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          } else {
            v.grp.position.x = v.coord;
            v.grp.position.z = pos;
            v.grp.rotation.y = v.dir > 0 ? 0 : Math.PI;
          }
        }

        // Animate Central Park fountain water jets
        for (let i = 0; i < w.fountainJets.length; i++) {
          const jet = w.fountainJets[i];
          if (!jet) continue;
          const s = 0.78 + Math.sin(elapsedSec * 6.5 + i * 1.4) * 0.25;
          jet.scale.set(1, s, 1);
        }

        // Animate drifting 3D clouds
        for (const c of w.clouds) {
          const offset = ((elapsedSec * c.speed) % 18) - 9;
          c.grp.position.x = c.baseX + offset * 0.25;
        }

        // Subtle canal water shimmer
        w.waterMesh.position.y = 0.04 + Math.sin(elapsedSec * 2.2) * 0.008;
      }}
    />
  );
}

export function buildSimCityWorld3D({
  tod,
  season,
  cols,
  rows,
  hasPark,
}: {
  tod: TimeOfDay;
  weather: WeatherKind;
  season: "spring" | "summer" | "autumn" | "winter";
  cols: number;
  rows: number;
  hasPark: boolean;
}): SimCityWorldRig3D {
  const root = new THREE.Group();
  const isNight = tod === "night" || tod === "evening";
  const grassTex = getGrassLawnTexture();

  const boardW = 15.6;
  const boardD = 9.6;

  // 1. Elevated 3D SimCity Terrain Table & Bevelled Bedrock Cliff Rim
  const bedrockMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x1e293b : 0x475569,
    roughness: 0.9,
  });
  const soilMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x3b2f26 : 0x6b4f3a,
    roughness: 0.88,
  });
  const grassColor =
    season === "winter"
      ? isNight
        ? 0x475569
        : 0xdbeafe
      : season === "autumn"
        ? isNight
          ? 0x3f4e38
          : 0x659b47
        : isNight
          ? 0x264634
          : 0x4ca848;
  const grassMat = new THREE.MeshStandardMaterial({
    color: grassColor,
    roughness: 0.86,
    map: grassTex ?? null,
  });

  const bedrock = new THREE.Mesh(
    new THREE.BoxGeometry(boardW + 0.4, 0.45, boardD + 0.4),
    bedrockMat,
  );
  bedrock.position.set(0, -0.45, 0);
  const soilLayer = new THREE.Mesh(
    new THREE.BoxGeometry(boardW + 0.16, 0.22, boardD + 0.16),
    soilMat,
  );
  soilLayer.position.set(0, -0.14, 0);
  const terrainTop = new THREE.Mesh(
    new THREE.BoxGeometry(boardW, 0.12, boardD),
    grassMat,
  );
  terrainTop.position.set(0, 0, 0);
  root.add(bedrock, soilLayer, terrainTop);

  // 2. SimCity Zoned City Grid (Asphalt Roads, Sidewalks, Dashed Lines, Crosswalks)
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x1e293b : 0x2d3748,
    roughness: 0.88,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x64748b : 0xcbd5e1,
    roughness: 0.78,
  });
  const yellowDashMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
  });
  const whiteStripeMat = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
  });
  const rZoneMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x2f5e41 : 0x5bbd56,
    roughness: 0.82,
  });

  // Horizontal avenues
  const hRoadCoords: number[] = [];
  const activeStartZ = -3.0;
  const activeEndZ = hasPark ? 1.35 : 2.8;
  const rCount = Math.max(1, rows);
  for (let r = 0; r <= rCount; r++) {
    const rz = activeStartZ + (r / rCount) * (activeEndZ - activeStartZ);
    hRoadCoords.push(rz);

    const sidewalkStrip = new THREE.Mesh(
      new THREE.BoxGeometry(boardW - 0.4, 0.035, 0.56),
      sidewalkMat,
    );
    sidewalkStrip.position.set(0, 0.065, rz);
    const roadStrip = new THREE.Mesh(
      new THREE.BoxGeometry(boardW - 0.3, 0.042, 0.38),
      asphaltMat,
    );
    roadStrip.position.set(0, 0.068, rz);
    root.add(sidewalkStrip, roadStrip);

    // Yellow center dashes
    for (let dx = -boardW * 0.44; dx <= boardW * 0.44; dx += 0.65) {
      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.006, 0.025),
        yellowDashMat,
      );
      dash.position.set(dx, 0.092, rz);
      root.add(dash);
    }
  }

  // Vertical streets
  const vRoadCoords: number[] = [];
  const cCount = Math.max(2, cols);
  const startX = -boardW * 0.42;
  const endX = boardW * 0.42;
  for (let c = 0; c <= cCount; c++) {
    const cx = startX + (c / cCount) * (endX - startX);
    vRoadCoords.push(cx);

    const sidewalkStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.034, boardD - 0.5),
      sidewalkMat,
    );
    sidewalkStrip.position.set(cx, 0.064, 0);
    const roadStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.044, boardD - 0.4),
      asphaltMat,
    );
    roadStrip.position.set(cx, 0.069, 0);
    root.add(sidewalkStrip, roadStrip);

    // Crosswalk stripes at intersections + R-Zone residential lot pads
    for (let r = 0; r < hRoadCoords.length; r++) {
      const rz = hRoadCoords[r]!;
      for (let s = -1; s <= 1; s += 2) {
        const cw = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.008, 0.04),
          whiteStripeMat,
        );
        cw.position.set(cx, 0.093, rz + s * 0.24);
        root.add(cw);
      }

      // Zoned residential lot pad inside each city block
      if (c < cCount && r < hRoadCoords.length - 1) {
        const nextX = vRoadCoords[c]! + (endX - startX) / cCount;
        const nextZ = hRoadCoords[r + 1]!;
        const padW = Math.max(0.6, Math.abs(nextX - cx) - 0.68);
        const padD = Math.max(0.5, Math.abs(nextZ - rz) - 0.68);
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(padW, 0.025, padD),
          rZoneMat,
        );
        pad.position.set((cx + nextX) * 0.5, 0.065, (rz + nextZ) * 0.5);
        root.add(pad);
      }
    }
  }

  // 3. 3D Waterfront River / Canal & Arch Bridge (Separating Active City & Park)
  const canalZ = hasPark ? 2.15 : 3.65;
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: isNight ? 0x0284c7 : 0x0ea5e9,
    roughness: 0.12,
    metalness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const waterMesh = new THREE.Mesh(
    new THREE.BoxGeometry(boardW - 0.1, 0.08, 0.68),
    waterMat,
  );
  waterMesh.position.set(0, 0.04, canalZ);
  root.add(waterMesh);

  // Stone canal embankments & central arch bridge
  const bridgeDeck = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.08, 0.86),
    sidewalkMat,
  );
  bridgeDeck.position.set(0, 0.14, canalZ);
  root.add(bridgeDeck);
  for (const sx of [-0.52, 0.52]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.16, 0.88),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 }),
    );
    rail.position.set(sx, 0.22, canalZ);
    root.add(rail);
  }

  // 4. 3D Central Park Plaza & Tiered Water Fountain (in Park Zone)
  const fountainJets: THREE.Mesh[] = [];
  if (hasPark) {
    const parkZ = 3.35;
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.2, 0.05, 24),
      sidewalkMat,
    );
    plaza.position.set(0, 0.07, parkZ);
    root.add(plaza);

    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.58, 0.16, 20),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35 }),
    );
    basin.position.set(0, 0.15, parkZ);
    const pool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.46, 0.14, 18),
      waterMat,
    );
    pool.position.set(0, 0.17, parkZ);
    const tier = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.24, 0.34, 14),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3 }),
    );
    tier.position.set(0, 0.28, parkZ);
    root.add(basin, pool, tier);

    const jetMat = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.8,
    });
    for (let j = 0; j < 4; j++) {
      const jet = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.32, 8),
        jetMat,
      );
      const angle = (j / 4) * Math.PI * 2;
      jet.position.set(
        Math.cos(angle) * 0.08,
        0.52,
        parkZ + Math.sin(angle) * 0.08,
      );
      root.add(jet);
      fountainJets.push(jet);
    }
  }

  // 5. Distant SimCity Downtown Skyline Towers & Mountains along Horizon (z = -4.2)
  const towerMat = new THREE.MeshPhysicalMaterial({
    color: isNight ? 0x1e293b : 0x64748b,
    emissive: isNight ? 0x0f172a : 0x000000,
    roughness: 0.25,
    metalness: 0.55,
    clearcoat: 0.6,
  });
  const towerPositions = [-5.8, -4.6, -3.5, 3.6, 4.8, 5.9];
  for (let i = 0; i < towerPositions.length; i++) {
    const tx = towerPositions[i]!;
    const th = 1.2 + ((i * 37) % 10) * 0.14;
    const tw = 0.52 + (i % 2) * 0.16;
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(tw, th, 0.52),
      towerMat,
    );
    tower.position.set(tx, th * 0.5, -4.15);
    root.add(tower);
  }

  // Sculpted 3D mountain peaks behind horizon
  const mtnMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x1e293b : 0x4b6b58,
    roughness: 0.88,
    flatShading: true,
  });
  const snowCapMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x94a3b8 : 0xf8fafc,
    roughness: 0.6,
    flatShading: true,
  });
  for (const [mx, mr, mh] of [
    [-2.2, 1.35, 1.85],
    [-0.4, 1.65, 2.25],
    [1.6, 1.4, 1.95],
  ] as const) {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(mr, mh, 7), mtnMat);
    peak.position.set(mx, mh * 0.45, -4.35);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(mr * 0.36, mh * 0.36, 7),
      snowCapMat,
    );
    cap.position.set(mx, mh * 0.76, -4.35);
    root.add(peak, cap);
  }

  // Perimeter 3D City Trees
  const treeFoliageColor =
    season === "spring"
      ? 0xf472b6 // Sakura pink
      : season === "autumn"
        ? 0xea580c // Autumn maple
        : season === "winter"
          ? 0xe2e8f0
          : 0x2e7d32;
  const treeLeafMat = new THREE.MeshStandardMaterial({
    color: treeFoliageColor,
    roughness: 0.72,
  });
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x5c3d24,
    roughness: 0.85,
  });
  for (let i = 0; i < 16; i++) {
    const tx = -6.8 + i * 0.9;
    const tz = i % 2 === 0 ? -3.65 : hasPark ? 3.85 : 3.25;
    const tGrp = new THREE.Group();
    tGrp.position.set(tx, 0.06, tz);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.055, 0.24, 7),
      trunkMat,
    );
    trunk.position.y = 0.12;
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.48, 8),
      treeLeafMat,
    );
    crown.position.y = 0.38;
    tGrp.add(trunk, crown);
    root.add(tGrp);
  }

  // 6. Animated 3D SimCity Vehicles on Horizontal & Vertical Streets
  const vehicles: SimCityWorldRig3D["vehicles"] = [];
  const carHues = [0, 45, 140, 200, 260, 320];
  for (let i = 0; i < hRoadCoords.length; i++) {
    const rz = hRoadCoords[i]!;
    const car = buildMiniCar3D(carHues[i % carHues.length]!, isNight);
    car.scale.setScalar(0.58);
    car.position.set(0, 0.09, rz + (i % 2 === 0 ? 0.08 : -0.08));
    root.add(car);
    vehicles.push({
      grp: car,
      axis: "x",
      coord: rz + (i % 2 === 0 ? 0.08 : -0.08),
      dir: i % 2 === 0 ? 1 : -1,
      speed: 0.06 + (i % 3) * 0.015,
      phase: (i * 0.27) % 1,
      span: boardW * 0.45,
    });
  }
  for (let i = 0; i < Math.min(3, vRoadCoords.length); i++) {
    const vx = vRoadCoords[i]!;
    const car = buildMiniCar3D(carHues[(i + 2) % carHues.length]!, isNight);
    car.scale.setScalar(0.58);
    car.position.set(vx, 0.09, 0);
    root.add(car);
    vehicles.push({
      grp: car,
      axis: "z",
      coord: vx + (i % 2 === 0 ? 0.07 : -0.07),
      dir: i % 2 === 0 ? 1 : -1,
      speed: 0.075 + i * 0.012,
      phase: (i * 0.41) % 1,
      span: boardD * 0.42,
    });
  }

  // 7. 3D Volumetric Clouds in the Sky
  const clouds: SimCityWorldRig3D["clouds"] = [];
  const cloudMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x64748b : 0xffffff,
    roughness: 0.85,
    transparent: true,
    opacity: 0.88,
  });
  for (let c = 0; c < 4; c++) {
    const cGrp = new THREE.Group();
    const bx = -4.8 + c * 3.2;
    cGrp.position.set(bx, 2.85 + (c % 2) * 0.35, -3.5);
    for (let p = -1; p <= 1; p++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.28 - Math.abs(p) * 0.05, 10, 10),
        cloudMat,
      );
      puff.position.set(p * 0.24, p === 0 ? 0.06 : 0, 0);
      cGrp.add(puff);
    }
    root.add(cGrp);
    clouds.push({ grp: cGrp, baseX: bx, speed: 0.35 + c * 0.08 });
  }

  return {
    root,
    vehicles,
    fountainJets,
    clouds,
    waterMesh,
  };
}

