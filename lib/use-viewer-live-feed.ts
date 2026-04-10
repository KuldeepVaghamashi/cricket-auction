"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { KeyedMutator } from "swr";
import { createAuctionLiveSocket, type AuctionInvScope, type AuctionDelta } from "@/lib/socket-client";
import type { ViewerStreamPayload } from "@/lib/viewer-stream-types";
import type { AuctionWithId } from "@/lib/types";

function devWarn(message: string, err: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.warn(message, err);
  }
}

function getSnapshotMode(scopes: AuctionInvScope[]): "full" | "state" | "stats" | null {
  if (scopes.includes("a") || scopes.includes("vw")) return "full";
  if (scopes.includes("tm")) return "full";
  if (scopes.includes("pl")) return "stats";
  if (scopes.includes("st") || scopes.includes("lg")) return "state";
  return null;
}

/**
 * Apply an inline delta from a WS push message directly onto the current
 * stream payload — no HTTP round-trip, no MongoDB read, instant render.
 *
 * Returns the merged payload, or null if no baseline exists yet
 * (caller should fall back to a full snapshot fetch in that case).
 */
function applyDelta(
  prev: ViewerStreamPayload | null,
  delta: AuctionDelta
): ViewerStreamPayload | null {
  if (!prev) return null;

  if (delta.newRound) {
    // New player picked — reset bid state and update currentPlayer.
    return {
      ...prev,
      currentPlayer: delta.currentPlayer ?? null,
      state: prev.state
        ? {
            ...prev.state,
            currentBid: delta.currentBid ?? 0,
            currentTeamId: null,
            currentTeamName: null,
            bidHistory: [],
          }
        : prev.state,
    };
  }

  // Bid event — patch only the fields that changed.
  return {
    ...prev,
    state: prev.state
      ? {
          ...prev.state,
          ...(delta.currentBid !== undefined && { currentBid: delta.currentBid }),
          ...(delta.currentTeamId !== undefined && { currentTeamId: delta.currentTeamId }),
          ...(delta.currentTeamName !== undefined && { currentTeamName: delta.currentTeamName }),
          ...(delta.bidEntry && {
            bidHistory: [
              ...(prev.state.bidHistory ?? []).slice(-9),
              delta.bidEntry,
            ],
          }),
        }
      : prev.state,
  };
}

/**
 * Live viewer transport: WebSocket invalidation + inline delta when available;
 * falls back to snapshot fetch for events that change teams/players/stats;
 * falls back to SSE when WebSocket is not available (e.g. Vercel).
 */
export function useViewerLiveFeed(
  id: string | undefined,
  isActive: boolean,
  mutateAuction: KeyedMutator<AuctionWithId>,
  setStreamData: Dispatch<SetStateAction<ViewerStreamPayload | null>>
) {
  const esRef = useRef<EventSource | null>(null);
  const sseModeRef = useRef(false);
  const mutateAuctionRef = useRef(mutateAuction);
  mutateAuctionRef.current = mutateAuction;
  const lastFullRef = useRef<ViewerStreamPayload | null>(null);
  // Prevents concurrent snapshot fetches when multiple WS invalidations
  // arrive in rapid succession — only the first in-flight fetch runs;
  // the rest are dropped and a fresh fetch fires once it completes.
  const fetchInFlightRef = useRef(false);

  useEffect(() => {
    if (!isActive || !id) {
      sseModeRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      lastFullRef.current = null;
      setStreamData(null);
      return;
    }

    let cancelled = false;

    const applyPayload = (parsed: ViewerStreamPayload) => {
      if (cancelled) return;
      lastFullRef.current = parsed;
      setStreamData(parsed);
      if (parsed.auction?.status && parsed.auction.status !== "active") {
        void mutateAuctionRef.current();
      }
    };

    const openEventSource = () => {
      if (sseModeRef.current) return;
      sseModeRef.current = true;
      esRef.current?.close();
      const es = new EventSource(`/api/auctions/${id}/stream`);
      esRef.current = es;
      es.onmessage = (event) => {
        try {
          applyPayload(JSON.parse(event.data) as ViewerStreamPayload);
        } catch (e) {
          devWarn("SSE parse error:", e);
        }
      };
    };

    const fetchSnapshot = async (mode: "full" | "state" | "stats") => {
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      try {
        const r = await fetch(
          `/api/auctions/${id}/viewer-snapshot?mode=${encodeURIComponent(mode)}`,
          { cache: "no-store" }
        );
        const j = (await r.json()) as Partial<ViewerStreamPayload> & { timestamp?: string };

        if (cancelled) return;

        const base = lastFullRef.current;
        if (!base || mode === "full" || !base.teams || !base.playerStats) {
          const full = j as ViewerStreamPayload;
          lastFullRef.current = full;
          setStreamData(full);
          return;
        }

        const merged: ViewerStreamPayload = {
          ...base,
          ...j,
          timestamp: j.timestamp ?? base.timestamp,
        };
        lastFullRef.current = merged;
        setStreamData(merged);
      } catch (e) {
        devWarn("Viewer snapshot error:", e);
      } finally {
        fetchInFlightRef.current = false;
      }
    };

    const socket = createAuctionLiveSocket({
      auctionId: id,
      onInvalidate: (scopes, delta) => {
        if (cancelled) return;

        // ── Fast path: inline delta present ──────────────────────────────────
        // Server embedded the changed values in the WS message itself.
        // Apply directly to current state — zero extra network hop.
        if (delta) {
          const next = applyDelta(lastFullRef.current, delta);
          if (next) {
            lastFullRef.current = next;
            setStreamData(next);

            // If the same event also changes teams/players (e.g. sold), still
            // fetch the full snapshot so purses and stats stay accurate.
            if (scopes.some((s) => s === "tm" || s === "pl" || s === "vw" || s === "a")) {
              void fetchSnapshot("full");
            }
            return;
          }
          // No baseline yet — fall through to snapshot fetch.
        }

        // ── Slow path: no delta or no baseline ───────────────────────────────
        // This covers sold/unsold/reset/undo events where the full state must
        // be re-fetched because teams or player stats may have changed.
        const mode = getSnapshotMode(scopes);
        if (mode) void fetchSnapshot(mode);
      },

      onConnectionChange: (connected) => {
        if (cancelled) return;
        if (connected) {
          sseModeRef.current = false;
          esRef.current?.close();
          esRef.current = null;
          // First payload must be full so we have teams + playerStats as baseline.
          void fetchSnapshot("full");
        }
      },

      onPrimaryTransportUnavailable: () => {
        if (cancelled) return;
        openEventSource();
      },
    });

    return () => {
      cancelled = true;
      socket.close();
      esRef.current?.close();
      esRef.current = null;
      sseModeRef.current = false;
    };
  }, [id, isActive, setStreamData]);
}
