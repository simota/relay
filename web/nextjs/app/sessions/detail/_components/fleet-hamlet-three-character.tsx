"use client";

// Fleet Hamlet — Realistic 3D Articulated Character Engine (Three.js).
//
// Builds and animates a hierarchical 3D human character rig (`THREE.Group`)
// with physically-based skin shading, 3D eyeballs with irises/pupils/eyelids,
// sculpted 3D hair, 3D facial expressions, Open-Peeps-inspired 3D accessories,
// tailored 3D clothing (including Taisho-Wagara haori & Occult-Academy cape),
// and full skeletal joint animations (breathing, blinking, 3D cursor gaze,
// waving, arm-crossing, walking stride, desk typing, sitting, and sleeping).

import { useRef } from "react";
import * as THREE from "three";
import type { AvatarParts } from "../_lib/fleet-hamlet";
import type {
  AvatarExpression,
  BrowShape,
  EyeShape,
  MouthShape,
} from "../_lib/fleet-hamlet-avatar-expression";
import type {
  BeardKind,
  EarringKind,
  GlassesKind,
  MustacheKind,
  ScarfKind,
} from "../_lib/fleet-hamlet-particles";
import {
  ThreeStageCanvas,
  getFabricWeaveTexture,
  type StagePointerState,
} from "./fleet-hamlet-three-stage";

// ---------------------------------------------------------------------------
// Shared Types
// ---------------------------------------------------------------------------

export interface CharacterClothingColors {
  shirt: string;
  shirtDark: string;
  accent: string;
}

export type CharacterStylePreset = "default" | "taisho-wagara" | "occult-academy";

export type CharacterMotionMode =
  | "idle"
  | "walking"
  | "working"
  | "sitting"
  | "resting";

export type CharacterRenderMode = "full" | "head" | "body" | "portrait" | "bust";

export interface CharacterBuildOptions {
  parts: AvatarParts;
  expression: AvatarExpression;
  clothing?: CharacterClothingColors;
  stylePreset?: CharacterStylePreset;
  mode?: CharacterRenderMode;
  motion?: CharacterMotionMode;
  enableBlink?: boolean;
  enableBreathe?: boolean;
  enableCheeks?: boolean;
  enableEyeTrack?: boolean;
  glasses?: GlassesKind;
  mustache?: MustacheKind;
  beard?: BeardKind;
  earring?: EarringKind;
  scarf?: ScarfKind;
  hat?: "scholar" | "cap" | "tophat" | "none";
  crown?: boolean;
  /** Show The Sims 3D floating Plumbob diamond crystal above the head. */
  showPlumbob?: boolean;
  /** Optional ground shadow disc under feet. Default true for full/portrait. */
  showGroundShadow?: boolean;
}

export interface CharacterRig3D {
  root: THREE.Group;
  hips: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  leftEyeBall: THREE.Group;
  rightEyeBall: THREE.Group;
  leftUpperLid: THREE.Mesh;
  rightUpperLid: THREE.Mesh;
  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  rightHip: THREE.Group;
  rightKnee: THREE.Group;
  sweatDrop: THREE.Group | null;
  zzzGroup: THREE.Group | null;
  thinkDots: THREE.Mesh[];
  plumbobGroup: THREE.Group | null;
  options: CharacterBuildOptions;
  footY: number;
  headCenterY: number;
}

/**
 * Builds the iconic faceted 12-sided hexagonal bipyramid Sims Plumbob crystal
 * in Three.js with inner core glow and specular clearcoat facets.
 */
export function buildSimsPlumbob3D(
  radius = 0.095,
  moodState: "emerald" | "amber" | "crimson" | "aqua" = "emerald",
): THREE.Group {
  const grp = new THREE.Group();

  const palette =
    moodState === "crimson"
      ? { color: 0xff3b30, emissive: 0xd9261c, core: 0xffb4a8 }
      : moodState === "amber"
        ? { color: 0xfacc15, emissive: 0xca8a04, core: 0xfef08a }
        : moodState === "aqua"
          ? { color: 0x38bdf8, emissive: 0x0284c7, core: 0xbae6fd }
          : { color: 0x22e55e, emissive: 0x15803d, core: 0xbbf7d0 };

  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: palette.color,
    emissive: palette.emissive,
    emissiveIntensity: 0.52,
    roughness: 0.14,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    flatShading: true,
    transparent: true,
    opacity: 0.92,
  });

  const halfH = radius * 1.38;
  const topConeGeo = new THREE.ConeGeometry(radius, halfH, 6);
  topConeGeo.translate(0, halfH * 0.5, 0);
  const topCone = new THREE.Mesh(topConeGeo, crystalMat);

  const botConeGeo = new THREE.ConeGeometry(radius, halfH, 6);
  botConeGeo.rotateX(Math.PI);
  botConeGeo.translate(0, -halfH * 0.5, 0);
  const botCone = new THREE.Mesh(botConeGeo, crystalMat);

  // Inner luminous core
  const coreMat = new THREE.MeshBasicMaterial({
    color: palette.core,
    transparent: true,
    opacity: 0.85,
  });
  const coreMesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(radius * 0.48, 0),
    coreMat,
  );
  coreMesh.scale.set(0.8, 1.35, 0.8);

  // Subtle equatorial facet rim
  const rimMat = new THREE.MeshBasicMaterial({
    color: palette.core,
    transparent: true,
    opacity: 0.55,
  });
  const rimMesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.96, radius * 0.045, 6, 6),
    rimMat,
  );
  rimMesh.rotation.x = Math.PI / 2;

  grp.add(topCone, botCone, coreMesh, rimMesh);
  return grp;
}

// ---------------------------------------------------------------------------
// 3D Character Rig Builder
// ---------------------------------------------------------------------------

