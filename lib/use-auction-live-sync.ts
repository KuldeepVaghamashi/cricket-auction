"use client";

import { useEffect, useRef } from "react";
import {
  createAuctionLiveSocket,
  type AuctionEvent,
  type BidEvent,
} from "@/lib/socket-client";

// Re-export BidEvent so live/page.tsx can type patchState without a second import.
export type { BidEvent };

// ---------------------------------------------------------------------------
// Mutators ref
// ---------------------------------------------------------------------------

export type AuctionLiveMutators = {
  mutateState?: () => void;
  mutateTeams?: () => void;
  mutatePlayers?: () => void;
  mutateLogs?: () => void;
  /**
   * Apply a bid event directly to the SWR cache — zero HTTP round-trips on the
   * high-frequency bid path.  The live page implements this; it handles echo
   * suppression (skips the call when requestId matches a pending local bid).
   */
  patchState?: (event: BidEvent) => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribes to auction-room WebSocket events (v2 protocol) and routes them
 * to the appropriate SWR mutators.
 *
 * Event routing:
 *   bid     → patchState (inline delta, zero refetch; echo-suppressed in live page)
 *   sell    → mutateState + mutateTeams + mutatePlayers + mutateLogs
 *   unsold  → mutateState + mutatePlayers + mutateLogs
 *   pick    → mutateState + mutateLogs
 *   refresh → per listed scopes
 *   snapshot→ ignored (admin page manages its own initial load via SWR)
 */
export function useAuctionSocket(
  auctionId: string | undefined,
  mutatorsRef: { current: AuctionLiveMutators },
  onConnectionChange?: (connected: boolean) => void
) {
  const onConn = useRef(onConnectionChange);
  onConn.current = onConnectionChange;

  useEffect(() => {
    if (!auctionId) return;

    const socket = createAuctionLiveSocket({
      auctionId,

      onEvent(event: AuctionEvent) {
        const m = mutatorsRef.current;

        switch (event.type) {
          case "bid":
            // patchState applies the delta directly to the SWR cache.
            // If patchState is absent (shouldn't happen in practice), fall
            // back to a full state revalidation.
            if (m.patchState) {
              m.patchState(event as BidEvent);
            } else {
              m.mutateState?.();
            }
            break;

          case "sell":
            // Player sold: state, team budgets, player statuses, and logs all change.
            m.mutateState?.();
            m.mutateTeams?.();
            m.mutatePlayers?.();
            m.mutateLogs?.();
            break;

          case "unsold":
            // Player unsold: state and player statuses change; teams are untouched.
            m.mutateState?.();
            m.mutatePlayers?.();
            m.mutateLogs?.();
            break;

          case "pick":
            // New player selected: state (currentPlayer + reset bid) and logs change.
            m.mutateState?.();
            m.mutateLogs?.();
            break;

          case "refresh":
            // Low-frequency admin action (undo-bid, reset). Re-fetch listed scopes.
            for (const scope of event.scopes) {
              if (scope === "st") m.mutateState?.();
              if (scope === "tm") m.mutateTeams?.();
              if (scope === "pl") m.mutatePlayers?.();
              if (scope === "lg") m.mutateLogs?.();
            }
            break;

          case "snapshot":
            // The admin page initialises via SWR; ignore snapshot events.
            break;
        }
      },

      onConnectionChange: (ok) => onConn.current?.(ok),
    });

    return () => socket.close();
  }, [auctionId, mutatorsRef]);
}
