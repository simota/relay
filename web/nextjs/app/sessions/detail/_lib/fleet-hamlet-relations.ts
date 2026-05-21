// Hamlet — Relationships.
//
// Pairwise score 0..100 between this resident and every other resident,
// classified into Family / Best Friend / Friend / Acquaintance / Stranger.
//
// Strangers are dropped from the returned list — the UI never needs
// "no relationship" rows.

import type { SimCardModel } from "./fleet-hamlet";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RelationshipKind =
  | "family-parent"
  | "family-child"
  | "sibling"
  | "housemate"
  | "rival";

export interface Relationship {
  kind: RelationshipKind;
  /** 0..100 inclusive. */
  score: number;
  /** Display label derived from the score band (Family / Best Friend / …). */
  label: string;
  target: SimCardModel;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const SCORE_BY_KIND: Record<RelationshipKind, number> = {
  "family-parent": 90,
  "family-child": 90,
  sibling: 75,
  housemate: 55,
  rival: 35,
};

const RECENT_BONUS_WINDOW_MS = 60 * 60 * 1000; // 1h
const RECENT_BONUS = 5;

// ---------------------------------------------------------------------------
// Compute relationships for one card vs. all others
// ---------------------------------------------------------------------------

export function computeRelationships(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
  now: number,
): Relationship[] {
  const out: Relationship[] = [];
  for (const other of allCards) {
    if (other.key === card.key) continue;
    const kind = classify(card, other);
    if (!kind) continue;
    let score = SCORE_BY_KIND[kind];
    if (
      now - card.lastActiveAt <= RECENT_BONUS_WINDOW_MS &&
      now - other.lastActiveAt <= RECENT_BONUS_WINDOW_MS
    ) {
      score = Math.min(100, score + RECENT_BONUS);
    }
    out.push({
      kind,
      score,
      label: relationshipLabel(score),
      target: other,
    });
  }
  // Sort descending by score; ties broken by lastActiveAt so livelier
  // relationships rank above stale ones.
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.target.lastActiveAt - a.target.lastActiveAt;
  });
  return out;
}

function classify(
  self: SimCardModel,
  other: SimCardModel,
): RelationshipKind | null {
  // Priority 1-2: direct parent/child.
  if (self.parentSessionId && self.parentSessionId === other.sessionId) {
    return "family-parent";
  }
  if (other.parentSessionId && other.parentSessionId === self.sessionId) {
    return "family-child";
  }
  // Priority 3: siblings — both have the same parent.
  if (
    self.parentSessionId &&
    other.parentSessionId &&
    self.parentSessionId === other.parentSessionId
  ) {
    return "sibling";
  }
  // Priority 4-5: housemate vs. rival — same repo, same vs. different agent.
  if (self.repo && other.repo && self.repo === other.repo) {
    return self.sessionType === other.sessionType ? "housemate" : "rival";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Score → label
// ---------------------------------------------------------------------------

export function relationshipLabel(score: number): string {
  if (score >= 85) return "Family ❤";
  if (score >= 65) return "Best Friend 🤝";
  if (score >= 45) return "Friend 🙂";
  if (score >= 25) return "Acquaintance";
  return "Stranger";
}

export function relationshipKindLabel(kind: RelationshipKind): string {
  switch (kind) {
    case "family-parent":
      return "Parent ↑";
    case "family-child":
      return "Child ↓";
    case "sibling":
      return "Sibling";
    case "housemate":
      return "Housemate";
    case "rival":
      return "Rival";
  }
}
