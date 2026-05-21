// Hamlet — Room Scene R6 F2: Window-Through Relationships.
//
// Derives what (if anything) lives "outside" the resident's window:
//   - parentHouse: small distant house when this resident has a parent
//     session (parent_session_id resolved against allCards).
//   - playingChildren: 1-2 child residents (this card is parent_session_id)
//     that have been active within the last 30 min — they appear as small
//     bouncing avatars in the front garden.
//   - passingFriend: at least one Best Friend (score >= 65) → a silhouette
//     crosses the window every ~14s.
//
// Pure / synchronous / O(allCards). Returns `undefined` slots when no data
// is available so the renderer can skip them entirely.
//
// Relationship scoring is reused via `computeRelationships()` so the
// Window scene stays in lock-step with the Relationships side panel.

import type { SimCardModel } from "./fleet-hamlet";
import { computeRelationships } from "./fleet-hamlet-relations";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WindowScenePerson {
  /** Repo / agent hue (0..360) used to colour the silhouette. */
  hue: number;
  /** sessionType, for shirt-colour selection consistency with the avatar. */
  sessionType: SimCardModel["sessionType"];
}

export interface WindowSceneParentHouse {
  /** Parent repo / agent hue — used for the roof. */
  hue: number;
}

export interface WindowScene {
  parentHouse?: WindowSceneParentHouse;
  /** Up to 2 children that are recently active (garden). */
  playingChildren: readonly WindowScenePerson[];
  /** A best friend that passes by every cycle, if any. */
  passingFriend?: WindowScenePerson;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const RECENT_CHILD_WINDOW_MS = 30 * 60 * 1000; // 30 min
const BEST_FRIEND_MIN_SCORE = 65;
const MAX_CHILDREN = 2;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function deriveWindowScene(
  card: SimCardModel,
  allCards: readonly SimCardModel[],
  now: number,
): WindowScene {
  // Parent — match against parentSessionId.
  let parentHouse: WindowSceneParentHouse | undefined;
  if (card.parentSessionId) {
    const parent = allCards.find((c) => c.sessionId === card.parentSessionId);
    if (parent) parentHouse = { hue: parent.hue };
  }

  // Children (recently active) — anyone whose parentSessionId === this card.
  const playingChildren: WindowScenePerson[] = [];
  for (const other of allCards) {
    if (other.key === card.key) continue;
    if (other.parentSessionId !== card.sessionId) continue;
    if (now - other.lastActiveAt > RECENT_CHILD_WINDOW_MS) continue;
    playingChildren.push({ hue: other.hue, sessionType: other.sessionType });
    if (playingChildren.length >= MAX_CHILDREN) break;
  }

  // Best friend — any relationship with score >= 65. computeRelationships
  // already sorts descending by score so we can grab the first.
  let passingFriend: WindowScenePerson | undefined;
  const rels = computeRelationships(card, allCards, now);
  for (const r of rels) {
    if (r.score >= BEST_FRIEND_MIN_SCORE) {
      passingFriend = {
        hue: r.target.hue,
        sessionType: r.target.sessionType,
      };
      break;
    }
  }

  return { parentHouse, playingChildren, passingFriend };
}
