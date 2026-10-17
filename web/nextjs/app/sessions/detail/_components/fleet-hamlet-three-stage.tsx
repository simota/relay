"use client";

// Fleet Hamlet — Shared Three.js WebGL Stage & Procedural PBR Texture Engine.
//
// Why a multiplexed offscreen WebGLRenderer?
// Browsers cap active WebGL contexts at ~8–16 per tab. Fleet Hamlet can
// simultaneously display 20+ houses, 20+ avatars, street walkers, park
// residents, and multiple Room Scene cells. By rendering every ThreeStageCanvas
// through a single shared offscreen `THREE.WebGLRenderer` and blitting the
// rendered viewport into each component's lightweight 2D `<canvas>`, the
// entire application consumes only ONE WebGL context while delivering
// full PBR materials, real lighting, soft shadows, and 60fps 3D animations.

import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Global Pointer & Reduced-Motion State
// ---------------------------------------------------------------------------

export interface StagePointerState {
  /** Global viewport pointer (clientX, clientY), null until first move. */
  clientX: number | null;
  clientY: number | null;
  /** Local normalized pointer [-1..+1] inside the canvas when hovered. */
  localX: number;
  localY: number;
  /** True while pointer is inside this specific canvas. */
  hovered: boolean;
  /** Accumulated orbit offset in radians from pointer dragging. */
  orbitYaw: number;
  orbitPitch: number;
}

const globalPointer = {
  clientX: null as number | null,
  clientY: null as number | null,
  listening: false,
};

