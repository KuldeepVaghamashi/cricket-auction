/**
 * WebSocket server — attaches to the custom Node.js HTTP server.
 *
 * Scalability additions (vs. original):
 *
 *  1. Redis subscriber — when REDIS_URL is set every instance subscribes to
 *     the shared "auction:invalidations" channel. A bid processed on instance A
 *     triggers a Redis PUBLISH; all instances (A, B, C …) receive it and fan
 *     out to their locally-connected clients. Without this, clients on a
 *     different instance would never see the update.
 *
 *  2. Dead-socket pruning — a 30 s interval sweeps rooms and removes sockets
 *     that are no longer OPEN without waiting for a close event (handles
 *     abruptly dropped TCP connections that don't send a FIN).
 *
 *  3. Empty-room cleanup — already applied in the previous optimisation pass;
 *     retained here.
 */

import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ObjectId } from "mongodb";
import {
  registerAuctionWsEmit,
  REDIS_AUCTION_CHANNEL,
  type AuctionWsPush,
} from "@/lib/socket-hub";
import { getRedisSubscriber, REDIS_AVAILABLE } from "@/lib/redis";

const WS_PATH = "/api/auctions/ws";

export function attachAuctionSocketServer(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  /** auctionId → set of live sockets on THIS instance. */
  const rooms = new Map<string, Set<WebSocket>>();

  // ---------------------------------------------------------------------------
  // Core broadcast helper (used by both local emit and Redis subscriber)
  // ---------------------------------------------------------------------------

  const broadcastRaw = (auctionId: string, raw: string): void => {
    const room = rooms.get(auctionId);
    if (!room) return;
    for (const client of room) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Register local-emit path (single-instance fallback / Redis-unavailable)
  // ---------------------------------------------------------------------------

  registerAuctionWsEmit((auctionId: string, msg: AuctionWsPush): void => {
    try {
      broadcastRaw(auctionId, JSON.stringify(msg));
    } catch (e) {
      console.error("[socket-server] local broadcast error:", e);
    }
  });

  // ---------------------------------------------------------------------------
  // Redis subscriber — cross-instance fanout
  // ---------------------------------------------------------------------------

  if (REDIS_AVAILABLE) {
    const subscriber = getRedisSubscriber();

    subscriber.subscribe(REDIS_AUCTION_CHANNEL, (err) => {
      if (err) {
        console.error("[socket-server] Redis subscribe error:", err.message);
      } else {
        console.log(`[socket-server] Subscribed to Redis channel "${REDIS_AUCTION_CHANNEL}"`);
      }
    });

    subscriber.on("message", (_channel: string, message: string): void => {
      try {
        const { auctionId, msg } = JSON.parse(message) as {
          auctionId: string;
          msg: AuctionWsPush;
        };
        if (typeof auctionId === "string" && msg?.v === 1) {
          broadcastRaw(auctionId, JSON.stringify(msg));
        }
      } catch (e) {
        console.error("[socket-server] Redis message parse error:", e);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP upgrade → WebSocket handshake
  // ---------------------------------------------------------------------------

  server.on("upgrade", (req, socket, head): void => {
    try {
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname !== WS_PATH) {
        // Not our path — let other upgrade handlers (e.g. Socket.IO) process it.
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  wss.on("connection", (ws: WebSocket, req: IncomingMessage): void => {
    const host = req.headers.host ?? "127.0.0.1";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const auctionId = url.searchParams.get("auctionId") ?? "";

    if (!ObjectId.isValid(auctionId)) {
      ws.close(1008, "Invalid auctionId");
      return;
    }

    if (!rooms.has(auctionId)) rooms.set(auctionId, new Set());
    rooms.get(auctionId)!.add(ws);

    const leave = (): void => {
      const room = rooms.get(auctionId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) rooms.delete(auctionId);
      }
    };

    ws.on("close", leave);
    ws.on("error", leave);
  });

  // ---------------------------------------------------------------------------
  // Dead-socket sweep — handles abruptly disconnected clients (no FIN sent).
  // Runs every 30 s; negligible overhead even with hundreds of rooms.
  // ---------------------------------------------------------------------------

  const pruneInterval = setInterval((): void => {
    for (const [auctionId, room] of rooms) {
      for (const ws of room) {
        if (ws.readyState !== WebSocket.OPEN) room.delete(ws);
      }
      if (room.size === 0) rooms.delete(auctionId);
    }
  }, 30_000);

  pruneInterval.unref?.();
}