export function buildCharacterRig3D(options: CharacterBuildOptions): CharacterRig3D {
  const {
    parts,
    expression,
    clothing = {
      shirt: "hsl(210, 50%, 50%)",
      shirtDark: "hsl(210, 55%, 35%)",
      accent: "hsl(210, 70%, 75%)",
    },
    stylePreset = "default",
    mode = "full",
    enableCheeks = true,
    glasses = "none",
    mustache = "none",
    beard = "none",
    earring = "none",
    scarf = "none",
    hat = "none",
    crown = false,
    showGroundShadow = mode === "full",
  } = options;

  const root = new THREE.Group();
  const hips = new THREE.Group();
  const chest = new THREE.Group();
  const neck = new THREE.Group();
  const head = new THREE.Group();

  // Derive realistic proportions from toushin (`parts.headRatio`).
  // We clamp so chibi (3.0) through adult (7.5) read as cohesive 3D humans.
  const rawRatio = parts.headRatio > 0 ? parts.headRatio : 5.5;
  const toushin = Math.max(3.6, Math.min(7.5, rawRatio));
  const proportionFactor = (toushin - 3.6) / (7.5 - 3.6); // 0 = chibi, 1 = tall adult

  const headR = 0.36 - proportionFactor * 0.06; // 0.36 .. 0.30
  const torsoH = 0.52 + proportionFactor * 0.24; // 0.52 .. 0.76
  const torsoW = 0.42 + proportionFactor * 0.08; // 0.42 .. 0.50
  const torsoD = 0.24 + proportionFactor * 0.04;
  const legLen = 0.46 + proportionFactor * 0.30; // 0.46 .. 0.76
  const armLen = 0.40 + proportionFactor * 0.22;
  const neckH = headR * 0.32;

  // Materials
  const skinColor = new THREE.Color(`hsl(${parts.skinHue}, 48%, 74%)`);
  const skinShadowColor = new THREE.Color(`hsl(${parts.skinHue}, 52%, 60%)`);
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: skinColor,
    roughness: 0.5,
    metalness: 0.02,
    clearcoat: 0.08,
    clearcoatRoughness: 0.45,
    sheen: 0.25,
    sheenColor: new THREE.Color(`hsl(${parts.cheekHue}, 65%, 75%)`),
  });
  const lipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${parts.cheekHue}, 52%, 54%)`),
    roughness: 0.38,
  });

  const hairColor = new THREE.Color(`hsl(${parts.hairHue}, 52%, 28%)`);
  const hairHighlightColor = new THREE.Color(`hsl(${parts.hairHue}, 58%, 42%)`);
  const hairMat = new THREE.MeshPhysicalMaterial({
    color: hairColor,
    roughness: 0.38,
    metalness: 0.08,
    clearcoat: 0.18,
    clearcoatRoughness: 0.32,
    sheen: 0.35,
    sheenColor: hairHighlightColor,
  });

  const fabricBump = getFabricWeaveTexture();
  const shirtMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(clothing.shirt),
    roughness: 0.68,
    metalness: 0.04,
    bumpMap: fabricBump ?? null,
    bumpScale: 0.008,
  });
  const shirtDarkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(clothing.shirtDark),
    roughness: 0.72,
    metalness: 0.05,
    bumpMap: fabricBump ?? null,
    bumpScale: 0.008,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(clothing.accent),
    roughness: 0.45,
    metalness: 0.12,
  });
  const trouserMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#3b3028"),
    roughness: 0.74,
    metalness: 0.04,
    bumpMap: fabricBump ?? null,
    bumpScale: 0.006,
  });
  const shoeMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#1e1511"),
    roughness: 0.32,
    metalness: 0.12,
    clearcoat: 0.35,
  });

  // Vertical layout coordinates:
  // Feet rest at y = 0.
  const shoeH = 0.09;
  const hipsY = shoeH + legLen;
  const chestY = torsoH * 0.42;
  const neckBaseY = torsoH * 0.58;
  const headCenterY = hipsY + chestY + neckBaseY + neckH + headR * 0.92;

  hips.position.set(0, hipsY, 0);
  chest.position.set(0, chestY, 0);
  neck.position.set(0, neckBaseY, 0);
  head.position.set(0, neckH + headR * 0.88, 0);

  root.add(hips);
  hips.add(chest);
  chest.add(neck);
  neck.add(head);

  // Ground shadow
  if (showGroundShadow && mode !== "head") {
    const shadowGeo = new THREE.CircleGeometry(torsoW * 0.95, 24);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x080a0f,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.set(0, 0.005, 0);
    root.add(shadowMesh);
  }

  // -------------------------------------------------------------------------
  // 1. Legs & Shoes
  // -------------------------------------------------------------------------
  const leftHip = new THREE.Group();
  const leftKnee = new THREE.Group();
  const rightHip = new THREE.Group();
  const rightKnee = new THREE.Group();

  const hipOffsetX = torsoW * 0.24;
  const thighLen = legLen * 0.52;
  const calfLen = legLen * 0.48;
  const legRadius = torsoW * 0.145;

  leftHip.position.set(-hipOffsetX, 0, 0);
  rightHip.position.set(hipOffsetX, 0, 0);
  leftKnee.position.set(0, -thighLen, 0);
  rightKnee.position.set(0, -thighLen, 0);

  leftHip.add(leftKnee);
  rightHip.add(rightKnee);
  hips.add(leftHip);
  hips.add(rightHip);

  if (mode !== "head") {
    // Pelvis block
    const pelvisGeo = new THREE.CapsuleGeometry(torsoW * 0.36, torsoW * 0.18, 8, 16);
    pelvisGeo.rotateZ(Math.PI / 2);
    pelvisGeo.scale(1, 0.85, torsoD / (torsoW * 0.72));
    const pelvisMesh = new THREE.Mesh(pelvisGeo, trouserMat);
    pelvisMesh.position.set(0, 0.04, 0);
    hips.add(pelvisMesh);

    // Belt + metallic buckle
    const beltGeo = new THREE.CylinderGeometry(
      torsoW * 0.44,
      torsoW * 0.45,
      0.055,
      20,
    );
    beltGeo.scale(1, 1, torsoD / (torsoW * 0.88));
    const beltMesh = new THREE.Mesh(beltGeo, shoeMat);
    beltMesh.position.set(0, 0.12, 0);
    hips.add(beltMesh);

    const buckleMat = new THREE.MeshStandardMaterial({
      color: 0xe6be5a,
      metalness: 0.85,
      roughness: 0.2,
    });
    const buckleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.065, 0.03),
      buckleMat,
    );
    buckleMesh.position.set(0, 0.12, torsoD * 0.52);
    hips.add(buckleMesh);

    const buildLegMeshes = (hipGrp: THREE.Group, kneeGrp: THREE.Group) => {
      const thighGeo = new THREE.CapsuleGeometry(legRadius, Math.max(0.05, thighLen - legRadius), 6, 12);
      const thighMesh = new THREE.Mesh(thighGeo, trouserMat);
      thighMesh.position.set(0, -thighLen * 0.5, 0);
      hipGrp.add(thighMesh);

      const calfGeo = new THREE.CapsuleGeometry(
        legRadius * 0.88,
        Math.max(0.05, calfLen - legRadius * 0.88),
        6,
        12,
      );
      const calfMesh = new THREE.Mesh(calfGeo, trouserMat);
      calfMesh.position.set(0, -calfLen * 0.5, 0);
      kneeGrp.add(calfMesh);

      // Shoe (boot/oxford with toe cap and sole)
      const shoeGroup = new THREE.Group();
      shoeGroup.position.set(0, -calfLen - shoeH * 0.35, 0.045);
      const shoeUpper = new THREE.Mesh(
        new THREE.CapsuleGeometry(legRadius * 0.86, 0.09, 6, 12),
        shoeMat,
      );
      shoeUpper.rotation.x = Math.PI / 2;
      shoeUpper.scale.set(1, 1, 0.72);
      shoeGroup.add(shoeUpper);

      const soleMesh = new THREE.Mesh(
        new THREE.BoxGeometry(legRadius * 1.75, 0.028, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x110c09, roughness: 0.8 }),
      );
      soleMesh.position.set(0, -0.042, 0);
      shoeGroup.add(soleMesh);

      kneeGrp.add(shoeGroup);
    };

    buildLegMeshes(leftHip, leftKnee);
    buildLegMeshes(rightHip, rightKnee);
  }

  // -------------------------------------------------------------------------
  // 2. Torso, Outfit, Collar, Presets, Scarf, & Arms
  // -------------------------------------------------------------------------
  const leftShoulder = new THREE.Group();
  const leftElbow = new THREE.Group();
  const rightShoulder = new THREE.Group();
  const rightElbow = new THREE.Group();

  const shoulderX = torsoW * 0.55;
  const shoulderY = torsoH * 0.44;
  const upperArmLen = armLen * 0.5;
  const foreArmLen = armLen * 0.5;
  const armRadius = torsoW * 0.115;

  leftShoulder.position.set(-shoulderX, shoulderY, 0);
  rightShoulder.position.set(shoulderX, shoulderY, 0);
  leftElbow.position.set(0, -upperArmLen, 0);
  rightElbow.position.set(0, -upperArmLen, 0);

  leftShoulder.add(leftElbow);
  rightShoulder.add(rightElbow);
  chest.add(leftShoulder);
  chest.add(rightShoulder);

  if (mode !== "head") {
    // Sculpted upper torso (tapered cylinder + rounded shoulders)
    const torsoGeo = new THREE.CylinderGeometry(
      torsoW * 0.52,
      torsoW * 0.44,
      torsoH,
      20,
    );
    torsoGeo.scale(1, 1, torsoD / torsoW);
    const torsoMesh = new THREE.Mesh(torsoGeo, shirtMat);
    torsoMesh.position.set(0, torsoH * 0.1, 0);
    chest.add(torsoMesh);

    // Rounded shoulder cap Bridge
    const shoulderCapGeo = new THREE.CapsuleGeometry(
      torsoD * 0.46,
      torsoW * 0.72,
      8,
      16,
    );
    shoulderCapGeo.rotateZ(Math.PI / 2);
    const shoulderCap = new THREE.Mesh(shoulderCapGeo, shirtMat);
    shoulderCap.position.set(0, torsoH * 0.46, 0);
    chest.add(shoulderCap);

    // Inner V-neck shirt & sculpted lapels
    const vNeckGeo = new THREE.ConeGeometry(torsoW * 0.22, torsoH * 0.36, 4);
    vNeckGeo.rotateY(Math.PI / 4);
    vNeckGeo.rotateX(Math.PI);
    vNeckGeo.scale(1, 1, 0.35);
    const vNeckMesh = new THREE.Mesh(vNeckGeo, accentMat);
    vNeckMesh.position.set(0, torsoH * 0.42, torsoD * 0.42);
    chest.add(vNeckMesh);

    // Left & right jacket lapels
    for (const side of [-1, 1] as const) {
      const lapelGeo = new THREE.BoxGeometry(torsoW * 0.14, torsoH * 0.42, 0.035);
      const lapel = new THREE.Mesh(lapelGeo, shirtDarkMat);
      lapel.position.set(side * torsoW * 0.14, torsoH * 0.32, torsoD * 0.47);
      lapel.rotation.z = side * 0.28;
      chest.add(lapel);
    }

    // Center placket & 3D buttons
    const buttonGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.016, 12);
    buttonGeo.rotateX(Math.PI / 2);
    for (const by of [torsoH * 0.12, -torsoH * 0.08]) {
      const btn = new THREE.Mesh(buttonGeo, accentMat);
      btn.position.set(0, by, torsoD * 0.48);
      chest.add(btn);
    }

    // Style Preset Overlays
    if (stylePreset === "taisho-wagara") {
      const haoriLeftMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("hsl(176, 48%, 50%)"),
        roughness: 0.55,
        bumpMap: fabricBump ?? null,
        bumpScale: 0.01,
      });
      const haoriRightMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("hsl(218, 42%, 28%)"),
        roughness: 0.55,
        bumpMap: fabricBump ?? null,
        bumpScale: 0.01,
      });
      const goldTrimMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("hsl(42, 86%, 72%)"),
        metalness: 0.75,
        roughness: 0.25,
      });
      for (const side of [-1, 1] as const) {
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(torsoW * 0.34, torsoH * 0.96, torsoD * 1.08),
          side < 0 ? haoriLeftMat : haoriRightMat,
        );
        panel.position.set(side * torsoW * 0.24, torsoH * 0.08, 0);
        chest.add(panel);

        const trim = new THREE.Mesh(
          new THREE.BoxGeometry(0.025, torsoH * 0.96, torsoD * 1.1),
          goldTrimMat,
        );
        trim.position.set(side * torsoW * 0.07, torsoH * 0.08, 0);
        chest.add(trim);
      }
    } else if (stylePreset === "occult-academy") {
      const capeMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("hsl(250, 35%, 16%)"),
        roughness: 0.62,
      });
      const cravatMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("hsl(272, 68%, 72%)"),
        roughness: 0.4,
      });
      const crestMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("hsl(45, 92%, 68%)"),
        metalness: 0.85,
        roughness: 0.2,
      });
      const cape = new THREE.Mesh(
        new THREE.ConeGeometry(torsoW * 0.72, torsoH * 1.05, 18, 1, true),
        capeMat,
      );
      cape.scale.set(1, 1, 0.62);
      cape.position.set(0, torsoH * 0.05, -0.02);
      chest.add(cape);

      const cravat = new THREE.Mesh(
        new THREE.OctahedronGeometry(torsoW * 0.14, 0),
        cravatMat,
      );
      cravat.scale.set(0.8, 1.4, 0.35);
      cravat.position.set(0, torsoH * 0.36, torsoD * 0.5);
      chest.add(cravat);

      const crest = new THREE.Mesh(
        new THREE.TorusGeometry(0.055, 0.012, 8, 20),
        crestMat,
      );
      crest.position.set(0, torsoH * 0.18, torsoD * 0.52);
      chest.add(crest);
    }

    // Scarf accessory
    if (scarf !== "none") {
      const scarfBaseColor =
        scarf === "striped"
          ? "#c13b2c"
          : scarf === "solid"
            ? "#5c3d8a"
            : "#8a6a3f";
      const scarfMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(scarfBaseColor),
        roughness: 0.78,
        bumpMap: fabricBump ?? null,
        bumpScale: 0.015,
      });
      const scarfRing = new THREE.Mesh(
        new THREE.TorusGeometry(torsoW * 0.34, 0.068, 10, 20),
        scarfMat,
      );
      scarfRing.rotation.x = Math.PI / 2;
      scarfRing.scale.set(1, 0.78, 1);
      scarfRing.position.set(0, torsoH * 0.54, 0.02);
      chest.add(scarfRing);

      const scarfTail = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, torsoH * 0.48, 0.045),
        scarfMat,
      );
      scarfTail.position.set(torsoW * 0.18, torsoH * 0.28, torsoD * 0.49);
      scarfTail.rotation.z = -0.12;
      chest.add(scarfTail);
    }

    // Build Arms (Upper Arm + Forearm + Sculpted Hand)
    const buildArmMeshes = (shoulderGrp: THREE.Group, elbowGrp: THREE.Group, isLeft: boolean) => {
      const upperGeo = new THREE.CapsuleGeometry(
        armRadius,
        Math.max(0.04, upperArmLen - armRadius),
        6,
        12,
      );
      const upperMesh = new THREE.Mesh(upperGeo, shirtDarkMat);
      upperMesh.position.set(0, -upperArmLen * 0.5, 0);
      shoulderGrp.add(upperMesh);

      const foreGeo = new THREE.CapsuleGeometry(
        armRadius * 0.88,
        Math.max(0.04, foreArmLen - armRadius * 0.88),
        6,
        12,
      );
      const foreMesh = new THREE.Mesh(foreGeo, shirtMat);
      foreMesh.position.set(0, -foreArmLen * 0.5, 0);
      elbowGrp.add(foreMesh);

      // Sleeve cuff
      const cuff = new THREE.Mesh(
        new THREE.CylinderGeometry(armRadius * 0.92, armRadius * 0.92, 0.04, 12),
        accentMat,
      );
      cuff.position.set(0, -foreArmLen + 0.02, 0);
      elbowGrp.add(cuff);

      // Hand (palm + thumb)
      const handGroup = new THREE.Group();
      handGroup.position.set(0, -foreArmLen - armRadius * 0.55, 0);
      const palm = new THREE.Mesh(
        new THREE.SphereGeometry(armRadius * 0.82, 12, 12),
        skinMat,
      );
      palm.scale.set(0.85, 1.15, 0.65);
      handGroup.add(palm);

      const thumb = new THREE.Mesh(
        new THREE.CapsuleGeometry(armRadius * 0.28, 0.03, 4, 8),
        skinMat,
      );
      thumb.position.set((isLeft ? 1 : -1) * armRadius * 0.65, 0.01, 0.02);
      thumb.rotation.z = (isLeft ? -1 : 1) * 0.5;
      handGroup.add(thumb);

      elbowGrp.add(handGroup);
    };

    buildArmMeshes(leftShoulder, leftElbow, true);
    buildArmMeshes(rightShoulder, rightElbow, false);
  }

  // -------------------------------------------------------------------------
  // 3. Neck & Sculpted 3D Head / Face / Hair / Eyes / Brows / Mouth
  // -------------------------------------------------------------------------
  const neckMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(headR * 0.34, headR * 0.38, neckH * 1.35, 14),
    skinMat,
  );
  neckMesh.position.set(0, neckH * 0.5, 0);
  neck.add(neckMesh);

  if (mode !== "body") {
    // Cranium + sculpted lower face/jaw egg shape
    const craniumGeo = new THREE.SphereGeometry(headR, 28, 24);
    craniumGeo.scale(0.96, 1.08, 0.94);
    const craniumMesh = new THREE.Mesh(craniumGeo, skinMat);
    head.add(craniumMesh);

    // Subtle sculpted chin / jawline taper
    const chinGeo = new THREE.SphereGeometry(headR * 0.56, 16, 14);
    chinGeo.scale(1.05, 0.82, 0.88);
    const chinMesh = new THREE.Mesh(chinGeo, skinMat);
    chinMesh.position.set(0, -headR * 0.52, headR * 0.14);
    head.add(chinMesh);

    // 3D Nose (bridge + rounded tip)
    const noseGroup = new THREE.Group();
    noseGroup.position.set(0, -headR * 0.04, headR * 0.92);
    const noseBridge = new THREE.Mesh(
      new THREE.CapsuleGeometry(headR * 0.065, headR * 0.14, 6, 10),
      skinMat,
    );
    noseBridge.rotation.x = -0.22;
    noseGroup.add(noseBridge);
    const noseTip = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 0.085, 12, 10),
      skinMat,
    );
    noseTip.position.set(0, -headR * 0.07, headR * 0.03);
    noseGroup.add(noseTip);
    head.add(noseGroup);

    // 3D Ears & Earrings
    if (parts.hasEars) {
      const innerEarMat = new THREE.MeshStandardMaterial({
        color: skinShadowColor,
        roughness: 0.6,
      });
      for (const side of [-1, 1] as const) {
        const earGroup = new THREE.Group();
        earGroup.position.set(side * headR * 0.94, -headR * 0.02, -headR * 0.04);
        earGroup.rotation.y = side * -0.25;

        const outerEar = new THREE.Mesh(
          new THREE.SphereGeometry(headR * 0.2, 12, 12),
          skinMat,
        );
        outerEar.scale.set(0.45, 1.15, 0.75);
        earGroup.add(outerEar);

        const innerEar = new THREE.Mesh(
          new THREE.SphereGeometry(headR * 0.12, 10, 10),
          innerEarMat,
        );
        innerEar.scale.set(0.4, 1.0, 0.65);
        innerEar.position.set(side * 0.01, 0, 0.02);
        earGroup.add(innerEar);

        head.add(earGroup);
      }

      if (earring !== "none") {
        const goldMat = new THREE.MeshStandardMaterial({
          color: 0xffc857,
          metalness: 0.88,
          roughness: 0.16,
        });
        const sides: number[] =
          earring === "both" ? [-1, 1] : earring === "left" ? [-1] : [1];
        for (const s of sides) {
          const drop = new THREE.Mesh(
            new THREE.SphereGeometry(headR * 0.09, 10, 10),
            goldMat,
          );
          drop.scale.set(0.85, 1.25, 0.85);
          drop.position.set(s * headR * 0.96, -headR * 0.28, 0.02);
          head.add(drop);
        }
      }
    }

    // Cheek blush ellipsoids
    if (enableCheeks) {
      const cheekMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(`hsl(${parts.cheekHue}, 78%, 72%)`),
        transparent: true,
        opacity: 0.38,
      });
      for (const side of [-1, 1] as const) {
        const blush = new THREE.Mesh(
          new THREE.SphereGeometry(headR * 0.19, 12, 10),
          cheekMat,
        );
        blush.scale.set(1.15, 0.65, 0.35);
        blush.position.set(side * headR * 0.5, -headR * 0.18, headR * 0.78);
        blush.rotation.y = side * 0.42;
        head.add(blush);
      }
    }

    // Beard (behind mouth/hair fringe)
    if (beard !== "none") {
      buildBeard3D(head, beard, headR, hairMat);
    }

    // 3D Hair
    buildHair3D(head, parts, headR, hairMat, hairHighlightColor);

    // 3D Brows
    buildBrows3D(head, expression.brow, headR, hairMat);

    // 3D Mouth
    buildMouth3D(head, expression.mouth, headR, lipMat);

    // Mustache
    if (mustache !== "none") {
      buildMustache3D(head, mustache, headR, hairMat);
    }

    // Glasses
    if (glasses !== "none") {
      buildGlasses3D(head, glasses, headR);
    }

    // Hat / Crown
    if (crown) {
      buildCrown3D(head, headR);
    } else if (hat !== "none") {
      buildHat3D(head, hat, headR);
    }
  }

  // 3D Eyes (always created so rig references stay valid)
  const { leftEyeBall, rightEyeBall, leftUpperLid, rightUpperLid } =
    buildEyes3D(head, expression.eye, parts, headR, skinMat);

  // Sweat & Zzz & Working Think Dots
  let sweatDrop: THREE.Group | null = null;
  if (expression.showSweat && mode !== "body") {
    sweatDrop = new THREE.Group();
    sweatDrop.position.set(headR * 0.68, headR * 0.38, headR * 0.68);
    const dropMat = new THREE.MeshPhysicalMaterial({
      color: 0x6dd5fa,
      roughness: 0.1,
      metalness: 0.05,
      clearcoat: 1,
      transparent: true,
      opacity: 0.92,
    });
    const dropBody = new THREE.Mesh(
      new THREE.ConeGeometry(headR * 0.11, headR * 0.28, 12),
      dropMat,
    );
    const dropSphere = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 0.11, 12, 10),
      dropMat,
    );
    dropSphere.position.set(0, -headR * 0.1, 0);
    sweatDrop.add(dropBody, dropSphere);
    head.add(sweatDrop);
  }

  let zzzGroup: THREE.Group | null = null;
  if ((expression.showZzz || options.motion === "resting") && mode !== "body") {
    zzzGroup = new THREE.Group();
    zzzGroup.position.set(headR * 0.85, headR * 0.75, headR * 0.3);
    const zMat = new THREE.MeshStandardMaterial({
      color: 0x7da6e8,
      emissive: 0x3b5998,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    });
    for (let i = 0; i < 2; i++) {
      const s = (1 - i * 0.28) * headR * 0.28;
      const zOrb = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), zMat);
      zOrb.position.set(i * headR * 0.35, i * headR * 0.38, 0);
      zzzGroup.add(zOrb);
    }
    head.add(zzzGroup);
  }

  const thinkDots: THREE.Mesh[] = [];
  if (options.motion === "working" && mode !== "body") {
    const dotMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.65,
      roughness: 0.25,
    });
    for (let i = 0; i < 3; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(headR * 0.11, 10, 10),
        dotMat,
      );
      dot.position.set((i - 1) * headR * 0.34, headR * 1.45, 0);
      head.add(dot);
      thinkDots.push(dot);
    }
  }

  // The Sims 3D Plumbob floating above the head
  const shouldShowPlumbob = options.showPlumbob ?? mode !== "body";
  let plumbobGroup: THREE.Group | null = null;
  if (shouldShowPlumbob) {
    const plumbobMood =
      expression.pose === "crouch" || expression.showSweat
        ? "crimson"
        : expression.pose === "sigh"
          ? "amber"
          : expression.pose === "sleeping" || options.motion === "resting"
            ? "aqua"
            : "emerald";
    const pRadius = mode === "head" ? headR * 0.24 : headR * 0.28;
    plumbobGroup = buildSimsPlumbob3D(pRadius, plumbobMood);
    const baseY = crown || hat !== "none" ? headR * 1.68 : headR * 1.44;
    plumbobGroup.position.set(0, baseY, 0);
    plumbobGroup.userData.baseY = baseY;
    head.add(plumbobGroup);
  }

  const rig: CharacterRig3D = {
    root,
    hips,
    chest,
    neck,
    head,
    leftEyeBall,
    rightEyeBall,
    leftUpperLid,
    rightUpperLid,
    leftShoulder,
    leftElbow,
    rightShoulder,
    rightElbow,
    leftHip,
    leftKnee,
    rightHip,
    rightKnee,
    sweatDrop,
    zzzGroup,
    thinkDots,
    plumbobGroup,
    options,
    footY: 0,
    headCenterY,
  };

  // Apply initial static pose
  animateCharacterRig3D(rig, 0);
  return rig;
}

// ---------------------------------------------------------------------------
// 3D Eyes, Hair, Brows, Mouth, & Accessory Sub-Builders
// ---------------------------------------------------------------------------

function buildEyes3D(
  head: THREE.Group,
  eyeShape: EyeShape,
  parts: AvatarParts,
  headR: number,
  skinMat: THREE.Material,
) {
  const leftEyeBall = new THREE.Group();
  const rightEyeBall = new THREE.Group();

  const eyeX = headR * 0.36;
  const eyeY = headR * 0.06;
  const eyeZ = headR * 0.82;
  const eyeR = headR * (eyeShape === "wide" ? 0.19 : 0.155);

  leftEyeBall.position.set(-eyeX, eyeY, eyeZ);
  rightEyeBall.position.set(eyeX, eyeY, eyeZ);

  const scleraMat = new THREE.MeshStandardMaterial({
    color: 0xfcfcfc,
    roughness: 0.18,
  });
  const irisHue = (parts.hairHue + 140) % 360;
  const irisMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${irisHue}, 58%, 38%)`),
    roughness: 0.22,
  });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0e0e12 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const heartMat = new THREE.MeshStandardMaterial({
    color: 0xe11d48,
    emissive: 0x881337,
    emissiveIntensity: 0.35,
    roughness: 0.25,
  });

  const populateEye = (grp: THREE.Group, side: -1 | 1) => {
    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR, 16, 14),
      scleraMat,
    );
    sclera.scale.set(1, 1, 0.65);
    grp.add(sclera);

    if (eyeShape === "hearts") {
      const heart = new THREE.Mesh(
        new THREE.OctahedronGeometry(eyeR * 0.72, 1),
        heartMat,
      );
      heart.scale.set(1.1, 1.1, 0.45);
      heart.position.set(0, 0, eyeR * 0.55);
      grp.add(heart);
    } else {
      const iris = new THREE.Mesh(
        new THREE.CircleGeometry(eyeR * 0.62, 16),
        irisMat,
      );
      iris.position.set(0, 0, eyeR * 0.64);
      grp.add(iris);

      const pupil = new THREE.Mesh(
        new THREE.CircleGeometry(eyeR * 0.36, 14),
        pupilMat,
      );
      pupil.position.set(0, 0, eyeR * 0.66);
      grp.add(pupil);

      // Corneal catchlights
      const glint1 = new THREE.Mesh(
        new THREE.CircleGeometry(eyeR * 0.18, 10),
        glintMat,
      );
      glint1.position.set(side * eyeR * 0.18, eyeR * 0.2, eyeR * 0.68);
      grp.add(glint1);

      const glint2 = new THREE.Mesh(
        new THREE.CircleGeometry(eyeR * 0.09, 8),
        glintMat,
      );
      glint2.position.set(-side * eyeR * 0.15, -eyeR * 0.16, eyeR * 0.68);
      grp.add(glint2);
    }
  };

  populateEye(leftEyeBall, -1);
  populateEye(rightEyeBall, 1);

  // Upper eyelids (hemisphere shells that rotate down over the eye)
  const lidGeo = new THREE.SphereGeometry(
    eyeR * 1.08,
    16,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.55,
  );
  const leftUpperLid = new THREE.Mesh(lidGeo, skinMat);
  const rightUpperLid = new THREE.Mesh(lidGeo, skinMat);

  leftUpperLid.position.set(-eyeX, eyeY, eyeZ);
  rightUpperLid.position.set(eyeX, eyeY, eyeZ);

  head.add(leftEyeBall, rightEyeBall, leftUpperLid, rightUpperLid);
  return { leftEyeBall, rightEyeBall, leftUpperLid, rightUpperLid };
}

