import { pushAuctionInvalidation, type AuctionInvScope, type AuctionDelta } from "@/lib/socket-hub";
import { emitAuctionInvalidate } from "@/lib/socket-io-server";

/** Fire-and-forget hint to WebSocket subscribers (no-op without custom server). */
export function notifyAuctionSubscribers(
  auctionId: string,
  scopes: AuctionInvScope[] = ["a"],
  delta?: AuctionDelta
) {
  // Native WS → viewer clients (use-viewer-live-feed)
  pushAuctionInvalidation(auctionId, scopes, delta);
  // Socket.IO → admin clients (use-auction-live-sync)
  emitAuctionInvalidate(auctionId, scopes);
}
