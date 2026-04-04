import { pushAuctionInvalidation, type AuctionInvScope } from "@/lib/socket-hub";

/** Fire-and-forget hint to WebSocket subscribers (no-op without custom server). */
export function notifyAuctionSubscribers(auctionId: string, scopes: AuctionInvScope[] = ["a"]) {
  pushAuctionInvalidation(auctionId, scopes);
}