function buildHair3D(
  head: THREE.Group,
  parts: AvatarParts,
  headR: number,
  hairMat: THREE.Material,
  highlightColor: THREE.Color,
) {
  if (parts.hair === "bald") return;

  const hairGroup = new THREE.Group();
  // Base cranial hair cap covering top and back of head
  const capGeo = new THREE.SphereGeometry(
    headR * 1.04,
    24,
    18,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.62,
  );
  capGeo.scale(0.98, 1.08, 0.98);
  const capMesh = new THREE.Mesh(capGeo, hairMat);
  capMesh.rotation.x = -0.18;
  capMesh.position.set(0, headR * 0.05, -headR * 0.03);
  hairGroup.add(capMesh);

  // Crown highlight halo strand
  const hiMat = new THREE.MeshBasicMaterial({
    color: highlightColor,
    transparent: true,
    opacity: 0.35,
  });
  const hiArc = new THREE.Mesh(
    new THREE.TorusGeometry(headR * 0.72, headR * 0.045, 6, 20, Math.PI * 0.7),
    hiMat,
  );
  hiArc.position.set(0, headR * 0.55, headR * 0.55);
  hiArc.rotation.set(0.5, 0, 0.35);
  hairGroup.add(hiArc);

  switch (parts.hair) {
    case "short": {
      // Sculpted swept front bangs locks
      for (let i = -2; i <= 2; i++) {
        const lock = new THREE.Mesh(
          new THREE.ConeGeometry(headR * 0.22, headR * 0.52, 8),
          hairMat,
        );
        lock.scale.set(0.85, 1, 0.45);
        lock.position.set(
          i * headR * 0.26,
          headR * 0.55,
          headR * 0.82 - Math.abs(i) * headR * 0.08,
        );
        lock.rotation.x = Math.PI + 0.35;
        lock.rotation.z = i * 0.18;
        hairGroup.add(lock);
      }
      break;
    }
    case "wavy": {
      // Volumetric wavy locks framing temples and forehead
      for (let i = -3; i <= 3; i++) {
        const wave = new THREE.Mesh(
          new THREE.CapsuleGeometry(headR * 0.16, headR * 0.36, 6, 10),
          hairMat,
        );
        const angle = i * 0.38;
        wave.position.set(
          Math.sin(angle) * headR * 0.92,
          headR * 0.38 - Math.abs(i) * headR * 0.08,
          Math.cos(angle) * headR * 0.86,
        );
        wave.rotation.z = -i * 0.22;
        wave.rotation.x = 0.25;
        hairGroup.add(wave);
      }
      break;
    }
    case "bob": {
      // Sleek jaw-framing side curtains + full bangs
      for (const side of [-1, 1] as const) {
        const curtain = new THREE.Mesh(
          new THREE.CapsuleGeometry(headR * 0.26, headR * 0.95, 8, 12),
          hairMat,
        );
        curtain.scale.set(0.55, 1, 0.95);
        curtain.position.set(side * headR * 0.88, -headR * 0.05, headR * 0.12);
        curtain.rotation.z = side * -0.14;
        hairGroup.add(curtain);
      }
      // Straight fringe across forehead
      const fringe = new THREE.Mesh(
        new THREE.CylinderGeometry(
          headR * 0.98,
          headR * 1.0,
          headR * 0.38,
          20,
          1,
          true,
          -Math.PI * 0.38,
          Math.PI * 0.76,
        ),
        hairMat,
      );
      fringe.position.set(0, headR * 0.52, 0.02);
      hairGroup.add(fringe);
      break;
    }
    case "topknot": {
      // High sculpted bun + tie band + sleek front locks
      const bun = new THREE.Mesh(
        new THREE.SphereGeometry(headR * 0.42, 16, 14),
        hairMat,
      );
      bun.scale.set(1, 0.88, 1);
      bun.position.set(0, headR * 1.32, -headR * 0.08);
      hairGroup.add(bun);

      const tie = new THREE.Mesh(
        new THREE.TorusGeometry(headR * 0.24, headR * 0.05, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xc13b2c, roughness: 0.4 }),
      );
      tie.rotation.x = Math.PI / 2;
      tie.position.set(0, headR * 1.06, -headR * 0.08);
      hairGroup.add(tie);
      break;
    }
    case "curly": {
      // Rich 3D cluster of curls around the crown and temples
      const puffs: readonly [number, number, number, number][] = [
        [0, 0.98, 0.42, 0.36],
        [-0.48, 0.88, 0.46, 0.34],
        [0.48, 0.88, 0.46, 0.34],
        [-0.82, 0.52, 0.28, 0.32],
        [0.82, 0.52, 0.28, 0.32],
        [-0.95, 0.08, 0.12, 0.28],
        [0.95, 0.08, 0.12, 0.28],
        [0, 1.06, -0.18, 0.4],
        [-0.55, 0.82, -0.32, 0.36],
        [0.55, 0.82, -0.32, 0.36],
      ];
      for (const [px, py, pz, pr] of puffs) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(headR * pr, 12, 10),
          hairMat,
        );
        puff.position.set(px * headR, py * headR, pz * headR);
        hairGroup.add(puff);
      }
      break;
    }
  }

  head.add(hairGroup);
}