function ensureGlobalPointerListener(): void {
  if (globalPointer.listening || typeof window === "undefined") return;
  globalPointer.listening = true;
  window.addEventListener(
    "pointermove",
    (e: PointerEvent) => {
      globalPointer.clientX = e.clientX;
      globalPointer.clientY = e.clientY;
    },
    { passive: true },
  );
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------
// Shared Offscreen WebGLRenderer & Render Loop Scheduler
// ---------------------------------------------------------------------------

interface RenderTask {
  id: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cssWidth: number;
  cssHeight: number;
  visible: boolean;
  pointer: StagePointerState;
  fpsCap: number;
  lastFrameMs: number;
  renderedOnce: boolean;
  onFrame?: (
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    elapsedSec: number,
    deltaSec: number,
    pointer: StagePointerState,
  ) => void;
}

class SharedThreeScheduler {
  private renderer: THREE.WebGLRenderer | null = null;
  private rendererW = 0;
  private rendererH = 0;
  private tasks = new Map<number, RenderTask>();
  private nextId = 1;
  private rafId: number | null = null;
  private startTimeMs = 0;
  private observer: IntersectionObserver | null = null;
  private canvasToTaskId = new WeakMap<Element, number>();

  private getRenderer(minW: number, minH: number): THREE.WebGLRenderer | null {
    if (typeof window === "undefined") return null;
    if (!this.renderer) {
      try {
        const offscreen = document.createElement("canvas");
        const r = new THREE.WebGLRenderer({
          canvas: offscreen,
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: false,
        });
        r.setPixelRatio(1);
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.12;
        r.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer = r;
        this.rendererW = 512;
        this.rendererH = 512;
        r.setSize(this.rendererW, this.rendererH, false);
      } catch {
        return null;
      }
    }
    if (minW > this.rendererW || minH > this.rendererH) {
      this.rendererW = Math.max(this.rendererW, Math.ceil(minW / 64) * 64);
      this.rendererH = Math.max(this.rendererH, Math.ceil(minH / 64) * 64);
      this.renderer.setSize(this.rendererW, this.rendererH, false);
    }
    return this.renderer;
  }

  private ensureObserver(): IntersectionObserver | null {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return null;
    }
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = this.canvasToTaskId.get(entry.target);
            if (id === undefined) continue;
            const task = this.tasks.get(id);
            if (task) {
              task.visible = entry.isIntersecting;
            }
          }
          this.schedule();
        },
        { rootMargin: "80px" },
      );
    }
    return this.observer;
  }

  register(task: Omit<RenderTask, "id" | "lastFrameMs" | "renderedOnce">): number {
    ensureGlobalPointerListener();
    const id = this.nextId++;
    const fullTask: RenderTask = {
      ...task,
      id,
      lastFrameMs: 0,
      renderedOnce: false,
    };
    this.tasks.set(id, fullTask);
    this.canvasToTaskId.set(task.canvas, id);
    const obs = this.ensureObserver();
    if (obs) {
      obs.observe(task.canvas);
    }
    this.schedule();
    return id;
  }

  updateTask(
    id: number,
    patch: Partial<Pick<RenderTask, "cssWidth" | "cssHeight" | "fpsCap" | "onFrame">>,
  ): void {
    const t = this.tasks.get(id);
    if (!t) return;
    if (patch.cssWidth !== undefined) t.cssWidth = patch.cssWidth;
    if (patch.cssHeight !== undefined) t.cssHeight = patch.cssHeight;
    if (patch.fpsCap !== undefined) t.fpsCap = patch.fpsCap;
    if (patch.onFrame !== undefined) t.onFrame = patch.onFrame;
    t.renderedOnce = false;
    this.schedule();
  }

  unregister(id: number): void {
    const t = this.tasks.get(id);
    if (!t) return;
    if (this.observer) {
      this.observer.unobserve(t.canvas);
    }
    this.canvasToTaskId.delete(t.canvas);
    this.tasks.delete(id);
    if (this.tasks.size === 0 && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  schedule(): void {
    if (this.rafId !== null || this.tasks.size === 0 || typeof window === "undefined") {
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (nowMs: number): void => {
    this.rafId = null;
    if (this.startTimeMs === 0) this.startTimeMs = nowMs;
    const elapsedSec = (nowMs - this.startTimeMs) * 0.001;
    const reduceMotion = prefersReducedMotion();
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);

    let hasActiveTasks = false;

    for (const task of this.tasks.values()) {
      if (!task.visible && task.renderedOnce) continue;
      if (reduceMotion && task.renderedOnce && !task.pointer.hovered) continue;

      hasActiveTasks = true;
      const effectiveFps = task.pointer.hovered ? Math.max(task.fpsCap, 45) : task.fpsCap;
      const frameBudgetMs = 1000 / Math.max(10, effectiveFps);
      if (task.renderedOnce && nowMs - task.lastFrameMs < frameBudgetMs) {
        continue;
      }

      const deltaSec = task.lastFrameMs > 0 ? Math.min(0.1, (nowMs - task.lastFrameMs) * 0.001) : 0.016;
      task.lastFrameMs = nowMs;

      const cssW = Math.max(1, Math.round(task.cssWidth));
      const cssH = Math.max(1, Math.round(task.cssHeight));
      const pixelW = Math.max(1, Math.round(cssW * dpr));
      const pixelH = Math.max(1, Math.round(cssH * dpr));

      if (task.canvas.width !== pixelW || task.canvas.height !== pixelH) {
        task.canvas.width = pixelW;
        task.canvas.height = pixelH;
      }

      const aspect = cssW / cssH;
      if (Math.abs(task.camera.aspect - aspect) > 0.001) {
        task.camera.aspect = aspect;
        task.camera.updateProjectionMatrix();
      }

      task.pointer.clientX = globalPointer.clientX;
      task.pointer.clientY = globalPointer.clientY;

      if (task.onFrame) {
        task.onFrame(task.scene, task.camera, elapsedSec, deltaSec, task.pointer);
      }

      const renderer = this.getRenderer(pixelW, pixelH);
      if (!renderer) continue;

      // Render into the top-left [0, 0, pixelW, pixelH] of the offscreen WebGL canvas.
      // Because WebGL viewport origin is bottom-left, y = rendererH - pixelH places
      // the viewport at the top-left of `renderer.domElement` for 2D `drawImage`.
      const viewportY = this.rendererH - pixelH;
      renderer.setViewport(0, viewportY, pixelW, pixelH);
      renderer.setScissor(0, viewportY, pixelW, pixelH);
      renderer.setScissorTest(true);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(task.scene, task.camera);

      task.ctx.clearRect(0, 0, pixelW, pixelH);
      task.ctx.drawImage(
        renderer.domElement,
        0,
        0,
        pixelW,
        pixelH,
        0,
        0,
        pixelW,
        pixelH,
      );
      task.renderedOnce = true;
    }

    if (hasActiveTasks && !reduceMotion) {
      this.schedule();
    }
  };
}

let schedulerInstance: SharedThreeScheduler | null = null;
function getScheduler(): SharedThreeScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new SharedThreeScheduler();
  }
  return schedulerInstance;
}

// ---------------------------------------------------------------------------
// ThreeStageCanvas Component
// ---------------------------------------------------------------------------

export interface ThreeStageCanvasProps {
  width: number;
  height: number;
  /** Initial camera position [x, y, z]. */
  cameraPosition?: readonly [number, number, number];
  /** Initial camera lookAt target [x, y, z]. */
  cameraTarget?: readonly [number, number, number];
  /** Vertical field of view in degrees. Default 34. */
  fov?: number;
  /** Target FPS cap when not hovered. Default 30. */
  fpsCap?: number;
  /** Enable pointer drag to orbit the camera. */
  interactiveOrbit?: boolean;
  /** Build and populate the scene once (or when deps change). Return a cleanup fn if needed. */
  setupScene: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => (() => void) | void;
  /** Per-frame animation callback. */
  onFrame?: (
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    elapsedSec: number,
    deltaSec: number,
    pointer: StagePointerState,
  ) => void;
  /** Dependency key that triggers scene rebuild when changed. */
  sceneKey?: string | number;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  onDoubleClick?: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  title?: string;
  ariaLabel?: string;
}

