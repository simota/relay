// Hamlet — Neighborhood selection persistence.
//
// The Neighborhood mode now renders as a 2-column layout (street on the
// left, rich Sim panel on the right). The "currently inspected" resident
// is tracked by a URL query param (`sel=`) and mirrored to localStorage
// so a bare `/sessions/detail?view=fleet&fv=hamlet&hm=neighborhood`
// landing still restores the last-viewed home.
//
// We deliberately keep this module dependency-free (no React, no Next) so
// that the same parsers/writers can be reused by the URL effect inside
// the FleetHamlet container.

/** localStorage key for the most-recent neighborhood selection. */
export const HAMLET_SELECTION_STORAGE_KEY =
  "relay.sessions.detail.hamletSelection";

/**
 * Decode the URL-encoded session id selected for the right-hand panel,
 * if any. Mirrors `parseHamletHouseId`'s defensive decode for robustness.
 */
export function parseHamletSelection(params: URLSearchParams): string | null {
  const raw = params.get("sel");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function readHamletSelectionPref(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(HAMLET_SELECTION_STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeHamletSelectionPref(sessionId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionId === null) {
      window.localStorage.removeItem(HAMLET_SELECTION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(HAMLET_SELECTION_STORAGE_KEY, sessionId);
    }
  } catch {
    // ignore — Safari private mode etc.
  }
}
