/**
 * Socket.IO server — attaches to the custom Node.js HTTP server alongside
 * the existing native-ws server (which continues to serve the viewer).
 *
 * Rooms are named  auction_<auctionId>  so they are distinct from any future
 * native-WS room keys.
 *
 * Events emitted to clients:
 *   "bid:update"         — on every new bid (targeted: currentBid / currentPlayer / timer)
 *   "auction:invalidate" — on all other state changes (sold, unsold, pick, reset …)
 */

import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { ObjectId } from "mongodb";
import type { AuctionInvScope } from "@/lib/socket-hub";

const IO_PATH = "/api/auctions/io";

let io: SocketIOServer | null = null;

export type BidUpdatePayload = {
  currentBid: number;
  currentTeamId: string | null;
  currentTeamName: string | null;
  currentPlayer?: { _id: string; name: string; basePrice: number } | null;
  /** ISO timestamp — client can use as the live bid timer reference */
  updatedAt: string;
};

export function attachAuctionSocketIO(server: HttpServer): void {
  io = new SocketIOServer(server, {
    path: IO_PATH,
    // WebSocket-only: skip HTTP long-polling, matching native-WS behaviour.
    // Clients that cannot open a WS will fall back to SWR polling instead.
    transports: ["websocket"],
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket) => {
    const auctionId = socket.handshake.query.auctionId;

    if (typeof auctionId !== "string" || !ObjectId.isValid(auctionId)) {
      socket.disconnect(true);
      return;
    }

    // Each auction gets its own room; broadcast targets only that room.
    socket.join(`auction_${auctionId}`);

    // Clients are read-only — no inbound events expected.
  });

  console.log(`[socket-io] Socket.IO server ready at path ${IO_PATH}`);
}

/** Emit a targeted bid update — only currentBid / currentPlayer / timer change. */
export function emitBidUpdate(auctionId: string, data: BidUpdatePayload): void {
  io?.to(`auction_${auctionId}`).emit("bid:update", data);
}

/** Emit a general invalidation for non-bid events (sold, unsold, pick, reset …). */
export function emitAuctionInvalidate(auctionId: string, scopes: AuctionInvScope[]): void {
  io?.to(`auction_${auctionId}`).emit("auction:invalidate", { scopes });
}
