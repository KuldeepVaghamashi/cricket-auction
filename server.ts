import * as http from "node:http";
import { parse } from "node:url";
import next from "next";
import { attachAuctionSocketServer } from "./lib/socket-server";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url ?? "/", true);
      void handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Request handler error:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  attachAuctionSocketServer(server);

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (auction WebSocket at /api/auctions/ws)`);
  });
});
