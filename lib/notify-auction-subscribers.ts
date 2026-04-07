import { pushAuctionInvalidation, type AuctionInvScope, type AuctionDelta } from "@/lib/socket-hub";

/** Fire-and-forget hint to WebSocket subscribers (no-op without custom server). */
export function notifyAuctionSubscribers(
  auctionId: string,
  scopes: AuctionInvScope[] = ["a"],
  delta?: AuctionDelta
) {
  pushAuctionInvalidation(auctionId, scopes, delta);
}
