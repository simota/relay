import { describe, expect, it } from "bun:test";
import * as THREE from "three";
import { avatarPartsFromSeed, type SimCardModel } from "../_lib/fleet-hamlet";
import { getExpressionForMood } from "../_lib/fleet-hamlet-avatar-expression";
import type { RoomKind } from "../_lib/fleet-hamlet-house";
import {
  deriveMoodPalette,
  derivePets,
} from "../_lib/fleet-hamlet-room-companion";
import { deriveContainerContents } from "../_lib/fleet-hamlet-room-containers";
import { roomPalette } from "../_lib/fleet-hamlet-room-furniture";
import { deriveAchievements } from "../_lib/fleet-hamlet-room-life";
import { deriveRoomState } from "../_lib/fleet-hamlet-room-state";
import { deriveTemporal } from "../_lib/fleet-hamlet-room-temporal";
import {
  animateCharacterRig3D,
  buildCharacterRig3D,
  buildSimsPlumbob3D,
} from "./fleet-hamlet-three-character";
import {
  buildHouse3D,
  buildRoomDiorama3D,
  buildSimCityWorld3D,
} from "./fleet-hamlet-three-house";
import { disposeObject3D } from "./fleet-hamlet-three-stage";

function makeSampleSim(seed = 42, status: SimCardModel["status"] = "active"): SimCardModel {
  return {
    key: `claude:session-${seed}`,
    sessionType: "claude",
    sessionId: `session-${seed}`,
    repo: "relay",
    agentId: "agent-1",
    status,
    needs: [
      { key: "hunger", value: 80 },
      { key: "energy", value: 75 },
      { key: "social", value: 70 },
      { key: "fun", value: 85 },
      { key: "hygiene", value: 90 },
      { key: "bladder", value: 85 },
      { key: "comfort", value: 80 },
      { key: "environment", value: 88 },
    ],
    mood: {
      key: "focused",
      emoji: "🎯",
      label: "Focused",
      color: "#3b82f6",
    },
    stage: {
      key: "adult",
      emoji: "🧑",
      label: "Adult",
    },
    avatarSeed: seed,
    hue: 210,
    bornAt: 1_700_000_000_000,
    lastActiveAt: 1_700_000_600_000,
  };
}

describe("fleet-hamlet Three.js 3D character engine", () => {
  it("builds articulated 3D character rigs across hair styles, outfits, modes, and accessories", () => {
    const outfits = ["default", "taisho-wagara", "occult-academy"] as const;
    const modes = ["full", "head", "body", "portrait", "bust"] as const;
    const moods = ["focused", "happy", "energized", "stressed", "bored", "asleep"] as const;
    const hairs = ["short", "wavy", "bob", "topknot", "curly", "bald"] as const;

    for (let i = 0; i < 6; i++) {
      const baseParts = avatarPartsFromSeed(100 + i * 17, "adult");
      const parts = {
        ...baseParts,
        hair: hairs[i]!,
        hairStyle: (i % 4) as 0 | 1 | 2 | 3,
      };
      const expression = getExpressionForMood(moods[i % moods.length]!);

      const rig = buildCharacterRig3D({
        parts,
        expression,
        stylePreset: outfits[i % outfits.length]!,
        mode: modes[i % modes.length]!,
        glasses: i % 2 === 0 ? "round" : "square",
        mustache: i === 1 ? "handlebar" : "none",
        beard: i === 2 ? "goatee" : "none",
        earring: i === 3 ? "both" : "none",
        scarf: i === 4 ? "knit" : "none",
        hat: i === 5 ? "scholar" : "none",
        crown: i === 0,
      });

      expect(rig.root).toBeInstanceOf(THREE.Group);
      expect(rig.hips).toBeInstanceOf(THREE.Group);
      expect(rig.chest).toBeInstanceOf(THREE.Group);
      expect(rig.head).toBeInstanceOf(THREE.Group);
      expect(rig.leftShoulder).toBeInstanceOf(THREE.Group);
      expect(rig.rightShoulder).toBeInstanceOf(THREE.Group);
      expect(rig.leftHip).toBeInstanceOf(THREE.Group);
      expect(rig.rightHip).toBeInstanceOf(THREE.Group);

      let meshCount = 0;
      rig.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) meshCount++;
      });
      expect(meshCount).toBeGreaterThan(15);

      disposeObject3D(rig.root);
    }
  });

  it("animates character skeletal joints across motion states and 3D cursor gaze", () => {
    const parts = avatarPartsFromSeed(777, "adult");
    const expression = getExpressionForMood("energized");
    const motions = ["idle", "walking", "working", "sitting", "resting"] as const;

    for (const motion of motions) {
      const rig = buildCharacterRig3D({
        parts,
        expression,
        motion,
        stylePreset: "taisho-wagara",
        crown: true,
      });

      animateCharacterRig3D(rig, 1.45, {
        clientX: 120,
        clientY: 80,
        localX: 0.4,
        localY: -0.25,
        hovered: true,
        orbitYaw: 0,
        orbitPitch: 0,
      });

      expect(Number.isFinite(rig.head.rotation.y)).toBe(true);
      expect(Number.isFinite(rig.leftShoulder.rotation.x)).toBe(true);
      expect(Number.isFinite(rig.leftHip.rotation.x)).toBe(true);

      disposeObject3D(rig.root);
    }
  });
});