function buildBrows3D(
  head: THREE.Group,
  brow: BrowShape,
  headR: number,
  hairMat: THREE.Material,
) {
  if (brow === "none") return;
  const browGeo = new THREE.CapsuleGeometry(headR * 0.042, headR * 0.22, 4, 8);
  browGeo.rotateZ(Math.PI / 2);

  for (const side of [-1, 1] as const) {
    const mesh = new THREE.Mesh(browGeo, hairMat);
    let yOffset = headR * 0.32;
    let rotZ = 0;
    if (brow === "angle-up") {
      rotZ = side * 0.32;
    } else if (brow === "angle-down") {
      rotZ = side * -0.32;
    } else if (brow === "arch-asymmetric-left" && side === -1) {
      yOffset += headR * 0.08;
      rotZ = -0.15;
    } else if (brow === "arch-asymmetric-right" && side === 1) {
      yOffset += headR * 0.08;
      rotZ = 0.15;
    }
    mesh.position.set(side * headR * 0.36, yOffset, headR * 0.88);
    mesh.rotation.y = side * 0.25;
    mesh.rotation.z = rotZ;
    head.add(mesh);
  }
}

function buildMouth3D(
  head: THREE.Group,
  mouth: MouthShape,
  headR: number,
  lipMat: THREE.Material,
) {
  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, -headR * 0.42, headR * 0.86);

  const cavityMat = new THREE.MeshStandardMaterial({
    color: 0x3b1812,
    roughness: 0.7,
  });
  const teethMat = new THREE.MeshStandardMaterial({
    color: 0xfbfcf6,
    roughness: 0.2,
  });

  switch (mouth) {
    case "small-smile": {
      const smile = new THREE.Mesh(
        new THREE.TorusGeometry(headR * 0.16, headR * 0.036, 8, 16, Math.PI * 0.75),
        lipMat,
      );
      smile.rotation.z = Math.PI * 1.12;
      smile.position.set(0, headR * 0.06, 0);
      mouthGroup.add(smile);
      break;
    }
    case "big-smile": {
      const grin = new THREE.Mesh(
        new THREE.SphereGeometry(headR * 0.22, 14, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
        cavityMat,
      );
      grin.scale.set(1.15, 0.85, 0.45);
      mouthGroup.add(grin);
      break;
    }
    case "wide-grin": {
      const grin = new THREE.Mesh(
        new THREE.BoxGeometry(headR * 0.44, headR * 0.16, headR * 0.08),
        teethMat,
      );
      mouthGroup.add(grin);
      break;
    }
    case "frown": {
      const frown = new THREE.Mesh(
        new THREE.TorusGeometry(headR * 0.17, headR * 0.036, 8, 16, Math.PI * 0.75),
        lipMat,
      );
      frown.rotation.z = Math.PI * 0.12;
      frown.position.set(0, -headR * 0.08, 0);
      mouthGroup.add(frown);
      break;
    }
    case "open-yawn":
    case "pucker": {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(headR * 0.09, headR * 0.035, 8, 14),
        mouth === "pucker" ? lipMat : cavityMat,
      );
      ring.scale.set(0.85, 1.2, 0.6);
      mouthGroup.add(ring);
      break;
    }
    case "flat":
    default: {
      const line = new THREE.Mesh(
        new THREE.CapsuleGeometry(headR * 0.032, headR * 0.22, 4, 8),
        lipMat,
      );
      line.rotation.z = Math.PI / 2;
      mouthGroup.add(line);
      break;
    }
  }

  head.add(mouthGroup);
}

