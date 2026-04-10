"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { KeyedMutator } from "swr";
import {
  createAuctionLiveSocket,
  type AuctionEvent,
  type SnapshotEvent,
  type BidEvent,
  type SellEvent,
  type UnsoldEvent,
  type PickEvent,
  type RefreshEvent,
} from "@/lib/socket-client";
import type { ViewerStreamPayload } from "@/lib/viewer-stream-types";
import type { AuctionWithId } from "@/lib/types";

function devWarn(msg: string, err?: unknown) {
  if (process.env.NODE_ENV === "development") console.warn(msg, err);
}

// ---------------------------------------------------------------------------
// Event application — each handler patches only the affected slice of state.
// ---------------------------------------------------------------------------

function applyBidEvent(
  prev: ViewerStreamPayload,
  e: BidEvent
): ViewerStreamPayload {
  return {
    ...prev,
    state: prev.state
      ? {
          ...prev.state,
          currentBid: e.currentBid,
          currentTeamId: e.currentTeamId,
          currentTeamName: e.currentTeamName,
          bidHistory: [
            ...(prev.state.bidHistory ?? []).slice(-9),
            e.bidEntry,
          ],
        }
      : prev.state,
  };
}

function applySellEvent(
  prev: ViewerStreamPayload,
  e: SellEvent
): ViewerStreamPayload {
  return {
    ...prev,
    state: prev.state
      ? {
          ...prev.state,
          currentBid: 0,
          currentTeamId: null,
          currentTeamName: null,
          bidHistory: [],
          lastAction: "sold",
          lastActionPrice: e.soldPrice,
        }
      : prev.state,
    currentPlayer: null,
    teams: (prev.teams ?? []).map((t) =>
      t._id === e.teamId
        ? { ...t, remainingBudget: e.newTeamRemainingBudget, playersCount: (t.playersCount ?? 0) + 1 }
        : t
    ),
    playerStats: e.playerStats,
  };
}

function applyUnsoldEvent(
  prev: ViewerStreamPayload,
  e: UnsoldEvent
): ViewerStreamPayload {
  return {
    ...prev,
    state: prev.state
      ? {
          ...prev.state,
          currentBid: 0,
          currentTeamId: null,
          currentTeamName: null,
          bidHistory: [],
          lastAction: "unsold",
          lastActionPrice: null,
        }
      : prev.state,
    currentPlayer: null,
    playerStats: e.playerStats,
  };
}

function applyPickEvent(
  prev: ViewerStreamPayload,
  e: PickEvent
): ViewerStreamPayload {
  return {
    ...prev,
    currentPlayer: e.player,
    state: prev.state
      ? {
          ...prev.state,
          currentBid: e.player.basePrice,
          currentTeamId: null,
          currentTeamName: null,
          bidHistory: [],
        }
      : prev.state,
  };
}

// ---------------------------------------------------------------------------
// Snapshot fetch — used on initial connect, reconnect, and gap detection.
// ---------------------------------------------------------------------------

