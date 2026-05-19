"use client";

import { useCallback, useState } from "react";

export interface HoverState<T> {
  /** Pointer x in viewBox coords, or null when not hovered. */
  x: number | null;
  /** Most recently resolved nearest item, or null. */
  item: T | null;
}

export interface UseHoverDetailReturn<T> {
  hover: HoverState<T>;
  setHover: (next: HoverState<T>) => void;
  onSvgMouseMove: (
    e: React.MouseEvent<SVGSVGElement>,
    viewBoxW: number,
    resolve: (vbX: number) => T | null,
  ) => void;
  onSvgMouseLeave: () => void;
}

export function svgClientToViewBox(
  svgEl: SVGSVGElement,
  clientX: number,
  viewBoxW: number,
): number {
  const rect = svgEl.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const ratio = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(viewBoxW, ratio * viewBoxW));
}

export function useHoverDetail<T>(): UseHoverDetailReturn<T> {
  const [hover, setHover] = useState<HoverState<T>>({ x: null, item: null });

  const onSvgMouseMove = useCallback(
    (
      e: React.MouseEvent<SVGSVGElement>,
      viewBoxW: number,
      resolve: (vbX: number) => T | null,
    ) => {
      const x = svgClientToViewBox(e.currentTarget, e.clientX, viewBoxW);
      const item = resolve(x);
      setHover({ x, item });
    },
    [],
  );

  const onSvgMouseLeave = useCallback(() => {
    setHover({ x: null, item: null });
  }, []);

  return { hover, setHover, onSvgMouseMove, onSvgMouseLeave };
}