describe("fleet-hamlet Three.js 3D house & cutaway room diorama engine", () => {
  it("builds 3D architectural houses across tiny/sm/md/lg sizes, events, bustle, and yard resident", () => {
    const sizes = ["tiny", "sm", "md", "lg"] as const;
    const sim = makeSampleSim(99);

    for (const sizeVariant of sizes) {
      const house = buildHouse3D({
        sim,
        sizeVariant,
        roofHue: 28,
        wallHue: 42,
        chimneyActive: true,
        highlight: sizeVariant === "lg",
        dim: sizeVariant === "sm",
        event:
          sizeVariant === "lg"
            ? {
                kind: "fire",
                sessionId: sim.sessionId,
                timestamp: 1_700_000_600_000,
                icon: "🔥",
                label: "Fire!",
                message: "Error spike",
                severity: "critical",
              }
            : sizeVariant === "md"
              ? {
                  kind: "achievement",
                  sessionId: sim.sessionId,
                  timestamp: 1_700_000_600_000,
                  icon: "🏆",
                  label: "Milestone",
                  message: "Skill up",
                  severity: "celebrate",
                }
              : undefined,
        windowsLit: true,
        bustle: {
          intensity: "party",
          subagentCount: 3,
          subagentHues: [45, 180, 300],
        },
        showYardResident: sizeVariant === "lg",
      });

      expect(house.root).toBeInstanceOf(THREE.Group);
      expect(house.windowMaterials.length).toBeGreaterThan(0);
      if (sizeVariant === "sm") {
        expect(house.smokePuffs.length).toBe(0);
      } else {
        expect(house.smokePuffs.length).toBeGreaterThan(0);
      }
      if (sizeVariant === "lg") {
        expect(house.yardResident).not.toBeNull();
        expect(house.fireCones.length).toBeGreaterThan(0);
      }
      if (sizeVariant === "md") {
        expect(house.achievementHalo).not.toBeNull();
      }

      disposeObject3D(house.root);
    }
  });

  it("builds cutaway 3D interior room dioramas for all 7 RoomKinds with furniture, plants, pets, and characters", () => {
    const rooms: readonly RoomKind[] = [
      "living",
      "workshop",
      "library",
      "nursery",
      "trophy",
      "study",
      "reception",
    ];
    const now = 1_700_000_600_000;
    const card = makeSampleSim(123);
    const roomState = deriveRoomState(card, undefined, [card], now);
    const achievements = deriveAchievements(card, undefined);
    const temporal = deriveTemporal(now);
    const moodPalette = deriveMoodPalette(card.mood.key);
    const petBundle = derivePets(card, now, 1);
    const containerContents = deriveContainerContents(card, undefined);

    for (let i = 0; i < rooms.length; i++) {
      const roomKind = rooms[i]!;
      const palette = roomPalette(roomKind, card.hue);
      const lampLight = new THREE.PointLight(0xffe0a3, 1.1, 5.5);

      const diorama = buildRoomDiorama3D(
        {
          card,
          roomKind,
          palette,
          moodPalette,
          tod: i % 2 === 0 ? "noon" : "night",
          weather: "clear",
          isDark: i % 2 === 1,
          roomState,
          achievements,
          temporal,
          containerContents,
          pets: petBundle.pets,
          guests: [
            {
              key: "claude:guest-1",
              cx: 170,
              groundY: 182,
              height: 48,
              seed: 333,
              sessionType: "claude",
              hue: 160,
              phase: 0.4,
            },
          ],
          hasRecentUserMessage: i === 0,
          motion: i === 1 ? "walking" : i === 2 ? "resting" : "working",
          stylePreset: i % 2 === 0 ? "default" : "occult-academy",
          clothing: {
            shirt: "hsl(210, 55%, 50%)",
            shirtDark: "hsl(210, 60%, 35%)",
            accent: "hsl(210, 75%, 75%)",
          },
          accessories: {
            glasses: "round",
            mustache: "none",
            beard: "none",
            earring: "left",
            scarf: "striped",
            hat: "scholar",
            crown: i === 4,
          },
        },
        lampLight,
      );

      expect(diorama.root).toBeInstanceOf(THREE.Group);
      expect(diorama.residentRig.root).toBeInstanceOf(THREE.Group);
      expect(diorama.guestRigs.length).toBe(1);
      if (i === 0) {
        expect(diorama.visitorRig).not.toBeNull();
      }

      disposeObject3D(diorama.root);
    }
  });

  it("builds 3D SimCity city block terrain, road grid, traffic vehicles, and Sims Plumbob crystals", () => {
    const plumbob = buildSimsPlumbob3D(0.12, "emerald");
    expect(plumbob).toBeInstanceOf(THREE.Group);
    expect(plumbob.children.length).toBeGreaterThanOrEqual(4);
    disposeObject3D(plumbob);

    const world = buildSimCityWorld3D({
      tod: "noon",
      weather: "clear",
      season: "spring",
      cols: 4,
      rows: 2,
      hasPark: true,
    });
    expect(world.root).toBeInstanceOf(THREE.Group);
    expect(world.vehicles.length).toBeGreaterThan(0);
    expect(world.fountainJets.length).toBeGreaterThan(0);
    expect(world.clouds.length).toBeGreaterThan(0);
    disposeObject3D(world.root);
  });
});
