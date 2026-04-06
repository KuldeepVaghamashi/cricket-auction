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

function needsViewerRefresh(scopes: AuctionInvScope[]) {
  return scopes.includes("a") || scopes.includes("vw");
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

  useEffect(() => {
    if (!isActive || !id) {
      sseModeRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      setStreamData(null);
      return;
    }

    let cancelled = false;

    const applyPayload = (parsed: ViewerStreamPayload) => {
      if (cancelled) return;
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

    const fetchSnapshot = async () => {
      try {
        const r = await fetch(`/api/auctions/${id}/viewer-snapshot`, { cache: "no-store" });
        const j = (await r.json()) as ViewerStreamPayload;
        applyPayload(j);
      } catch (e) {
        devWarn("Viewer snapshot error:", e);
      }
    };

    const socket = createAuctionLiveSocket({
      auctionId: id,
      onInvalidate: (scopes) => {
        if (needsViewerRefresh(scopes)) void fetchSnapshot();
      },
      onConnectionChange: (connected) => {
        if (cancelled) return;
        if (connected) {
          sseModeRef.current = false;
          esRef.current?.close();
          esRef.current = null;
          void fetchSnapshot();
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
