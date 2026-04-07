/**
 * Process bridge between API route handlers and the WebSocket broadcaster.
 *
 * Key change: AuctionWsPush now carries an optional `d` (delta) field.
 * For high-frequency bid events the server embeds the changed values directly
 * in the WS message so the viewer can apply them instantly — zero extra HTTP
 * round-trip. For low-frequency events (sold, unsold, pick) the field is
 * omitted and the client falls back to a snapshot fetch as before.
 */

import { getRedis, REDIS_AVAILABLE } from "@/lib/redis";

export type AuctionInvScope = "st" | "tm" | "pl" | "lg" | "vw" | "a";

/**
 * Inline delta included in WS push messages so viewers update state
 * without an extra HTTP fetch.
 *
 * Bid event  → currentBid / currentTeamId / currentTeamName / bidEntry
 * Pick event → currentPlayer / currentBid / newRound: true (bid history reset)
 */
export type AuctionDelta = {
  currentBid?: number;
  currentTeamId?: string | null;
  currentTeamName?: string | null;
  bidEntry?: { teamName: string; amount: number; timestamp: string };
  currentPlayer?: { _id: string; name: string; basePrice: number } | null;
  /** true when a new player is picked — tells the client to wipe bid history */
  newRound?: boolean;
};

export type AuctionWsPush = {
  v: 1;
  t: "inv";
  s: AuctionInvScope[];
  /** Optional inline delta — client applies directly, skips snapshot fetch */
  d?: AuctionDelta;
};

/** Redis channel — all instances subscribe here */
export const REDIS_AUCTION_CHANNEL = "auction:invalidations";

type LocalEmitter = (auctionId: string, msg: AuctionWsPush) => void;
let localEmit: LocalEmitter = () => {};

export function registerAuctionWsEmit(fn: LocalEmitter): void {
  localEmit = fn;
}

export function pushAuctionInvalidation(
  auctionId: string,
  scopes: AuctionInvScope[],
  delta?: AuctionDelta
): void {
  const s: AuctionInvScope[] = scopes.includes("a") ? ["a"] : scopes;
  const msg: AuctionWsPush = { v: 1, t: "inv", s, ...(delta ? { d: delta } : {}) };

  if (!REDIS_AVAILABLE) {
    localEmit(auctionId, msg);
    return;
  }

  const payload = JSON.stringify({ auctionId, msg });
  getRedis()
    .publish(REDIS_AUCTION_CHANNEL, payload)
    .catch((err: Error) => {
      console.error("[socket-hub] Redis publish error, using local fallback:", err.message);
      localEmit(auctionId, msg);
    });
}