export function ThreeStageCanvas({
  width,
  height,
  cameraPosition = [0, 1.2, 4.2],
  cameraTarget = [0, 0.6, 0],
  fov = 34,
  fpsCap = 30,
  interactiveOrbit = false,
  setupScene,
  onFrame,
  sceneKey,
  className,
  style,
  onClick,
  onDoubleClick,
  title,
  ariaLabel,
}: ThreeStageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStateRef = useRef<StagePointerState>({
    clientX: null,
    clientY: null,
    localX: 0,
    localY: 0,
    hovered: false,
    orbitYaw: 0,
    orbitPitch: 0,
  });
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const taskIdRef = useRef<number | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      fov,
      Math.max(1, width) / Math.max(1, height),
      0.1,
      100,
    );
    camera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
    camera.lookAt(cameraTarget[0], cameraTarget[1], cameraTarget[2]);

    const cleanupUserScene = setupScene(scene, camera);

    const scheduler = getScheduler();
    const id = scheduler.register({
      canvas,
      ctx,
      scene,
      camera,
      cssWidth: width,
      cssHeight: height,
      visible: true,
      pointer: pointerStateRef.current,
      fpsCap,
      onFrame: (s, c, elapsed, delta, ptr) => {
        onFrameRef.current?.(s, c, elapsed, delta, ptr);
      },
    });
    taskIdRef.current = id;

    return () => {
      scheduler.unregister(id);
      taskIdRef.current = null;
      if (cleanupUserScene) cleanupUserScene();
      disposeObject3D(scene);
    };
    // Rebuild scene when sceneKey changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, fov]);

  useEffect(() => {
    if (taskIdRef.current !== null) {
      getScheduler().updateTask(taskIdRef.current, {
        cssWidth: width,
        cssHeight: height,
        fpsCap,
      });
    }
  }, [width, height, fpsCap]);

  const handlePointerEnter = () => {
    pointerStateRef.current.hovered = true;
    getScheduler().schedule();
  };

  const handlePointerLeave = () => {
    pointerStateRef.current.hovered = false;
    pointerStateRef.current.localX = 0;
    pointerStateRef.current.localY = 0;
    dragRef.current.active = false;
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      pointerStateRef.current.localX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerStateRef.current.localY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    }
    if (interactiveOrbit && dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      pointerStateRef.current.orbitYaw = Math.max(
        -0.75,
        Math.min(0.75, pointerStateRef.current.orbitYaw - dx * 0.008),
      );
      pointerStateRef.current.orbitPitch = Math.max(
        -0.35,
        Math.min(0.45, pointerStateRef.current.orbitPitch + dy * 0.006),
      );
    }
    getScheduler().schedule();
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactiveOrbit) return;
    dragRef.current.active = true;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width,
        height,
        display: "block",
        ...style,
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={title}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    />
  );
}

// ---------------------------------------------------------------------------
// Memory-Safe Scene Disposal (Preserves Cached Procedural Textures)
// ---------------------------------------------------------------------------

const preservedTextures = new WeakSet<THREE.Texture>();

function markPreserved(tex: THREE.Texture): THREE.Texture {
  preservedTextures.add(tex);
  return tex;
}

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        const std = m as THREE.MeshStandardMaterial;
        if (std.map && !preservedTextures.has(std.map)) std.map.dispose();
        if (std.bumpMap && !preservedTextures.has(std.bumpMap)) std.bumpMap.dispose();
        if (std.normalMap && !preservedTextures.has(std.normalMap)) std.normalMap.dispose();
        if (std.roughnessMap && !preservedTextures.has(std.roughnessMap)) std.roughnessMap.dispose();
        m.dispose();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Procedural PBR Textures (Cached Singletons)
// ---------------------------------------------------------------------------

let roofShingleTex: THREE.CanvasTexture | null = null;
export function getRoofShingleTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (roofShingleTex) return roofShingleTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#c8c8c8";
    ctx.fillRect(0, 0, 128, 128);
    const rows = 8;
    const cols = 6;
    const rowH = 128 / rows;
    const colW = 128 / cols;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (colW * 0.5);
      for (let col = -1; col <= cols; col++) {
        const x = col * colW + offset;
        const y = r * rowH;
        const shade = 185 + ((r * 17 + col * 31) % 45);
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x + 1, y + 1, colW - 2, rowH - 2);
        // Bottom overlap shadow
        ctx.fillStyle = "rgba(35,35,35,0.45)";
        ctx.fillRect(x, y + rowH - 2.5, colW, 2.5);
        // Side seam
        ctx.fillStyle = "rgba(50,50,50,0.32)";
        ctx.fillRect(x, y, 1.2, rowH);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  roofShingleTex = markPreserved(tex) as THREE.CanvasTexture;
  return roofShingleTex;
}