async function fetchSnapshot(
  id: string,
  mode: "full" | "state" | "stats"
): Promise<ViewerStreamPayload | null> {
  try {
    const r = await fetch(
      `/api/auctions/${id}/viewer-snapshot?mode=${encodeURIComponent(mode)}`,
      { cache: "no-store" }
    );
    return (await r.json()) as ViewerStreamPayload;
  } catch (e) {
    devWarn("viewer snapshot fetch error:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Live viewer transport: WebSocket v2 events (bid, sell, unsold, pick, refresh,
 * snapshot) with sequence-number gap detection; falls back to SSE when
 * WebSocket is not available (e.g. Vercel without custom server).
 *
 * SSE is now push-driven — stream/route.ts registers in auction-rooms.ts so
 * events arrive the same way as WS, not via polling.  The SSE onmessage
 * handler therefore uses the same applyEvent logic as the WS path.
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

  /** Latest full payload — used as baseline for incremental events. */
  const lastRef = useRef<ViewerStreamPayload | null>(null);
  /** Last received sequence number — used to detect missed events. */
  const lastSeqRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive || !id) {
      sseModeRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      lastRef.current = null;
      lastSeqRef.current = 0;
      setStreamData(null);
      return;
    }

    let cancelled = false;

    // ── Helpers ───────────────────────────────────────────────────────────────

    const applyFull = (payload: ViewerStreamPayload, seq: number) => {
      if (cancelled) return;
      lastRef.current = payload;
      lastSeqRef.current = seq;
      setStreamData(payload);
      if (payload.auction?.status && payload.auction.status !== "active") {
        void mutateAuctionRef.current();
      }
    };

    const patch = (updater: (prev: ViewerStreamPayload) => ViewerStreamPayload, seq: number) => {
      if (cancelled) return;
      const prev = lastRef.current;
      if (!prev) return; // no baseline yet; gap detection will trigger a resync
      const next = updater(prev);
      lastRef.current = next;
      lastSeqRef.current = seq;
      setStreamData(next);
    };

    /** Check seq continuity; request resync if a gap is detected. */
    const handleSeq = (seq: number): boolean => {
      if (seq === 0) return true; // Redis unavailable, seq disabled
      if (lastSeqRef.current === 0) return true; // first event after connect
      if (seq === lastSeqRef.current + 1) return true; // expected
      // Gap detected — fetch a fresh snapshot and anchor to its seq.
      devWarn(`[viewer] seq gap: expected ${lastSeqRef.current + 1}, got ${seq} — resyncing`);
      void fetchSnapshot(id, "full").then((snap) => {
        if (snap) applyFull(snap, seq);
      });
      return false; // caller should not apply the event
    };

    // ── Unified event handler (WS + SSE) ─────────────────────────────────────

    const handleEvent = (event: AuctionEvent) => {
      if (cancelled) return;

      if (event.type === "snapshot") {
        // Initial full payload sent on connect/reconnect.
        applyFull(event as unknown as ViewerStreamPayload, event.seq);
        return;
      }

      if (!handleSeq(event.seq)) return;

      switch (event.type) {
        case "bid":
          patch((prev) => applyBidEvent(prev, event as BidEvent), event.seq);
          break;

        case "sell":
          patch((prev) => applySellEvent(prev, event as SellEvent), event.seq);
          // Auction status may have changed; refresh auction meta.
          void mutateAuctionRef.current();
          break;

        case "unsold":
          patch((prev) => applyUnsoldEvent(prev, event as UnsoldEvent), event.seq);
          break;

        case "pick":
          patch((prev) => applyPickEvent(prev, event as PickEvent), event.seq);
          break;

        case "refresh": {
          // Low-frequency admin action (undo, reset, status change).
          // Fetch only the affected slices.
          const scopes = (event as RefreshEvent).scopes;
          const mode =
            scopes.includes("tm") || scopes.includes("pl") ? "full" : "state";
          void fetchSnapshot(id, mode).then((snap) => {
            if (!snap || cancelled) return;
            const prev = lastRef.current;
            if (!prev || mode === "full") {
              applyFull(snap, event.seq);
            } else {
              patch((p) => ({ ...p, ...snap, timestamp: snap.timestamp ?? p.timestamp }), event.seq);
            }
          });
          break;
        }
      }
    };

    // ── SSE fallback ──────────────────────────────────────────────────────────
    // stream/route.ts is now push-driven — the same AuctionEvent format is used
    // on both transports, so handleEvent works for SSE messages too.

    const openEventSource = () => {
      if (sseModeRef.current) return;
      sseModeRef.current = true;
      esRef.current?.close();
      const es = new EventSource(`/api/auctions/${id}/stream`);
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as AuctionEvent & { v?: number };
          if (data?.v === 2) handleEvent(data);
        } catch (e) {
          devWarn("SSE parse error:", e);
        }
      };
    };

    // ── WebSocket primary transport ───────────────────────────────────────────

    const socket = createAuctionLiveSocket({
      auctionId: id,
      onEvent: handleEvent,
      onConnectionChange: (connected) => {
        if (cancelled) return;
        if (connected) {
          // Switch off SSE if it was active.
          sseModeRef.current = false;
          esRef.current?.close();
          esRef.current = null;
          // Fetch a full snapshot on connect to anchor the seq baseline.
          void fetchSnapshot(id, "full").then((snap) => {
            if (snap) applyFull(snap, lastSeqRef.current);
          });
        }
      },
      onPrimaryTransportUnavailable: () => {
        if (!cancelled) openEventSource();
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
