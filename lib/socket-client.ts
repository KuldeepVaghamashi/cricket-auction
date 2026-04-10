"use client";

import type {
  AuctionEvent,
  BidEvent,
  SellEvent,
  UnsoldEvent,
  PickEvent,
  RefreshEvent,
  SnapshotEvent,
} from "@/lib/socket-hub";

// Re-export types consumed by hooks and components.
export type {
  AuctionEvent,
  BidEvent,
  SellEvent,
  UnsoldEvent,
  PickEvent,
  RefreshEvent,
  SnapshotEvent,
};

export function getAuctionWsUrl(auctionId: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/auctions/ws?auctionId=${encodeURIComponent(auctionId)}`;
}

type AuctionLiveSocketOptions = {
  auctionId: string;
  /**
   * Called for every incoming v2 AuctionEvent (bid, sell, unsold, pick, refresh,
   * or snapshot).  The caller is responsible for deciding what to do with each
   * event type.
   */
  onEvent: (event: AuctionEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
  /**
   * Invoked once when the socket never reaches `open` (e.g. plain `next dev`
   * without the custom server).  Internal reconnect is disabled after this so
   * the caller can fall back to SSE.
   */
  onPrimaryTransportUnavailable?: () => void;
};

/**
 * Native WebSocket client with exponential-backoff reconnect.
 * Reconnects only after at least one successful open (avoids infinite retry
 * when the server does not support WebSockets at all).
 */
export function createAuctionLiveSocket(
  options: AuctionLiveSocketOptions
): { close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let everOpened = false;
  let reportedPrimaryFailure = false;

  const maxDelay = 25_000;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const connect = () => {
    if (closed) return;
    clearTimer();
    let socket: WebSocket;
    try {
      socket = new WebSocket(getAuctionWsUrl(options.auctionId));
    } catch {
      if (!reportedPrimaryFailure) {
        reportedPrimaryFailure = true;
        options.onPrimaryTransportUnavailable?.();
      }
      options.onConnectionChange?.(false);
      return;
    }
    ws = socket;

    socket.onopen = () => {
      everOpened = true;
      attempt = 0;
      options.onConnectionChange?.(true);
    };

    socket.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as AuctionEvent & { v?: number };
        // Only handle v2 events; silently ignore anything else.
        if (data?.v === 2) {
          options.onEvent(data);
        }
      } catch {
        /* ignore malformed */
      }
    };

    socket.onerror = () => {
      /* onclose handles cleanup */
    };

    socket.onclose = () => {
      ws = null;
      options.onConnectionChange?.(false);

      if (!everOpened) {
        if (!reportedPrimaryFailure) {
          reportedPrimaryFailure = true;
          options.onPrimaryTransportUnavailable?.();
        }
        return;
      }

      if (!closed) {
        attempt += 1;
        const jitter = Math.random() * 400; // ±200 ms to spread reconnect storms
        const delay = Math.min(maxDelay, 800 * Math.pow(1.6, Math.min(attempt, 10))) + jitter;
        timer = setTimeout(connect, delay);
      }
    };
  };

  connect();

  return {
    close() {
      closed = true;
      clearTimer();
      ws?.close();
      ws = null;
    },
  };
}
