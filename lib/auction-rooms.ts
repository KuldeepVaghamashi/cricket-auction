/**
 * Unified auction room registry — WebSocket + Server-Sent Events.
 *
 * Both transports register clients here so every incoming Redis pub/sub message
 * fans out to ALL connected viewers on this instance, regardless of transport.
 * This eliminates the setInterval polling loop that stream/route.ts previously
 * used to drive SSE updates.
 *
 * Redis subscription lifecycle:
 *   First client joins an auction → subscribe to auction:<id>:events
 *   Last client leaves            → unsubscribe and remove the room entry
 *
 * Only the single shared subscriber connection (getRedisSubscriber()) is used —
 * never one connection per client.
 */

import { WebSocket } from "ws";
import { getRedisSubscriber, REDIS_AVAILABLE } from "@/lib/redis";

// Must match the channel used in socket-hub.ts to publish.
const ch = (auctionId: string) => `auction:${auctionId}:events`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WsClient = { kind: "ws"; socket: WebSocket };
type SseClient = { kind: "sse"; enqueue: (raw: string) => void };
export type RoomClient = WsClient | SseClient;

// ---------------------------------------------------------------------------
// Room state
// ---------------------------------------------------------------------------

const rooms = new Map<string, Set<RoomClient>>();

// ---------------------------------------------------------------------------
// Redis subscriber — wired once, dispatches to broadcastToRoom.
// ---------------------------------------------------------------------------

if (REDIS_AVAILABLE) {
  getRedisSubscriber().on("message", (_channel: string, raw: string) => {
    try {
      const parsed = JSON.parse(raw) as { auctionId?: string; event?: unknown };
      if (typeof parsed.auctionId === "string" && parsed.event !== undefined) {
        broadcastToRoom(parsed.auctionId, JSON.stringify(parsed.event));
      }
    } catch (e) {
      console.error("[auction-rooms] Redis message parse error:", e);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a client (WS or SSE) to the auction room.
 * Returns a cleanup function — call it when the client disconnects.
 */
export function joinRoom(auctionId: string, client: RoomClient): () => void {
  let room = rooms.get(auctionId);
  if (!room) {
    room = new Set();
    rooms.set(auctionId, room);
    if (REDIS_AVAILABLE) {
      getRedisSubscriber().subscribe(ch(auctionId), (err) => {
        if (err) {
          console.error(`[auction-rooms] subscribe error for ${auctionId}:`, err.message);
        }
      });
    }
  }
  room.add(client);

  return () => {
    const r = rooms.get(auctionId);
    if (!r) return;
    r.delete(client);
    if (r.size === 0) {
      rooms.delete(auctionId);
      if (REDIS_AVAILABLE) {
        getRedisSubscriber().unsubscribe(ch(auctionId), (err) => {
          if (err) {
            console.error(`[auction-rooms] unsubscribe error for ${auctionId}:`, err.message);
          }
        });
      }
    }
  };
}

/**
 * Fan out a raw JSON string to every live client in the room on this instance.
 * Called by the Redis subscriber handler and by pushAuctionEvent (no-Redis fallback).
 */
export function broadcastToRoom(auctionId: string, raw: string): void {
  const room = rooms.get(auctionId);
  if (!room) return;
  for (const client of room) {
    try {
      if (client.kind === "ws") {
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(raw);
        }
      } else {
        client.enqueue(raw);
      }
    } catch {
      // Non-fatal: dead clients are removed by the sweep below.
    }
  }
}

// ---------------------------------------------------------------------------
// Dead-socket sweep
//
// WS clients that lost connectivity without sending a TCP FIN are not cleaned
// up by close/error events. This sweep removes them every 30 s.
// SSE clients are cleaned up via the request.signal abort event.
// ---------------------------------------------------------------------------

setInterval(() => {
  for (const [auctionId, room] of rooms) {
    for (const client of room) {
      if (client.kind === "ws" && client.socket.readyState !== WebSocket.OPEN) {
        room.delete(client);
      }
    }
    if (room.size === 0) {
      rooms.delete(auctionId);
      if (REDIS_AVAILABLE) {
        getRedisSubscriber().unsubscribe(ch(auctionId));
      }
    }
  }
}, 30_000).unref?.();
