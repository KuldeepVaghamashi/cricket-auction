import * as http from "node:http";
import { parse } from "node:url";
import next from "next";
import { attachAuctionSocketServer } from "./lib/socket-server";
import { validateProductionEnvironment } from "./lib/env-validation";
import { closeRedis, REDIS_AVAILABLE } from "./lib/redis";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  if (!dev) {
    try {
      validateProductionEnvironment();
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  }

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

  const shutdown = () => {
    server.close(async () => {
      if (REDIS_AVAILABLE) {
        try { await closeRedis(); } catch { /* non-fatal */ }
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
});
