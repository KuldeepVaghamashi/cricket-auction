"use client";

import type { AuctionInvScope } from "@/lib/socket-hub";

export type { AuctionInvScope };

export function getAuctionWsUrl(auctionId: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/auctions/ws?auctionId=${encodeURIComponent(auctionId)}`;
}

type AuctionLiveSocketOptions = {
  auctionId: string;
  onInvalidate: (scopes: AuctionInvScope[]) => void;
  onConnectionChange?: (connected: boolean) => void;
  /**
   * Invoked once when the socket never reaches `open` (e.g. plain `next dev` without custom server).
   * After this, internal reconnect is disabled so the caller can fall back to SSE/polling.
   */
  onPrimaryTransportUnavailable?: () => void;
};

/**
 * Native WebSocket client with reconnect after successful sessions only.
 */
export function createAuctionLiveSocket(options: AuctionLiveSocketOptions): { close: () => void } {
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
        const data = JSON.parse(String(ev.data)) as { v?: number; t?: string; s?: AuctionInvScope[] };
        if (data?.v === 1 && data.t === "inv" && Array.isArray(data.s)) {
          options.onInvalidate(data.s);
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
        const delay = Math.min(maxDelay, 800 * Math.pow(1.6, Math.min(attempt, 10)));
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
