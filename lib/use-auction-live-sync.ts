"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { createAuctionLiveSocket, type AuctionInvScope } from "@/lib/socket-client";

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
 * Subscribes to auction-room WebSocket invalidations and triggers SWR revalidations.
 * Pass a ref that you fill with mutate callbacks after `useSWR` (same render is fine).
 */
export function useAuctionSocket(
  auctionId: string | undefined,
  mutatorsRef: MutableRefObject<AuctionLiveMutators>,
  onConnectionChange?: (connected: boolean) => void
) {
  const onConn = useRef(onConnectionChange);
  onConn.current = onConnectionChange;

  useEffect(() => {
    if (!auctionId) return;

    const socket = createAuctionLiveSocket({
      auctionId,
      // Delta is accepted but intentionally ignored here — the admin live page
      // uses SWR mutate for all state updates (with its own optimistic layer),
      // so inline deltas would conflict with that flow.
      onInvalidate(scopes, _delta) {
        const need = scopesToMutations(scopes);
        const m = mutatorsRef.current;
        if (need.has("st")) m.mutateState?.();
        if (need.has("tm")) m.mutateTeams?.();
        if (need.has("pl")) m.mutatePlayers?.();
        if (need.has("lg")) m.mutateLogs?.();
      },
      onConnectionChange: (ok) => onConn.current?.(ok),
    });

    return () => socket.close();
  }, [auctionId, mutatorsRef]);
}
