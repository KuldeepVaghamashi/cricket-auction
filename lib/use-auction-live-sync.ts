"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { io as ioClient, type Socket } from "socket.io-client";
import type { AuctionInvScope } from "@/lib/socket-hub";

function scopesToMutations(scopes: AuctionInvScope[]): Set<AuctionInvScope> {
  if (scopes.includes("a")) {
    return new Set(["st", "tm", "pl", "lg"]);
  }
  return new Set(scopes);
}

export type AuctionLiveMutators = {
  mutateState?: () => void;
  mutateTeams?: () => void;
  mutatePlayers?: () => void;
  mutateLogs?: () => void;
};

/**
 * Subscribes to auction-room Socket.IO events and triggers SWR revalidations.
 *
 * Two event types are handled:
 *   "bid:update"         — new bid received; only mutates state (currentBid /
 *                          currentPlayer / timer) to avoid a full-page re-render.
 *   "auction:invalidate" — non-bid change (sold, unsold, pick, reset …);
 *                          dispatches to all relevant mutators by scope.
 *
 * Falls back gracefully to SWR polling when Socket.IO cannot connect
 * (e.g. Vercel / plain `next dev`).  Pass a ref that you fill with mutate
 * callbacks after `useSWR` (same render is fine).
 *
 * @param suppressBidUpdateRef  When truthy the next "bid:update" socket event
 *   skips the state GET and clears the flag. Set it to true right after the
 *   placing-admin has applied the bid response directly to SWR state so that
 *   the echo of their own bid doesn't trigger a redundant network round-trip.
 *   Other admins' bid events (flag is false) still revalidate normally.
 */
export function useAuctionSocket(
  auctionId: string | undefined,
  mutatorsRef: MutableRefObject<AuctionLiveMutators>,
  onConnectionChange?: (connected: boolean) => void,
  suppressBidUpdateRef?: MutableRefObject<boolean>
) {
  const onConn = useRef(onConnectionChange);
  onConn.current = onConnectionChange;

  useEffect(() => {
    if (!auctionId) return;

    const socket: Socket = ioClient({
      path: "/api/auctions/io",
      query: { auctionId },
      // Skip HTTP long-polling — go straight to WebSocket.
      // If WebSocket is unavailable the "connect_error" / "disconnect" events
      // fire and the caller falls back to SWR polling (refreshInterval).
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 25_000,
      // Prevent Socket.IO manager from re-using a cached socket for the same
      // namespace across React strict-mode double-mounts or hot-reloads.
      // Without this, each effect run attaches new listeners to the same
      // underlying socket, causing duplicate handler invocations.
      forceNew: true,
    });

    socket.on("connect", () => onConn.current?.(true));
    socket.on("disconnect", () => onConn.current?.(false));
    socket.on("connect_error", () => onConn.current?.(false));

    // Targeted update: only currentBid / currentPlayer / timer changed.
    // Also refresh logs — the bid was written to auctionLogs but the bid route
    // no longer fires "auction:invalidate" on Socket.IO to prevent double-firing.
    socket.on("bid:update", () => {
      // If the placing-admin already applied the bid response directly to SWR
      // state, skip the revalidation GET for this echo of their own bid.
      // Any subsequent bid:update (from another admin or the next bid) will
      // have the flag cleared and will revalidate normally.
      if (suppressBidUpdateRef?.current) {
        suppressBidUpdateRef.current = false;
      } else {
        mutatorsRef.current.mutateState?.();
      }
      // Always refresh logs — the audit entry was written regardless of who bid.
      mutatorsRef.current.mutateLogs?.();
    });

    // General invalidation for non-bid events.
    // Dispatches to the relevant mutators based on the scope list.
    socket.on("auction:invalidate", (payload: { scopes: AuctionInvScope[] }) => {
      const need = scopesToMutations(payload?.scopes ?? ["a"]);
      const m = mutatorsRef.current;
      if (need.has("st")) m.mutateState?.();
      if (need.has("tm")) m.mutateTeams?.();
      if (need.has("pl")) m.mutatePlayers?.();
      if (need.has("lg")) m.mutateLogs?.();
    });

    return () => {
      // Remove all listeners before disconnecting so that closures over
      // mutatorsRef are released immediately (prevents memory leaks and
      // stale callbacks firing during the next mount's setup window).
      socket.off();
      socket.disconnect();
    };
  }, [auctionId, mutatorsRef, suppressBidUpdateRef]);
}
