/**
 * WebSocket server — attaches to the custom Node.js HTTP server.
 *
 * All room management (fan-out, Redis subscription lifecycle) is now handled
 * by lib/auction-rooms.ts.  This file is responsible only for:
 *
 *  1. Upgrading HTTP connections to WebSocket at /api/auctions/ws.
 *  2. Validating the auctionId query parameter.
 *  3. Registering the socket in the unified auction room and cleaning up
 *     when it closes.
 *
 * The broadcastToRoom function in auction-rooms.ts handles delivery to both
 * WebSocket and SSE clients, and the Redis subscriber there handles cross-
 * instance fan-out.
 */

import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ObjectId } from "mongodb";
import { joinRoom } from "@/lib/auction-rooms";

const WS_PATH = "/api/auctions/ws";

export function attachAuctionSocketServer(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // ---------------------------------------------------------------------------
  // HTTP upgrade → WebSocket handshake
  // ---------------------------------------------------------------------------

  server.on("upgrade", (req, socket, head): void => {
    try {
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname !== WS_PATH) {
        socket.destroy();
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

    // Register in the unified room; leave() handles deregistration + Redis unsub
    // when the room becomes empty.
    const leave = joinRoom(auctionId, { kind: "ws", socket: ws });

    ws.on("close", leave);
    ws.on("error", leave);
  });
}
