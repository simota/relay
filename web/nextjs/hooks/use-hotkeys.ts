"use client";
import { useEffect } from "react";

/**
 * Hotkey hook with optional 2-key vim-style sequences.
 *
 * Single key:    `key: "/"`           — fires immediately.
 * Modified:      `key: "Meta+k"`      — Cmd or Ctrl + k.
 * Sequence:      `key: "g t"`         — press `g`, then `t` within SEQ_WINDOW_MS.
 *
 * `allowInInput` lets a hotkey fire while typing into an <input> / <textarea>.
 * `enabled = false` skips the binding (handy for modal-open guards).
 *
 * All hook instances share ONE window listener and ONE pending-leader state.
 * This is load-bearing: the app shell registers `g s` / `g c` / … while pages
 * register single-key `s` / `c`. With per-instance listeners the page instance
 * doesn't know a leader is pending, so `g c` (navigate to Contexts) would also
 * fire `c` (close task). The shared registry resolves sequences across every
 * mounted instance before any single-key binding is considered.
 *
 * When a sequence's prefix matches (e.g. `g`), the keydown is consumed and
 * we wait for the second key. Pressing Escape or any non-matching key cancels.
 */

const SEQ_WINDOW_MS = 1500;

export interface Hotkey {
  key: string;
  handler: (e: KeyboardEvent) => void;
  enabled?: boolean;
  allowInInput?: boolean;
}

interface ParsedKey {
  raw: string;
  parts: string[];                // ["g", "t"] for sequences, ["t"] for singles
  modifiers: { meta: boolean; ctrl: boolean; shift: boolean; alt: boolean };
}

interface RegistryEntry {
  bindings: Array<{ hk: Hotkey; parsed: ParsedKey }>;
}

const registry = new Set<RegistryEntry>();
let pending: { leader: string; timer: ReturnType<typeof setTimeout> } | null = null;

function cancelPending() {
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
}

function allBindings(): Array<{ hk: Hotkey; parsed: ParsedKey }> {
  const out: Array<{ hk: Hotkey; parsed: ParsedKey }> = [];
  for (const entry of registry) out.push(...entry.bindings);
  return out;
}

function onKey(e: KeyboardEvent) {
  const inInput =
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement ||
    (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable);

  // Escape always cancels a pending leader.
  if (e.key === "Escape" && pending) {
    cancelPending();
    // fall through so other Escape handlers (e.g. modal close) still run
  }

  const bindings = allBindings();

  // Resolve second key of a pending sequence
  if (pending && !isModifierKey(e)) {
    const leader = pending.leader;
    const wantLeader = bindings.filter(
      ({ hk, parsed: p }) =>
        hk.enabled !== false && (inInput ? hk.allowInInput : true) &&
        p.parts.length === 2 && p.parts[0] === leader &&
        !p.modifiers.meta && !p.modifiers.ctrl && !p.modifiers.shift && !p.modifiers.alt,
    );
    for (const { hk, parsed: p } of wantLeader) {
      if (matchesSecond(p.parts[1]!, e)) {
        cancelPending();
        e.preventDefault();
        hk.handler(e);
        return;
      }
    }
    // Not a match — drop the pending leader and proceed normally
    cancelPending();
  }

  // Plain single-key hotkeys + modifier matches
  for (const { hk, parsed: p } of bindings) {
    if (hk.enabled === false) continue;
    if (inInput && !hk.allowInInput) continue;
    if (p.parts.length === 1 && matchesSingle(p, e)) {
      hk.handler(e);
      return;
    }
  }

  // Did the user just press a leader for some sequence?
  if (isLeaderKey(e, inInput, bindings)) {
    pending = {
      leader: e.key.toLowerCase(),
      timer: setTimeout(cancelPending, SEQ_WINDOW_MS),
    };
    e.preventDefault();
  }
}

export function useHotkeys(hotkeys: Hotkey[]) {
  useEffect(() => {
    const entry: RegistryEntry = {
      bindings: hotkeys.map((hk) => ({ hk, parsed: parseKey(hk.key) })),
    };
    registry.add(entry);
    if (registry.size === 1) window.addEventListener("keydown", onKey);
    return () => {
      registry.delete(entry);
      if (registry.size === 0) {
        window.removeEventListener("keydown", onKey);
        cancelPending();
      }
    };
  }, [hotkeys]);
}

function parseKey(spec: string): ParsedKey {
  // Sequences are space-separated; modifiers are +-joined within a part.
  const tokens = spec.split(/\s+/);
  if (tokens.length === 1) {
    const t = tokens[0]!;
    const parts = t.split("+");
    return {
      raw: spec,
      parts: [parts.at(-1)!],
      modifiers: {
        meta: parts.includes("Meta"),
        ctrl: parts.includes("Ctrl"),
        shift: parts.includes("Shift"),
        alt: parts.includes("Alt"),
      },
    };
  }
  return {
    raw: spec,
    parts: tokens,
    modifiers: { meta: false, ctrl: false, shift: false, alt: false },
  };
}

function matchesSingle(p: ParsedKey, e: KeyboardEvent): boolean {
  if (p.modifiers.meta !== (e.metaKey || e.ctrlKey)) return false;
  if (p.modifiers.ctrl && !e.ctrlKey) return false;
  if (p.modifiers.shift !== e.shiftKey) return false;
  if (p.modifiers.alt !== e.altKey) return false;
  return e.key === p.parts[0] || e.key.toLowerCase() === p.parts[0]!.toLowerCase();
}

function matchesSecond(want: string, e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key === want || e.key.toLowerCase() === want.toLowerCase();
}

function isLeaderKey(
  e: KeyboardEvent,
  inInput: boolean,
  bindings: Array<{ hk: Hotkey; parsed: ParsedKey }>,
): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return bindings.some(
    ({ hk, parsed: p }) =>
      hk.enabled !== false && (inInput ? hk.allowInInput : true) &&
      p.parts.length === 2 &&
      (p.parts[0] === e.key || p.parts[0] === e.key.toLowerCase()),
  );
}

function isModifierKey(e: KeyboardEvent): boolean {
  return e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta";
}
