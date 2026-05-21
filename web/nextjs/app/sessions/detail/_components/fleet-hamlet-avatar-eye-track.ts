"use client";

// Fleet Hamlet — atan2 eye tracking hook.
//
// `useEyeTrack` returns a pair of {dx, dy} pupil offsets in SVG units that
// caller can apply to a <g> wrapping the eye pupils. The offset is clamped
// to `maxOffset` SVG units and only updates on mousemove (throttled via
// requestAnimationFrame) so a screen of 50+ avatars stays under a few %
// of a frame budget.
//
// The hook gracefully no-ops when:
//   - `prefers-reduced-motion: reduce` is set
//   - the ref isn't mounted yet
//   - the consumer is in a non-DOM render (SSR)
//
// The offset is exposed as a React state so the JSX re-renders only when
// the rounded value actually changes — empirically that's ~2-5 renders per
// second per mouse-drag burst, which is well below 60Hz.

import { useEffect, useRef, useState } from "react";

export interface EyeTrackOffset {
  dx: number;
  dy: number;
}

const ZERO: EyeTrackOffset = { dx: 0, dy: 0 };

export function useEyeTrack(
  ref: React.RefObject<SVGGraphicsElement | null>,
  maxOffset: number,
  enabled: boolean = true,
): EyeTrackOffset {
  const [offset, setOffset] = useState<EyeTrackOffset>(ZERO);
  // Latest pointer in viewport coordinates; rAF reads this and computes.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // Last applied rounded value so we skip setState when nothing changed.
  const appliedRef = useRef<EyeTrackOffset>(ZERO);

  useEffect(() => {
    if (!enabled) {
      if (appliedRef.current.dx !== 0 || appliedRef.current.dy !== 0) {
        appliedRef.current = ZERO;
        setOffset(ZERO);
      }
      return;
    }
    if (typeof window === "undefined") return;

    // Respect OS-level "reduce motion" preference — eye tracking is a
    // continuous motion source even when no keyframes are running.
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let rafId: number | null = null;
    let lastFrame = 0;
    // ~30fps cap is more than enough for an eye-tracking effect and keeps
    // dozens of independent hooks on one page well-behaved.
    const FRAME_BUDGET_MS = 1000 / 30;

    const tick = (now: number) => {
      rafId = null;
      if (now - lastFrame < FRAME_BUDGET_MS) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;
      const node = ref.current;
      const pointer = pointerRef.current;
      if (!node || !pointer) return;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const dist = Math.hypot(dx, dy);
      // Below a small dead-zone radius, snap to centre so resting cursor
      // doesn't jiggle the pupils.
      if (dist < 4) {
        if (appliedRef.current.dx !== 0 || appliedRef.current.dy !== 0) {
          appliedRef.current = ZERO;
          setOffset(ZERO);
        }
        return;
      }
      const angle = Math.atan2(dy, dx);
      const ox = Math.round(Math.cos(angle) * maxOffset * 10) / 10;
      const oy = Math.round(Math.sin(angle) * maxOffset * 10) / 10;
      if (ox === appliedRef.current.dx && oy === appliedRef.current.dy) return;
      appliedRef.current = { dx: ox, dy: oy };
      setOffset(appliedRef.current);
    };

    const onMove = (event: PointerEvent | MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (rafId === null) {
        rafId = requestAnimationFrame(tick);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [ref, maxOffset, enabled]);

  return offset;
}
