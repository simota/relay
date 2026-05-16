"use client";

import { type RefObject, useEffect, useRef } from "react";

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T | null>,
  isOpen: boolean,
): void {
  const restoreTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!isOpen || !root) return;

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== root &&
      !root.contains(activeElement)
    ) {
      activeElement.dataset.restoreFocus = "true";
      restoreTargetRef.current = activeElement;
    }

    const focusFirst = () => {
      const tabbable = getTabbableElements(root);
      const target = tabbable[0] ?? root;
      if (!target.hasAttribute("tabindex")) {
        root.tabIndex = -1;
      }
      target.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const tabbable = getTabbableElements(root);
      if (tabbable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }

      const first = tabbable[0]!;
      const last = tabbable[tabbable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const frame = requestAnimationFrame(focusFirst);
    root.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("keydown", onKeyDown);
      restoreFocus(restoreTargetRef.current);
      restoreTargetRef.current = null;
    };
  }, [isOpen, ref]);
}

function getTabbableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0 &&
      isVisible(element),
  );
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

function restoreFocus(target: HTMLElement | null): void {
  if (!target) return;
  const shouldRestore = target.dataset.restoreFocus === "true";
  delete target.dataset.restoreFocus;
  if (shouldRestore && target.isConnected) {
    target.focus();
  }
}
