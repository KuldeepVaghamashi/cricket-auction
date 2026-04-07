/**
 * Redis-backed helpers for the live auction hot path:
 *
 *  1. Distributed bid lock   — prevents race conditions when multiple clients
 *     bid simultaneously across different server instances.
 *
 *  2. Auction state cache    — reduces MongoDB reads on the high-frequency
 *     state GET endpoint. Invalidated on every write so readers always see
 *     fresh data within one cache cycle.
 *
 * All functions degrade gracefully: when Redis is unavailable they return
 * safe fallback values so the app continues to work as a single instance.
 */

import { getRedis, REDIS_AVAILABLE } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const bidLockKey = (auctionId: string) => `bid_lock:${auctionId}`;
const stateKey = (auctionId: string) => `auction:state:${auctionId}`;

// ---------------------------------------------------------------------------
// Distributed Bid Lock
//
// Uses the standard Redis SET NX PX pattern (no extra library needed).
// Each caller gets a random token; the Lua release script ensures only the
// owner can delete the key — prevents a slow process from releasing a lock
// that has already expired and been acquired by another process.
// ---------------------------------------------------------------------------

/** Lock TTL in milliseconds. Covers worst-case DB round-trip time. */
const BID_LOCK_TTL_MS = 500;

/**
 * Try to acquire the auction-level bid lock.
 *
 * @returns token string on success (pass to releaseBidLock), null on failure.
 *
 * When Redis is unavailable the app falls back to single-instance mode and
 * returns a sentinel token so the bid still proceeds.
 */
export async function acquireBidLock(auctionId: string): Promise<string | null> {
  if (!REDIS_AVAILABLE) return "no-redis-single-instance";

  try {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const result = await getRedis().set(
      bidLockKey(auctionId),
      token,
      "PX",
      BID_LOCK_TTL_MS,
      "NX"
    );
    return result === "OK" ? token : null;
  } catch {
    // Redis unreachable — allow bid on best-effort basis.
    return "redis-error-fallback";
  }
}

/** Safe release: Lua CAS ensures we only delete our own lock. */
export async function releaseBidLock(auctionId: string, token: string): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  if (token === "no-redis-single-instance" || token === "redis-error-fallback") return;

  try {
    await getRedis().eval(
      // Atomically: if GET key == token, DEL key; else no-op.
      `if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end`,
      1,
      bidLockKey(auctionId),
      token
    );
  } catch {
    // Lock will expire naturally after BID_LOCK_TTL_MS — non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Auction State Cache
//
// The GET /state endpoint is polled by the admin live page whenever the
// WebSocket is not connected. Caching the response in Redis reduces MongoDB
// load during peak bidding while keeping latency low.
// TTL is intentionally short (8 s) so the cache never serves stale data for
// more than one polling cycle.
// ---------------------------------------------------------------------------

const STATE_CACHE_TTL_S = 8;

export async function getCachedState(auctionId: string): Promise<Record<string, unknown> | null> {
  if (!REDIS_AVAILABLE) return null;
  try {
    const raw = await getRedis().get(stateKey(auctionId));
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function setCachedState(
  auctionId: string,
  state: Record<string, unknown>
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    await getRedis().setex(stateKey(auctionId), STATE_CACHE_TTL_S, JSON.stringify(state));
  } catch {
    // Non-fatal: next read simply goes to MongoDB.
  }
}

export async function invalidateCachedState(auctionId: string): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    await getRedis().del(stateKey(auctionId));
  } catch {
    // Non-fatal.
  }
}
