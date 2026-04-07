/**
 * Process bridge between API route handlers and the WebSocket broadcaster.
 *
 * Single-instance (no Redis):
 *   API route → pushAuctionInvalidation() → localEmit() → broadcast to local WS clients
 *
 * Multi-instance (Redis available):
 *   API route → pushAuctionInvalidation() → Redis PUBLISH
 *   socket-server (all instances) → Redis SUBSCRIBE → broadcast to local WS clients
 *
 * The local emitter is kept as a fallback: when Redis is configured but
 * temporarily unreachable, invalidations still reach clients on the same
 * instance so the live view never fully stalls.
 */

import { getRedis, REDIS_AVAILABLE } from "@/lib/redis";

export type AuctionInvScope = "st" | "tm" | "pl" | "lg" | "vw" | "a";
export type AuctionWsPush = { v: 1; t: "inv"; s: AuctionInvScope[] };

/** Redis channel name — all instances subscribe to this single channel. */
export const REDIS_AUCTION_CHANNEL = "auction:invalidations";

// ---------------------------------------------------------------------------
// Process-local emitter (registered by socket-server.ts on startup)
// Used as primary path when Redis is unavailable, and as fallback otherwise.
// ---------------------------------------------------------------------------

type LocalEmitter = (auctionId: string, msg: AuctionWsPush) => void;
let localEmit: LocalEmitter = () => {};

export function registerAuctionWsEmit(fn: LocalEmitter): void {
  localEmit = fn;
}

// ---------------------------------------------------------------------------
// Public API — called by every API route that mutates auction state
// ---------------------------------------------------------------------------

export function pushAuctionInvalidation(auctionId: string, scopes: AuctionInvScope[]): void {
  const s: AuctionInvScope[] = scopes.includes("a") ? ["a"] : scopes;
  const msg: AuctionWsPush = { v: 1, t: "inv", s };

  if (!REDIS_AVAILABLE) {
    // Single-instance path (existing behaviour, zero overhead).
    localEmit(auctionId, msg);
    return;
  }

  // Multi-instance path: publish to Redis.
  // socket-server.ts subscribes on every instance and fans out to local clients.
  const payload = JSON.stringify({ auctionId, msg });
  getRedis()
    .publish(REDIS_AUCTION_CHANNEL, payload)
    .catch((err: Error) => {
      // Redis publish failed — fall back to local emit so this instance's
      // clients still receive the update.
      console.error("[socket-hub] Redis publish error, using local fallback:", err.message);
      localEmit(auctionId, msg);
    });
}
