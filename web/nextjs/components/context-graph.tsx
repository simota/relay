"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextGraphData, ContextGraphNodeType } from "@/lib/api";

interface SimNode {
  id: string;
  type: ContextGraphNodeType;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  orphan: boolean;
}

interface SimEdge {
  from: SimNode;
  to: SimNode;
  weight: number;
}

interface Selection {
  node: SimNode;
  left: number;
  top: number;
}

const RADIUS: Record<ContextGraphNodeType, number> = { context: 8, task: 7, repo: 9 };
const COLOR_VAR: Record<ContextGraphNodeType, string> = {
  context: "--color-cool",
  task: "--color-accent",
  repo: "--color-warm",
};

export function ContextGraph({ data }: { data: ContextGraphData }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphRef = useRef<{ nodes: SimNode[]; edges: SimEdge[] }>({ nodes: [], edges: [] });
  const [selection, setSelection] = useState<Selection | null>(null);

  const stats = useMemo(() => {
    const counts = { context: 0, task: 0, repo: 0 };
    for (const node of data.nodes) counts[node.type]++;
    return counts;
  }, [data.nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const css = getComputedStyle(document.documentElement);
    const colors = {
      bg: css.getPropertyValue("--color-bg").trim(),
      fg: css.getPropertyValue("--color-fg").trim(),
      muted: css.getPropertyValue("--color-fg-muted").trim(),
      dim: css.getPropertyValue("--color-fg-dim").trim(),
      border: css.getPropertyValue("--color-border").trim(),
      critical: css.getPropertyValue("--color-critical").trim(),
      context: css.getPropertyValue(COLOR_VAR.context).trim(),
      task: css.getPropertyValue(COLOR_VAR.task).trim(),
      repo: css.getPropertyValue(COLOR_VAR.repo).trim(),
    };
    const nodeColor = (type: ContextGraphNodeType) => colors[type];
    const taskLinks = new Set<string>();
    for (const edge of data.edges) {
      if (edge.from.startsWith("context:") && edge.to.startsWith("task:")) taskLinks.add(edge.from);
      if (edge.to.startsWith("context:") && edge.from.startsWith("task:")) taskLinks.add(edge.to);
    }

    const place = (index: number, total: number, w: number, h: number) => {
      const angle = (index / Math.max(total, 1)) * Math.PI * 2;
      const radius = Math.min(w, h) * 0.3;
      return { x: w / 2 + Math.cos(angle) * radius, y: h / 2 + Math.sin(angle) * radius };
    };

    const buildGraph = (w: number, h: number) => {
      const nodes = data.nodes.map((node, index) => {
        const pos = place(index, data.nodes.length, w, h);
        return { ...node, ...pos, vx: 0, vy: 0, orphan: node.type === "context" && !taskLinks.has(node.id) };
      });
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const edges = data.edges.flatMap((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        return from && to ? [{ from, to, weight: edge.weight }] : [];
      });
      graphRef.current = { nodes, edges };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildGraph(rect.width, rect.height);
    };

    const tick = (w: number, h: number) => {
      const { nodes, edges } = graphRef.current;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist2 = Math.max(dx * dx + dy * dy, 36);
          const force = 900 / dist2;
          a.vx -= dx * force;
          a.vy -= dy * force;
          b.vx += dx * force;
          b.vy += dy * force;
        }
      }
      for (const edge of edges) {
        const dx = edge.to.x - edge.from.x;
        const dy = edge.to.y - edge.from.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const target = edge.weight > 1 ? 74 : 96;
        const force = (dist - target) * 0.012 * edge.weight;
        edge.from.vx += (dx / dist) * force;
        edge.from.vy += (dy / dist) * force;
        edge.to.vx -= (dx / dist) * force;
        edge.to.vy -= (dy / dist) * force;
      }
      for (const node of nodes) {
        node.vx += (w / 2 - node.x) * 0.002;
        node.vy += (h / 2 - node.y) * 0.002;
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x = Math.min(w - 24, Math.max(24, node.x + node.vx));
        node.y = Math.min(h - 24, Math.max(24, node.y + node.vy));
      }
    };

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      tick(rect.width, rect.height);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.lineCap = "round";
      for (const edge of graphRef.current.edges) {
        ctx.strokeStyle = edge.weight > 1 ? colors.fg : colors.border;
        ctx.globalAlpha = edge.weight > 1 ? 0.7 : 0.55;
        ctx.lineWidth = edge.weight > 1 ? 3 : 1;
        ctx.beginPath();
        ctx.moveTo(edge.from.x, edge.from.y);
        ctx.lineTo(edge.to.x, edge.to.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const node of graphRef.current.nodes) {
        const r = RADIUS[node.type];
        ctx.fillStyle = nodeColor(node.type);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = node.orphan ? colors.critical : colors.bg;
        ctx.lineWidth = node.orphan ? 3 : 2;
        ctx.stroke();
        ctx.fillStyle = node.type === "repo" ? colors.fg : colors.muted;
        ctx.font = node.type === "repo" ? "600 11px var(--font-mono)" : "10px var(--font-mono)";
        ctx.textAlign = "center";
        ctx.fillText(trimLabel(node.label), node.x, node.y + r + 13);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    let frame = 0;
    const loop = () => {
      draw();
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [data]);

  const selectNode = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = graphRef.current.nodes.find((node) => Math.hypot(node.x - x, node.y - y) <= RADIUS[node.type] + 6);
    setSelection(hit ? { node: hit, left: hit.x, top: hit.y } : null);
  };

  return (
    <div className="relative h-[calc(100vh-132px)] min-h-[520px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
        onClick={selectNode}
        aria-label="Context graph"
      />
      <div className="absolute left-3 top-3 flex gap-2 text-[11px] font-mono text-[var(--color-fg-muted)]">
        <LegendDot label={`contexts ${stats.context}`} className="bg-[var(--color-cool)]" />
        <LegendDot label={`tasks ${stats.task}`} className="bg-[var(--color-accent)]" />
        <LegendDot label={`repos ${stats.repo}`} className="bg-[var(--color-warm)]" />
      </div>
      {selection && (
        <div
          className="absolute z-10 w-[260px] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 shadow-[var(--shadow-pop)]"
          style={{
            left: `min(${selection.left + 14}px, calc(100% - 276px))`,
            top: `max(${selection.top - 14}px, 16px)`,
          }}
        >
          <div className="text-[10px] uppercase text-[var(--color-fg-dim)]">{selection.node.type}</div>
          <div className="mt-1 break-words font-mono text-[12px] text-[var(--color-fg)]">{selection.node.label}</div>
          <div className="mt-2 break-all font-mono text-[10.5px] text-[var(--color-fg-dim)]">{selection.node.id}</div>
          {selection.node.orphan && (
            <div className="mt-2 text-[11px] text-[var(--color-critical)]">linked task 0</div>
          )}
        </div>
      )}
    </div>
  );
}

function LegendDot({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-2 py-1">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function trimLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 21)}...` : label;
}
