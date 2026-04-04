import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ObjectId } from "mongodb";
import { registerAuctionWsEmit, type AuctionWsPush } from "@/lib/socket-hub";

const WS_PATH = "/api/auctions/ws";

export function attachAuctionSocketServer(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Set<WebSocket>>();

  const broadcastRaw = (auctionId: string, raw: string) => {
    const room = rooms.get(auctionId);
    if (!room) return;
    for (const client of room) {
      if (client.readyState === WebSocket.OPEN) client.send(raw);
    }
  };

  registerAuctionWsEmit((auctionId: string, msg: AuctionWsPush) => {
    try {
      broadcastRaw(auctionId, JSON.stringify(msg));
    } catch (e) {
      console.error("Auction WS broadcast error:", e);
    }
  });

  server.on("upgrade", (req, socket, head) => {
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

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const host = req.headers.host ?? "127.0.0.1";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const auctionId = url.searchParams.get("auctionId") ?? "";
    if (!ObjectId.isValid(auctionId)) {
      ws.close(1008, "Invalid auctionId");
      return;
    }
    if (!rooms.has(auctionId)) rooms.set(auctionId, new Set());
    rooms.get(auctionId)!.add(ws);

    const leave = () => {
      rooms.get(auctionId)?.delete(ws);
    };
    ws.on("close", leave);
    ws.on("error", leave);
  });
}