let brickWallTex: THREE.CanvasTexture | null = null;
export function getBrickWallTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (brickWallTex) return brickWallTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    // Mortar base
    ctx.fillStyle = "#b8b2a8";
    ctx.fillRect(0, 0, 128, 128);
    const rows = 8;
    const cols = 4;
    const rowH = 128 / rows;
    const colW = 128 / cols;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (colW * 0.5);
      for (let col = -1; col <= cols; col++) {
        const x = col * colW + offset;
        const y = r * rowH;
        const v = 195 + ((r * 23 + col * 19) % 40);
        ctx.fillStyle = `rgb(${v},${v - 6},${v - 12})`;
        ctx.fillRect(x + 1.5, y + 1.5, colW - 3, rowH - 3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  brickWallTex = markPreserved(tex) as THREE.CanvasTexture;
  return brickWallTex;
}

let plasterWallTex: THREE.CanvasTexture | null = null;
export function getPlasterWallTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (plasterWallTex) return plasterWallTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#e8e4dc";
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 600; i++) {
      const x = (i * 73) % 128;
      const y = (i * 41) % 128;
      const v = 215 + (i % 35);
      ctx.fillStyle = `rgba(${v},${v},${v - 5},0.35)`;
      ctx.fillRect(x, y, 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  plasterWallTex = markPreserved(tex) as THREE.CanvasTexture;
  return plasterWallTex;
}

let woodPlankTex: THREE.CanvasTexture | null = null;
export function getWoodPlankTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (woodPlankTex) return woodPlankTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    const planks = 6;
    const plankH = 128 / planks;
    for (let p = 0; p < planks; p++) {
      const base = 185 + ((p * 19) % 35);
      ctx.fillStyle = `rgb(${base},${base - 18},${base - 38})`;
      ctx.fillRect(0, p * plankH, 128, plankH);
      // Grain lines
      ctx.strokeStyle = "rgba(60,35,15,0.18)";
      ctx.lineWidth = 1;
      for (let g = 0; g < 4; g++) {
        const gy = p * plankH + 3 + g * (plankH / 4.5);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(42, gy + (g % 2 === 0 ? 1.5 : -1.5), 86, gy - 1, 128, gy);
        ctx.stroke();
      }
      // Plank seam
      ctx.fillStyle = "rgba(40,22,10,0.45)";
      ctx.fillRect(0, (p + 1) * plankH - 1.2, 128, 1.2);
      const jointX = ((p * 47 + 23) % 100) + 14;
      ctx.fillRect(jointX, p * plankH, 1.2, plankH);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  woodPlankTex = markPreserved(tex) as THREE.CanvasTexture;
  return woodPlankTex;
}

let marbleFloorTex: THREE.CanvasTexture | null = null;
export function getMarbleFloorTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (marbleFloorTex) return marbleFloorTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#f2f0ec";
    ctx.fillRect(0, 0, 128, 128);
    // Tile grid
    ctx.strokeStyle = "rgba(150,145,138,0.35)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= 4; i++) {
      const pos = i * 32;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, 128);
      ctx.moveTo(0, pos);
      ctx.lineTo(128, pos);
      ctx.stroke();
    }
    // Marble veins
    ctx.strokeStyle = "rgba(165,160,175,0.28)";
    ctx.lineWidth = 1.5;
    for (let v = 0; v < 7; v++) {
      ctx.beginPath();
      const sy = (v * 23) % 128;
      ctx.moveTo(0, sy);
      ctx.bezierCurveTo(40, sy + 14, 88, sy - 12, 128, (sy + 28) % 128);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  marbleFloorTex = markPreserved(tex) as THREE.CanvasTexture;
  return marbleFloorTex;
}

let fabricWeaveTex: THREE.CanvasTexture | null = null;
export function getFabricWeaveTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (fabricWeaveTex) return fabricWeaveTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#dcdcdc";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "rgba(90,90,90,0.22)";
    for (let y = 0; y < 64; y += 2) {
      for (let x = (y / 2) % 2; x < 64; x += 2) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  fabricWeaveTex = markPreserved(tex) as THREE.CanvasTexture;
  return fabricWeaveTex;
}

let grassLawnTex: THREE.CanvasTexture | null = null;
export function getGrassLawnTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (grassLawnTex) return grassLawnTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#6ca854";
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) {
      const x = (i * 53) % 128;
      const y = (i * 89) % 128;
      ctx.fillStyle = i % 2 === 0 ? "rgba(130,195,95,0.4)" : "rgba(65,115,48,0.35)";
      ctx.fillRect(x, y, 2, 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  grassLawnTex = markPreserved(tex) as THREE.CanvasTexture;
  return grassLawnTex;
}
