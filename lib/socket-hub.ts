/**
 * Event hub — API routes publish auction events here; the hub fans them out
 * to connected clients via Redis pub/sub (multi-instance) or direct in-process
 * broadcast (single-instance / Redis unavailable).
 *
 * Protocol v2: typed AuctionEvent union replaces the v1 scope-invalidation
 * approach.  Every event carries a `seq` (monotonic counter per auction stored
 * in Redis) so clients can detect gaps and request a resync.
 *
 * Event types
 * ──────────
 *  bid     High-frequency. Full inline delta: clients update without a fetch.
 *  sell    Carries team-budget delta + player stats. Was N×snapshot per sell.
 *  unsold  Carries player stats delta.
 *  pick    New player selected. Carries player data; resets bid state.
 *  refresh Low-frequency (undo, reset, status change). Clients re-fetch scopes.
 *  snapshot Initial full payload sent once on SSE/WS connect.
 */

import { getRedis, REDIS_AVAILABLE } from "@/lib/redis";
import { broadcastToRoom } from "@/lib/auction-rooms";
import type { ViewerStreamPayload } from "@/lib/viewer-stream-types";

// Channel must match the one auction-rooms.ts subscribes to.
export const redisAuctionChannel = (id: string) => `auction:${id}:events`;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type BidEvent = {
  v: 2;
  type: "bid";
  seq: number;
  /** Echoed back to the originating admin tab for deduplication. */
  requestId?: string;
  currentBid: number;
  currentTeamId: string | null;
  currentTeamName: string | null;
  bidEntry: { teamName: string; amount: number; timestamp: string };
};

export type SellEvent = {
  v: 2;
  type: "sell";
  seq: number;
  playerId: string;
  teamId: string;
  soldPrice: number;
  /** Team's remainingBudget after the deduction — avoids a teams re-fetch. */
  newTeamRemainingBudget: number;
  playerStats: { available: number; sold: number; unsold: number };
};

export type UnsoldEvent = {
  v: 2;
  type: "unsold";
  seq: number;
  playerId: string;
  playerStats: { available: number; sold: number; unsold: number };
};

export type PickEvent = {
  v: 2;
  type: "pick";
  seq: number;
  player: { _id: string; name: string; basePrice: number };
};

/**
 * Low-frequency admin actions (undo-bid, reset, status change).
 * Clients re-fetch only the listed scopes instead of the full snapshot.
 */
export type RefreshEvent = {
  v: 2;
  type: "refresh";
  seq: number;
  scopes: Array<"st" | "tm" | "pl" | "lg">;
};

/**
 * Sent once on SSE/WS connect — carries the full viewer snapshot plus seq so
 * the client can anchor gap detection from there.
 */
export type SnapshotEvent = ViewerStreamPayload & { v: 2; type: "snapshot"; seq: number };

export type AuctionEvent =
  | BidEvent
  | SellEvent
  | UnsoldEvent
  | PickEvent
  | RefreshEvent
  | SnapshotEvent;

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export function pushAuctionEvent(auctionId: string, event: AuctionEvent): void {
  const raw = JSON.stringify(event);

  if (!REDIS_AVAILABLE) {
    broadcastToRoom(auctionId, raw);
    return;
  }

  const payload = JSON.stringify({ auctionId, event });
  getRedis()
    .publish(redisAuctionChannel(auctionId), payload)
    .catch((err: Error) => {
      console.error("[socket-hub] Redis publish error, using local fallback:", err.message);
      broadcastToRoom(auctionId, raw);
    });
}