function buildGlasses3D(
  head: THREE.Group,
  kind: Exclude<GlassesKind, "none">,
  headR: number,
) {
  const grp = new THREE.Group();
  const eyeX = headR * 0.36;
  const eyeY = headR * 0.06;
  const z = headR * 0.94;

  const frameMat = new THREE.MeshStandardMaterial({
    color: kind === "sunglasses" ? 0x141418 : 0x2c2018,
    metalness: 0.65,
    roughness: 0.25,
  });
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: kind === "sunglasses" ? 0x11131a : 0xdbeafe,
    transparent: true,
    opacity: kind === "sunglasses" ? 0.88 : 0.24,
    roughness: 0.08,
    metalness: 0.15,
    clearcoat: 1,
  });

  for (const side of [-1, 1] as const) {
    if (kind === "round") {
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(headR * 0.24, headR * 0.028, 8, 20),
        frameMat,
      );
      rim.position.set(side * eyeX, eyeY, z);
      grp.add(rim);

      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(headR * 0.23, 18),
        lensMat,
      );
      lens.position.set(side * eyeX, eyeY, z);
      grp.add(lens);
    } else {
      const w = headR * 0.48;
      const h = headR * 0.32;
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, headR * 0.04),
        kind === "sunglasses" ? lensMat : frameMat,
      );
      frame.position.set(side * eyeX, eyeY, z);
      grp.add(frame);

      const topBar = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.06, headR * 0.045, headR * 0.055),
        frameMat,
      );
      topBar.position.set(side * eyeX, eyeY + h * 0.48, z);
      grp.add(topBar);
    }

    // Temple stem going back to ear
    const stem = new THREE.Mesh(
      new THREE.BoxGeometry(headR * 0.03, headR * 0.03, headR * 0.75),
      frameMat,
    );
    stem.position.set(side * headR * 0.62, eyeY + headR * 0.04, z - headR * 0.38);
    grp.add(stem);
  }

  // Nose bridge
  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(headR * 0.26, headR * 0.035, headR * 0.04),
    frameMat,
  );
  bridge.position.set(0, eyeY + headR * 0.04, z);
  grp.add(bridge);

  head.add(grp);
}

