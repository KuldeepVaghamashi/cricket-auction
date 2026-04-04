/**
 * Process-local bridge: API routes call into this module; the custom HTTP server
 * registers the real WebSocket broadcaster when it starts. On serverless hosts
 * without a custom server, emits are no-ops.
 */

export type AuctionInvScope = "st" | "tm" | "pl" | "lg" | "vw" | "a";

export type AuctionWsPush = { v: 1; t: "inv"; s: AuctionInvScope[] };

type Emitter = (auctionId: string, msg: AuctionWsPush) => void;

let emit: Emitter = () => {};

export function registerAuctionWsEmit(fn: Emitter) {
  emit = fn;
}

export function pushAuctionInvalidation(auctionId: string, scopes: AuctionInvScope[]) {
  const s = scopes.includes("a") ? (["a"] as AuctionInvScope[]) : scopes;
  emit(auctionId, { v: 1, t: "inv", s });
}
