"use client";

import { Billboard, OrbitControls, Sparkles, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { useSessionDetails } from "../_hooks/use-session-details";
import {
  buildCosmos,
  type Cosmos,
  hslColor,
  type MessagePoint,
} from "../_lib/fleet-cosmos";
import type { TileSpec } from "../_types";
import type { FleetViewData } from "./fleet-view";

// 6h window: messages within the last hour read as bright "live" cards,
// fading toward transparent as they slide to the back. Older messages
// hold at MIN_OPACITY so history is still visible as a misty backdrop.
const WINDOW_MS = 6 * 60 * 60 * 1000;
const NOW_TICK_MS = 30_000;

interface Props {
  data: FleetViewData;
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
}

export function FleetCosmos3D({
  data,
  selectedKeys,
  onPickSession,
  canAdd,
}: Props) {
  const { sessions, streamStatus, error } = data;
  const details = useSessionDetails(sessions);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(handle);
  }, []);

  const cosmos = useMemo<Cosmos | null>(() => {
    if (sessions.length === 0) return null;
    return buildCosmos(sessions, details, { now, windowMs: WINDOW_MS });
  }, [sessions, details, now]);

  const [hover, setHover] = useState<MessagePoint | null>(null);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-2 flex items-center gap-2 flex-wrap text-[11px] font-mono text-[var(--color-fg-dim)] border-b border-[var(--color-border)]">
        <span>{cosmos?.points.length ?? 0} messages</span>
        <span>last 6h</span>
        <StreamPill status={streamStatus} />
        <span className="ml-auto text-[10px]">
          drag: orbit · wheel: zoom · click: open
        </span>
      </div>
      <div
        className="flex-1 min-h-0 relative"
        style={{
          background:
            "radial-gradient(ellipse at center, #0d1330 0%, #02030a 70%, #000 100%)",
        }}
      >
        {error && (
          <div className="absolute top-2 left-6 text-[12px] text-[var(--color-danger,#dc2626)] z-10 pointer-events-none">
            fleet load failed: {error}
          </div>
        )}
        {!cosmos && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/50">
            loading cosmos…
          </div>
        )}
        {cosmos && cosmos.points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/50">
            no messages yet — open a session as a tile to populate the cosmos.
          </div>
        )}
        {cosmos && cosmos.points.length > 0 && (
          <Canvas
            camera={{
              position: cameraStart(cosmos),
              fov: 55,
              near: 0.1,
              far: 200,
            }}
            dpr={[1, 1.8]}
            style={{ background: "transparent" }}
          >
            <ambientLight intensity={0.35} />
            <pointLight position={[0, 0, 18]} intensity={1.2} color={0x9ec5ff} />
            <pointLight position={[-15, 12, -8]} intensity={0.6} color={0xff8fd6} />
            <Sparkles
              count={240}
              scale={[80, 56, 80]}
              size={3}
              speed={0.25}
              opacity={0.65}
              color={0xb6ccff}
            />
            <OrbitControls
              enablePan
              enableRotate
              enableZoom
              dampingFactor={0.08}
              autoRotate
              autoRotateSpeed={0.35}
            />
            <CosmosScene
              cosmos={cosmos}
              selectedKeys={selectedKeys}
              canAdd={canAdd}
              hoverKey={hover?.key ?? null}
              setHover={setHover}
              onPickSession={onPickSession}
            />
            <EffectComposer>
              {/* Bloom kept subtle so the white message cards don't
                  blow out their text — the glow should accent the
                  sparkles and lights, not the OS-style panels. */}
              <Bloom
                intensity={0.45}
                luminanceThreshold={0.85}
                luminanceSmoothing={0.5}
                mipmapBlur
              />
            </EffectComposer>
          </Canvas>
        )}
        {hover && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none bg-black/60 backdrop-blur border border-white/15 rounded-md px-3 py-2 text-[11px] font-mono text-white/90 max-w-[60%]">
            <div
              className="text-[10px] uppercase tracking-wider"
              style={{ color: hslColor(hover.hue, 70, 70) }}
            >
              {hover.kind} · {hover.sessionRepo ?? "—"}
            </div>
            <div className="text-white/95">{hover.summary || "(empty)"}</div>
            <div className="text-white/40 text-[10px]">{formatClock(hover.ts)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function cameraStart(cosmos: Cosmos): [number, number, number] {
  // Sit above and slightly off-axis so the camera reads the full X-Y
  // spread *and* the Z depth at the same time. The camera target stays
  // at the origin via OrbitControls' default.
  const x = cosmos.bounds.x * 0.5;
  const y = cosmos.bounds.y * 0.45;
  const z = cosmos.bounds.depth * 0.5 + 18;
  return [x, y, z];
}

function CosmosScene({
  cosmos,
  selectedKeys,
  canAdd,
  hoverKey,
  setHover,
  onPickSession,
}: {
  cosmos: Cosmos;
  selectedKeys: ReadonlySet<string>;
  canAdd: boolean;
  hoverKey: string | null;
  setHover: (p: MessagePoint | null) => void;
  onPickSession: (spec: TileSpec) => void;
}) {
  return (
    <group>
      {cosmos.points.map((p) => {
        const sel = selectedKeys.has(p.sessionKey);
        const disabled = !canAdd && !sel;
        return (
          <MessageWindow
            key={p.key}
            point={p}
            hovered={hoverKey === p.key}
            selected={sel}
            disabled={disabled}
            onHover={(h) => setHover(h ? p : null)}
            onClick={() => {
              if (disabled) return;
              const parts = p.sessionKey.split(":");
              const t = parts[0] as TileSpec["type"];
              const id = p.sessionKey.slice(t.length + 1);
              onPickSession({ type: t, id });
            }}
          />
        );
      })}
    </group>
  );
}

// OZ Message-style floating window pane. Each user/assistant message
// renders as a small white card with a tinted header bar and truncated
// body text. Billboard keeps every card facing the orbiting camera so the
// text stays readable even as the scene rotates.
function MessageWindow({
  point,
  hovered,
  selected,
  disabled,
  onHover,
  onClick,
}: {
  point: MessagePoint;
  hovered: boolean;
  selected: boolean;
  disabled: boolean;
  onHover: (h: boolean) => void;
  onClick: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const freshRef = useRef<THREE.Group>(null);
  const haloMatRef = useRef<THREE.MeshBasicMaterial>(null);
  // Stronger overshoot: card grows fast to 1.55, then eases back to 1.0
  // over ~800ms. Combined with the flash plane below, brand-new messages
  // make a clear "incoming" beat instead of just fading into the scene.
  const [appear, setAppear] = useState(0);
  useEffect(() => {
    let raf = 0;
    let t = 0;
    const step = () => {
      t = Math.min(1, t + 0.04);
      const val =
        t < 0.55
          ? (t / 0.55) * 1.55
          : 1.55 - ((t - 0.55) / 0.45) * 0.55;
      setAppear(val);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // One-shot entry flash. Independent of the freshness halo so even an
  // older message that loaded late (cache miss / late detail fetch) still
  // gets a single visible "I just appeared" beat.
  const [entryFade, setEntryFade] = useState(1);
  useEffect(() => {
    let raf = 0;
    let t = 0;
    const step = () => {
      t = Math.min(1, t + 0.03);
      setEntryFade(1 - t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      const phase = point.position[0] * 0.5 + point.position[1] * 0.3;
      groupRef.current.position.y =
        point.position[1] + Math.sin(t * 0.4 + phase) * 0.06;
    }
    if (point.isFresh) {
      // Card pulse: subtle scale breath so the eye locks on without the
      // whole scene flashing. ~ ±5% range at 1.6 Hz.
      const breath = 1 + Math.sin(t * 3.2) * 0.05;
      if (freshRef.current) freshRef.current.scale.setScalar(breath);
      // Halo: stronger pulse on the surrounding glow plane.
      if (haloMatRef.current) {
        haloMatRef.current.opacity = 0.3 + Math.abs(Math.sin(t * 2.4)) * 0.55;
      }
    }
  });

  // Window geometry. Hover bumps the whole card so the text becomes
  // legible without the user having to dive in with the camera.
  const W = 5.5;
  const H = 3.5;
  const HEADER_H = 0.5;
  const scale = appear * (hovered ? 1.45 : selected ? 1.1 : 1);
  const headerColor = hslColor(point.hue, 55, 80);
  const kindLabel = point.kind === "user" ? "USER" : "ASSISTANT";
  const typeLabel = displayType(point.sessionType);
  const headerRight = `${typeLabel} · ${point.sessionRepo ?? "—"} · ${formatHHMM(point.ts)}`;
  // Hard cap at 160 chars / 6 lines so even all-CJK summaries (≈ 21 chars
  // per line at fontSize 0.24, maxWidth ≈ 5.06) stay inside the card.
  // Latin summaries usually exhaust the character budget first.
  const body = truncateForCard(point.summary, { maxChars: 160, maxLines: 6 });

  // Hover pops the card back to full opacity so even very old cards
  // become readable on inspection. Otherwise the global age-based
  // opacity dominates so the room reads as "fresh in front, history
  // dissolving behind".
  const op = hovered ? 1 : disabled ? Math.min(0.5, point.opacity) : point.opacity;

  return (
    <group
      ref={groupRef}
      position={point.position}
      onPointerEnter={(e) => {
        e.stopPropagation();
        onHover(true);
      }}
      onPointerLeave={() => onHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Billboard follow={true}>
        <group scale={scale}>
         <group ref={freshRef}>
          {/* One-shot entry flash — a bright white plane behind the card
              that fades within ~540ms of mount. Reads as "a card just
              materialized here" even when the card itself is small. */}
          {entryFade > 0.01 && (
            <mesh position={[0, 0, -0.015]}>
              <planeGeometry args={[W * 2.1, H * 2.1]} />
              <meshBasicMaterial
                color="white"
                transparent
                opacity={entryFade * 0.7}
                toneMapped={false}
                depthWrite={false}
              />
            </mesh>
          )}
          {/* Freshness halo — only rendered for cards within FRESH_MS so
              older messages never compete for attention. Sits behind the
              card body and pulses via useFrame opacity drives. */}
          {point.isFresh && (
            <mesh position={[0, 0, -0.01]}>
              <planeGeometry args={[W + 0.7, H + 0.7]} />
              <meshBasicMaterial
                ref={haloMatRef}
                color={headerColor}
                transparent
                opacity={0.5}
                toneMapped={false}
                depthWrite={false}
              />
            </mesh>
          )}
          {/* Card body */}
          <mesh>
            <planeGeometry args={[W, H]} />
            <meshBasicMaterial
              color="#f4f4f4"
              transparent
              opacity={op * 0.95}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
          {/* Header bar */}
          <mesh position={[0, H / 2 - HEADER_H / 2, 0.001]}>
            <planeGeometry args={[W, HEADER_H]} />
            <meshBasicMaterial
              color={headerColor}
              transparent
              opacity={op}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
          {/* Subtle outer outline so cards read as distinct slabs even
              when packed close together. */}
          <lineSegments position={[0, 0, 0.0005]}>
            <edgesGeometry args={[new THREE.PlaneGeometry(W, H)]} />
            <lineBasicMaterial
              color={selected ? "#7dd3fc" : "#222"}
              transparent
              opacity={(selected ? 0.9 : 0.35) * op}
              toneMapped={false}
            />
          </lineSegments>
          {/* Header text — left-aligned like a real OS window title bar.
              maxWidth caps it at 32% of the card so the right-side meta
              never overlaps. */}
          <Text
            position={[-W / 2 + 0.2, H / 2 - HEADER_H / 2, 0.01]}
            anchorX="left"
            anchorY="middle"
            fontSize={0.24}
            maxWidth={W * 0.32}
            outlineWidth={0}
            overflowWrap="normal"
          >
            {`▣ ${kindLabel}`}
            <meshBasicMaterial
              color="#1f2937"
              transparent
              opacity={op}
              toneMapped={false}
              depthWrite={false}
            />
          </Text>
          {/* Type / repo / clock on the right edge of the header. */}
          <Text
            position={[W / 2 - 0.2, H / 2 - HEADER_H / 2, 0.01]}
            anchorX="right"
            anchorY="middle"
            fontSize={0.2}
            maxWidth={W * 0.66}
            overflowWrap="normal"
          >
            {headerRight}
            <meshBasicMaterial
              color="#4b5563"
              transparent
              opacity={op}
              toneMapped={false}
              depthWrite={false}
            />
          </Text>
          {/* Body — top-anchored so multi-line text grows downward.
              maxWidth wraps within the card and the pre-truncate above
              caps the line count so the text never spills past either
              the horizontal or vertical card bounds. */}
          <Text
            position={[-W / 2 + 0.24, H / 2 - HEADER_H - 0.22, 0.01]}
            anchorX="left"
            anchorY="top"
            fontSize={0.22}
            maxWidth={W - 0.48}
            lineHeight={1.3}
            textAlign="left"
            overflowWrap="break-word"
          >
            {body}
            <meshBasicMaterial
              color="#111"
              transparent
              opacity={op}
              toneMapped={false}
              depthWrite={false}
            />
          </Text>
         </group>
        </group>
      </Billboard>
    </group>
  );
}

function truncateForCard(
  s: string,
  { maxChars, maxLines }: { maxChars: number; maxLines: number },
): string {
  const trimmed = s.trim();
  // First clamp character count, then clamp line count on the result so
  // the renderer can't be surprised by either dimension.
  let limited = trimmed;
  if (limited.length > maxChars) {
    limited = `${limited.slice(0, maxChars - 1)}…`;
  }
  const lines = limited.split("\n");
  if (lines.length > maxLines) {
    limited = `${lines.slice(0, maxLines).join("\n")}…`;
  }
  return limited;
}

function StreamPill({
  status,
}: {
  status: "connecting" | "live" | "reconnecting" | "error" | "idle";
}) {
  const label = status === "live" ? "live" : status;
  const color =
    status === "live"
      ? "var(--color-accent)"
      : status === "error"
        ? "var(--color-danger,#dc2626)"
        : "var(--color-fg-dim)";
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[10px] font-mono")}
      style={{ color }}
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function displayType(t: MessagePoint["sessionType"]): string {
  switch (t) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "antigravity":
      return "antigravity";
  }
}