function buildMustache3D(
  head: THREE.Group,
  kind: Exclude<MustacheKind, "none">,
  headR: number,
  hairMat: THREE.Material,
) {
  const y = -headR * 0.24;
  const z = headR * 0.9;
  for (const side of [-1, 1] as const) {
    const bar = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        headR * (kind === "pencil" ? 0.028 : 0.055),
        headR * 0.18,
        6,
        10,
      ),
      hairMat,
    );
    bar.rotation.z = Math.PI / 2 + side * (kind === "handlebar" ? -0.22 : 0.18);
    bar.position.set(side * headR * 0.14, y, z);
    head.add(bar);
  }
}

function buildBeard3D(
  head: THREE.Group,
  kind: Exclude<BeardKind, "none">,
  headR: number,
  hairMat: THREE.Material,
) {
  if (kind === "full") {
    const fullBeard = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 0.92, 18, 14, 0, Math.PI * 2, Math.PI * 0.48, Math.PI * 0.45),
      hairMat,
    );
    fullBeard.scale.set(0.95, 1.08, 0.96);
    fullBeard.position.set(0, -headR * 0.12, headR * 0.08);
    head.add(fullBeard);
  } else if (kind === "goatee") {
    const goatee = new THREE.Mesh(
      new THREE.ConeGeometry(headR * 0.22, headR * 0.38, 10),
      hairMat,
    );
    goatee.rotation.x = Math.PI;
    goatee.scale.set(1, 1, 0.65);
    goatee.position.set(0, -headR * 0.78, headR * 0.58);
    head.add(goatee);
  }
}

