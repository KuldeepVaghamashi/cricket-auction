"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { KeyedMutator } from "swr";
import { createAuctionLiveSocket, type AuctionInvScope } from "@/lib/socket-client";
import type { ViewerStreamPayload } from "@/lib/viewer-stream-types";
import type { AuctionWithId } from "@/lib/types";

function devWarn(message: string, err: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.warn(message, err);
  }
}

function getSnapshotMode(scopes: AuctionInvScope[]): "full" | "state" | "stats" | null {
  // Backward compatibility: treat legacy "all" as full refresh.
  if (scopes.includes("a") || scopes.includes("vw")) return "full";

  // Teams/purses only change on sold completion.
  if (scopes.includes("tm")) return "full";

  // Player status counts only change when players are completed (sold/unsold).
  // For unsold we don't change teams, so we can refresh stats only.
  if (scopes.includes("pl")) return "stats";

  // Bid/reset/pick/undo affect auction state + recent bid history.
  if (scopes.includes("st") || scopes.includes("lg")) return "state";

  return null;
}

/**
 * Live viewer transport: WebSocket invalidation + snapshot fetch when available;
 * falls back to the existing SSE stream if the socket never connects (e.g. serverless).
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
      try {
        const r = await fetch(`/api/auctions/${id}/viewer-snapshot?mode=${encodeURIComponent(mode)}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as Partial<ViewerStreamPayload> & { timestamp?: string };

        if (cancelled) return;

        // Merge partial snapshot with the last full snapshot so UI fields like `teams`
        // and `playerStats` remain stable during state-only updates.
        const base = lastFullRef.current;
        if (!base || mode === "full" || !base.teams || !base.playerStats) {
          const full = j as ViewerStreamPayload;
          lastFullRef.current = full;
          setStreamData(full);
          return;
        }

        const merged = {
          ...base,
          ...j,
          timestamp: j.timestamp ?? base.timestamp,
        } as ViewerStreamPayload;

        lastFullRef.current = merged;
        setStreamData(merged);
      } catch (e) {
        devWarn("Viewer snapshot error:", e);
      }
    };

    const socket = createAuctionLiveSocket({
      auctionId: id,
      onInvalidate: (scopes) => {
        const mode = getSnapshotMode(scopes);
        if (mode) void fetchSnapshot(mode);
      },
      onConnectionChange: (connected) => {
        if (cancelled) return;
        if (connected) {
          sseModeRef.current = false;
          esRef.current?.close();
          esRef.current = null;
          // First payload should be full so we have teams + playerStats baseline.
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
