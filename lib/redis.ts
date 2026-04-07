/**
 * Lazy Redis client singleton built on ioredis.
 *
 * Design goals:
 *  - Zero-cost when REDIS_URL is not set (single-instance fallback stays intact).
 *  - Two independent connections: one for commands/publish, one for subscribe.
 *    Redis requires a dedicated connection once SUBSCRIBE is called.
 *  - Reconnects automatically; offline commands are dropped (enableOfflineQueue: false)
 *    so API routes never stall waiting for a Redis that is temporarily unreachable.
 */

import Redis from "ioredis";

export const REDIS_AVAILABLE = Boolean(process.env.REDIS_URL);

type RedisClient = InstanceType<typeof Redis>;

let commandClient: RedisClient | null = null;
let subscriberClient: RedisClient | null = null;

function buildClient(label: string): RedisClient {
  const url = process.env.REDIS_URL!;
  const client = new Redis(url, {
    // Drop commands immediately when disconnected — never block the calling route.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    // Exponential back-off capped at 3 s.
    retryStrategy: (times) => Math.min(times * 150, 3_000),
    // Keep the connection alive under idle periods.
    keepAlive: 5_000,
    lazyConnect: true,
  });

  client.on("error", (err: Error) => {
    // Suppress ECONNREFUSED noise in development; always log in production.
    if (process.env.NODE_ENV === "production" || !err.message.includes("ECONNREFUSED")) {
      console.error(`[Redis:${label}] ${err.message}`);
    }
  });

  return client;
}

/** General-purpose client for GET/SET/PUBLISH/eval commands. */
export function getRedis(): RedisClient {
  if (!REDIS_AVAILABLE) throw new Error("Redis is not configured (REDIS_URL missing)");
  if (!commandClient) commandClient = buildClient("cmd");
  return commandClient;
}

/**
 * Dedicated subscriber connection.
 * Once a connection enters subscribe mode, it can only receive messages.
 * This must be a separate socket from the command client.
 */
export function getRedisSubscriber(): RedisClient {
  if (!REDIS_AVAILABLE) throw new Error("Redis is not configured (REDIS_URL missing)");
  if (!subscriberClient) subscriberClient = buildClient("sub");
  return subscriberClient;
}

/** Gracefully close both connections — call this on process shutdown. */
export async function closeRedis(): Promise<void> {
  const clients = [commandClient, subscriberClient].filter(Boolean) as RedisClient[];
  commandClient = null;
  subscriberClient = null;
  await Promise.allSettled(clients.map((c) => c.quit()));
}