function buildCrown3D(head: THREE.Group, headR: number) {
  const crownGrp = new THREE.Group();
  crownGrp.position.set(0, headR * 1.05, 0);
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd54f,
    metalness: 0.88,
    roughness: 0.18,
    emissive: 0x6b4e00,
    emissiveIntensity: 0.25,
  });
  const rubyMat = new THREE.MeshStandardMaterial({
    color: 0xe53935,
    metalness: 0.3,
    roughness: 0.15,
  });

  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(headR * 0.52, headR * 0.48, headR * 0.24, 16),
    goldMat,
  );
  crownGrp.add(band);

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(headR * 0.11, headR * 0.24, 6),
      goldMat,
    );
    spike.position.set(
      Math.sin(angle) * headR * 0.46,
      headR * 0.22,
      Math.cos(angle) * headR * 0.46,
    );
    crownGrp.add(spike);

    const gem = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 0.055, 8, 8),
      rubyMat,
    );
    gem.position.set(
      Math.sin(angle) * headR * 0.5,
      0,
      Math.cos(angle) * headR * 0.5,
    );
    crownGrp.add(gem);
  }

  head.add(crownGrp);
}

function buildHat3D(
  head: THREE.Group,
  kind: "scholar" | "cap" | "tophat",
  headR: number,
) {
  const hatGrp = new THREE.Group();
  hatGrp.position.set(0, headR * 0.98, 0);

  if (kind === "tophat") {
    const silkMat = new THREE.MeshStandardMaterial({
      color: 0x1c1924,
      roughness: 0.35,
      metalness: 0.15,
    });
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: 0xc13b2c,
      roughness: 0.4,
    });
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(headR * 0.82, headR * 0.82, headR * 0.07, 20),
      silkMat,
    );
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(headR * 0.56, headR * 0.52, headR * 0.65, 20),
      silkMat,
    );
    cyl.position.set(0, headR * 0.34, 0);
    const ribbon = new THREE.Mesh(
      new THREE.CylinderGeometry(headR * 0.54, headR * 0.53, headR * 0.12, 20),
      ribbonMat,
    );
    ribbon.position.set(0, headR * 0.1, 0);
    hatGrp.add(brim, cyl, ribbon);
  } else if (kind === "scholar") {
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x1e1e28,
      roughness: 0.45,
    });
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(headR * 0.54, headR * 0.58, headR * 0.18, 16),
      boardMat,
    );
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(headR * 1.35, headR * 0.06, headR * 1.35),
      boardMat,
    );
    board.position.set(0, headR * 0.12, 0);
    board.rotation.y = Math.PI / 4;
    hatGrp.add(cap, board);
  } else {
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x2a5c8a,
      roughness: 0.55,
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 0.68, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
      capMat,
    );
    const visor = new THREE.Mesh(
      new THREE.CylinderGeometry(headR * 0.62, headR * 0.62, headR * 0.05, 16, 1, false, -Math.PI * 0.35, Math.PI * 0.7),
      capMat,
    );
    visor.position.set(0, 0.02, headR * 0.32);
    hatGrp.add(dome, visor);
  }

  head.add(hatGrp);
}

// ---------------------------------------------------------------------------
// 3D Skeletal & Facial Animation Updater
// ---------------------------------------------------------------------------

export function animateCharacterRig3D(
  rig: CharacterRig3D,
  elapsedSec: number,
  pointer?: StagePointerState,
): void {
  const {
    parts,
    expression,
    motion = "idle",
    enableBlink = true,
    enableBreathe = true,
    enableEyeTrack = true,
  } = rig.options;

  const t = elapsedSec + Math.abs(parts.breatheDelay);
  const pose = expression.pose;

  // Reset base transforms
  rig.root.rotation.set(0, 0, 0);
  rig.hips.rotation.set(0, 0, 0);
  rig.chest.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);

  // 1. Eyelid opening + periodic Blink
  let lidClose = 0.12; // Normal relaxed upper lid position
  if (expression.eye === "closed" || pose === "sleeping" || motion === "resting") {
    lidClose = 1.0;
  } else if (expression.eye === "half") {
    lidClose = 0.58;
  } else if (expression.eye === "narrow") {
    lidClose = 0.68;
  } else if (expression.eye === "wide") {
    lidClose = 0.02;
  } else if (expression.eye === "smile") {
    lidClose = 0.78;
  }

  if (enableBlink && lidClose < 0.9) {
    const blinkCycle = (elapsedSec + Math.abs(parts.blinkDelay)) % 5.2;
    if (blinkCycle > 4.95 && blinkCycle < 5.15) {
      const blinkProgress = 1 - Math.abs(blinkCycle - 5.05) / 0.1;
      lidClose = Math.max(lidClose, blinkProgress);
    }
  }

  // Rotate upper lid shell down to cover eyeball as `lidClose` -> 1
  const lidRotX = -1.15 + lidClose * 1.25;
  rig.leftUpperLid.rotation.x = lidRotX;
  rig.rightUpperLid.rotation.x = lidRotX;

  // 2. 3D Gaze & Head Cursor Tracking
  let gazeYaw = 0;
  let gazePitch = 0;
  if (enableEyeTrack && pointer && pointer.hovered) {
    gazeYaw = Math.max(-0.38, Math.min(0.38, pointer.localX * 0.35));
    gazePitch = Math.max(-0.25, Math.min(0.25, pointer.localY * 0.25));
  }
  rig.leftEyeBall.rotation.y = gazeYaw * 0.85;
  rig.leftEyeBall.rotation.x = -gazePitch * 0.75;
  rig.rightEyeBall.rotation.y = gazeYaw * 0.85;
  rig.rightEyeBall.rotation.x = -gazePitch * 0.75;

  // 3. Breathing & Motion States
  const breatheWave = enableBreathe ? Math.sin(t * 1.9) : 0;
  rig.chest.scale.set(
    1 + breatheWave * 0.018,
    1 + breatheWave * 0.022,
    1 + breatheWave * 0.028,
  );

  // Default arm & leg neutral angles
  let lShoulderX = 0;
  let lShoulderZ = 0.12;
  let lElbowX = -0.15;
  let lElbowZ = 0;

  let rShoulderX = 0;
  let rShoulderZ = -0.12;
  let rElbowX = -0.15;
  let rElbowZ = 0;

  let lHipX = 0;
  let lKneeX = 0;
  let rHipX = 0;
  let rKneeX = 0;

  let headPitch = (expression.leanDeg * Math.PI) / 180 - gazePitch * 0.35;
  let headYaw = gazeYaw * 0.45 + Math.sin(t * 0.7) * 0.06;
  let headRoll = Math.sin(t * 0.5) * 0.03;

  if (motion === "walking") {
    // 4-limb opposite-phase 3D walk cycle
    const w = t * 5.2;
    const stride = Math.sin(w);
    const bounce = Math.abs(Math.cos(w)) * 0.045;

    rig.root.position.y = bounce;
    rig.chest.rotation.y = -stride * 0.14;
    rig.hips.rotation.y = stride * 0.1;

    lHipX = stride * 0.55;
    rHipX = -stride * 0.55;
    lKneeX = Math.max(0, -Math.cos(w)) * 0.65;
    rKneeX = Math.max(0, Math.cos(w)) * 0.65;

    lShoulderX = -stride * 0.45;
    rShoulderX = stride * 0.45;
    lElbowX = -0.35 - Math.max(0, -stride) * 0.25;
    rElbowX = -0.35 - Math.max(0, stride) * 0.25;
  } else if (motion === "working") {
    // Desk focus + rapid alternating typing hands
    rig.root.position.y = 0;
    rig.chest.rotation.x = 0.16;
    headPitch = 0.22 + Math.sin(t * 2.2) * 0.04;
    headYaw = Math.sin(t * 1.5) * 0.14;

    lShoulderX = -0.65;
    rShoulderX = -0.65;
    lShoulderZ = 0.08;
    rShoulderZ = -0.08;
    lElbowX = -0.85 + Math.sin(t * 14) * 0.12;
    rElbowX = -0.85 + Math.cos(t * 14) * 0.12;
  } else if (motion === "sitting") {
    // Seated on bench
    rig.root.position.y = -0.18;
    lHipX = -1.42;
    rHipX = -1.42;
    lKneeX = 1.38 + Math.sin(t * 2.1) * 0.12;
    rKneeX = 1.38 - Math.sin(t * 2.1) * 0.12;
    lShoulderX = -0.25;
    rShoulderX = -0.25;
    lElbowX = -0.45;
    rElbowX = -0.45;
  } else if (motion === "resting" || pose === "sleeping") {
    // Lying down sleeping
    rig.root.position.y = 0.12;
    rig.root.rotation.z = -Math.PI / 2;
    rig.root.rotation.y = 0.2;
    lShoulderZ = 0.06;
    rShoulderZ = -0.06;
  } else {
    // Idle + Mood Pose
    rig.root.position.y = breatheWave * 0.012;

    if (pose === "wave") {
      rShoulderZ = -2.35;
      rShoulderX = -0.25;
      rElbowZ = Math.sin(t * 5.2) * 0.38 - 0.2;
      rElbowX = -0.2;
    } else if (pose === "cross-arms") {
      lShoulderX = -0.65;
      rShoulderX = -0.65;
      lShoulderZ = -0.35;
      rShoulderZ = 0.35;
      lElbowZ = -1.15;
      rElbowZ = 1.15;
      lElbowX = -0.4;
      rElbowX = -0.4;
    } else if (pose === "crouch") {
      rig.chest.rotation.x = 0.22;
      lShoulderZ = 0.32;
      rShoulderX = -1.15;
      rElbowX = -1.25;
      headRoll += Math.sin(t * 9) * 0.04;
    } else if (pose === "sigh") {
      rig.chest.rotation.x = 0.12;
      lShoulderZ = 0.05;
      rShoulderZ = -0.05;
      headPitch += 0.14;
    } else if (pose === "step-forward") {
      const jump = Math.max(0, Math.sin(t * 3.8)) * 0.06;
      rig.root.position.y += jump;
      lHipX = -0.24;
      rHipX = 0.22;
      lKneeX = 0.25;
      lShoulderX = 0.25;
      rShoulderX = -0.32;
      lElbowX = -0.45;
      rElbowX = -0.55;
    }
  }

  // Apply joint rotations
  rig.head.rotation.set(headPitch, headYaw, headRoll);
  rig.leftShoulder.rotation.set(lShoulderX, 0, lShoulderZ);
  rig.leftElbow.rotation.set(lElbowX, 0, lElbowZ);
  rig.rightShoulder.rotation.set(rShoulderX, 0, rShoulderZ);
  rig.rightElbow.rotation.set(rElbowX, 0, rElbowZ);

  rig.leftHip.rotation.set(lHipX, 0, 0);
  rig.leftKnee.rotation.set(lKneeX, 0, 0);
  rig.rightHip.rotation.set(rHipX, 0, 0);
  rig.rightKnee.rotation.set(rKneeX, 0, 0);

  // Sweat drop slide
  if (rig.sweatDrop) {
    const sPhase = (elapsedSec * 0.9) % 1;
    rig.sweatDrop.position.y = 0.14 - sPhase * 0.18;
  }

  // Zzz float
  if (rig.zzzGroup) {
    rig.zzzGroup.position.y = 0.28 + Math.sin(elapsedSec * 2.2) * 0.05;
    rig.zzzGroup.rotation.y = elapsedSec * 0.8;
  }

  // Working think dots pulse
  if (rig.thinkDots.length > 0) {
    for (let i = 0; i < rig.thinkDots.length; i++) {
      const dot = rig.thinkDots[i];
      if (!dot) continue;
      const s = 0.75 + Math.sin(elapsedSec * 4.5 - i * 0.9) * 0.35;
      dot.scale.setScalar(Math.max(0.4, s));
    }
  }

  // The Sims 3D Plumbob spin & hover bobbing
  if (rig.plumbobGroup) {
    rig.plumbobGroup.rotation.y = elapsedSec * 2.3;
    const baseY = (rig.plumbobGroup.userData.baseY as number | undefined) ?? 0.45;
    rig.plumbobGroup.position.y = baseY + Math.sin(elapsedSec * 3.4) * 0.032;
  }
}

// ---------------------------------------------------------------------------
// ThreeCharacterView — Standalone 3D Character Canvas Component
// ---------------------------------------------------------------------------

export interface ThreeCharacterViewProps extends CharacterBuildOptions {
  width: number;
  height: number;
  className?: string;
  haloColor?: string;
  /** Initial subtle yaw angle so characters face 3/4 Sims style. Default 0.28. */
  baseYaw?: number;
}

export function ThreeCharacterView({
  width,
  height,
  className,
  haloColor,
  baseYaw = 0.28,
  ...buildOpts
}: ThreeCharacterViewProps) {
  const rigRef = useRef<CharacterRig3D | null>(null);
  const mode = buildOpts.mode ?? "full";

  const sceneKey = [
    buildOpts.parts.skinHue,
    buildOpts.parts.hairHue,
    buildOpts.parts.hair,
    buildOpts.parts.headRatio,
    buildOpts.expression.eye,
    buildOpts.expression.mouth,
    buildOpts.expression.brow,
    buildOpts.expression.pose,
    buildOpts.clothing?.shirt ?? "default",
    buildOpts.stylePreset ?? "default",
    mode,
    buildOpts.motion ?? "idle",
    buildOpts.glasses ?? "none",
    buildOpts.mustache ?? "none",
    buildOpts.beard ?? "none",
    buildOpts.earring ?? "none",
    buildOpts.scarf ?? "none",
    buildOpts.hat ?? "none",
    buildOpts.crown ? "crown" : "nocrown",
    buildOpts.showPlumbob === false ? "noplumbob" : "plumbob",
  ].join(":");

  return (
    <ThreeStageCanvas
      width={width}
      height={height}
      fov={28}
      fpsCap={28}
      sceneKey={sceneKey}
      className={className}
      style={haloColor ? { filter: `drop-shadow(0 0 2.5px ${haloColor})` } : undefined}
      setupScene={(scene, camera) => {
        // Studio 3-point PBR lighting + Sims emerald rim accent
        const hemi = new THREE.HemisphereLight(0xfff8f0, 0x3b4254, 1.4);
        scene.add(hemi);

        const keyLight = new THREE.DirectionalLight(0xfff5e4, 2.0);
        keyLight.position.set(2.4, 3.8, 3.2);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xa5c8ff, 0.8);
        fillLight.position.set(-2.5, 1.8, 2.0);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0x6ee7b7, 0.9);
        rimLight.position.set(-0.6, 3.2, -2.5);
        scene.add(rimLight);

        const rig = buildCharacterRig3D(buildOpts);
        rigRef.current = rig;
        scene.add(rig.root);

        // Frame camera according to render mode (including floating 3D Plumbob)
        const hCenter = rig.headCenterY;
        if (mode === "head") {
          camera.position.set(0.14, hCenter + 0.14, 1.88);
          camera.lookAt(0, hCenter + 0.08, 0);
        } else if (mode === "portrait" || mode === "bust") {
          camera.position.set(0.22, hCenter + 0.04, 2.55);
          camera.lookAt(0, hCenter - 0.08, 0);
        } else if (mode === "body") {
          const midBody = hCenter * 0.46;
          camera.position.set(0.18, midBody, 2.45);
          camera.lookAt(0, midBody, 0);
        } else {
          // full body + overhead Plumbob in 3/4 Sims isometric-style framing
          const totalH = hCenter + 0.56;
          const midY = totalH * 0.49;
          camera.position.set(0.32, midY + 0.22, totalH * 2.12);
          camera.lookAt(0, midY, 0);
        }
      }}
      onFrame={(_scene, _camera, elapsedSec, _deltaSec, pointer) => {
        const rig = rigRef.current;
        if (!rig) return;
        rig.options = buildOpts;
        animateCharacterRig3D(rig, elapsedSec, pointer);
        if (rig.options.motion !== "resting" && rig.options.expression.pose !== "sleeping") {
          const hoverTurn = pointer.hovered ? pointer.localX * 0.28 : 0;
          rig.root.rotation.y = baseYaw + hoverTurn;
        }
      }}
    />
  );
}
