/**
 * Redis-backed helpers for the live auction hot path:
 *
 *  1. Distributed bid lock    — prevents race conditions when multiple clients
 *     bid simultaneously across different server instances.
 *
 *  2. Auction state cache     — reduces MongoDB reads on the high-frequency
 *     state GET endpoint. Write-through on bid; invalidated on other writes.
 *
 *  3. Sequence counter        — monotonic per-auction integer (INCR). Embedded
 *     in every published event so clients can detect missed events and resync.
 *
 * All functions degrade gracefully: when Redis is unavailable they return
 * safe fallback values so the app continues to work as a single instance.
 */

import { getRedis, REDIS_AVAILABLE } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const bidLockKey  = (auctionId: string) => `bid_lock:${auctionId}`;
const stateKey    = (auctionId: string) => `auction:state:${auctionId}`;
const sseStateKey = (auctionId: string) => `auction:sseraw:${auctionId}`;
const snapKey     = (auctionId: string, mode: string) => `auction:snap:${auctionId}:${mode}`;
/** Monotonic sequence counter — INCR'd on every auction mutation. */
const seqKey      = (auctionId: string) => `auction:seq:${auctionId}`;

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

// ---------------------------------------------------------------------------
// SSE State Cache
//
// The SSE stream (/api/auctions/[id]/stream) reads auctionStates every 600 ms
// per connected viewer. Caching the state projection in Redis means all viewers
// share a single DB read per cache cycle instead of each hitting MongoDB.
// TTL is 2 s — long enough to amortise bursts, short enough that a missed
// invalidation self-heals quickly. The key is deleted by invalidateCachedState
// on every auction write (bid, sell, unsold, pick, etc.).
// ---------------------------------------------------------------------------

const SSE_STATE_CACHE_TTL_MS = 2_000;

export async function getCachedSseState(
  auctionId: string
): Promise<Record<string, unknown> | null> {
  if (!REDIS_AVAILABLE) return null;
  try {
    const raw = await getRedis().get(sseStateKey(auctionId));
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function setCachedSseState(
  auctionId: string,
  state: Record<string, unknown>
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    await getRedis().set(
      sseStateKey(auctionId),
      JSON.stringify(state),
      "PX",
      SSE_STATE_CACHE_TTL_MS
    );
  } catch {
    // Non-fatal.
  }
}

export async function invalidateCachedState(auctionId: string): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    // Pipeline all deletes in a single round-trip.
    await getRedis()
      .pipeline()
      .del(stateKey(auctionId))
      .del(sseStateKey(auctionId))
      .del(snapKey(auctionId, "full"))
      .del(snapKey(auctionId, "state"))
      .del(snapKey(auctionId, "stats"))
      .exec();
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Viewer Snapshot Cache
//
// GET /viewer-snapshot is called by every WebSocket-connected viewer after each
// WS invalidation message. Without caching, a SELL event with 200 viewers
// triggers 200 concurrent buildViewerStreamPayload calls — 6 MongoDB ops each.
// Caching the serialised payload in Redis means all 200 viewers share a single
// DB read per 5 s window. The key is invalidated by invalidateCachedState on
// every auction write (bid, sell, unsold, pick).
// ---------------------------------------------------------------------------

const SNAP_TTL_S = 5;

export async function getCachedSnap(
  auctionId: string,
  mode: string
): Promise<string | null> {
  if (!REDIS_AVAILABLE) return null;
  try {
    return await getRedis().get(snapKey(auctionId, mode));
  } catch {
    return null;
  }
}

export async function setCachedSnap(
  auctionId: string,
  mode: string,
  payload: unknown
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    await getRedis().setex(snapKey(auctionId, mode), SNAP_TTL_S, JSON.stringify(payload));
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Sequence Counter
//
// Every auction mutation increments this counter atomically.  The resulting
// value is embedded in the published AuctionEvent so clients can detect
// missed events (seq !== lastSeq + 1) and request a resync snapshot.
//
// Falls back to Date.now() when Redis is unavailable — clients that receive
// a non-consecutive seq simply treat it as a gap and fetch a fresh snapshot,
// which is the safe behaviour.
// ---------------------------------------------------------------------------

/**
 * Atomically increment the auction sequence counter.
 * Returns the new value (1-based; 0 means Redis was unavailable).
 */
export async function incrSeq(auctionId: string): Promise<number> {
  if (!REDIS_AVAILABLE) return 0;
  try {
    return await getRedis().incr(seqKey(auctionId));
  } catch {
    return 0;
  }
}

/** Read the current sequence value without incrementing. */
export async function getSeq(auctionId: string): Promise<number> {
  if (!REDIS_AVAILABLE) return 0;
  try {
    const val = await getRedis().get(seqKey(auctionId));
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Write-Through Bid State
//
// On a successful bid the admin state cache is updated in-place rather than
// deleted.  This eliminates the empty-cache window (delete → next fetch hits
// MongoDB) that caused a mini-stampede on the /state?lite=1 endpoint during
// rapid bidding.
//
// The SSE and snapshot caches are still deleted because their shapes differ
// and rebuilding them from partial data is error-prone.
// ---------------------------------------------------------------------------

export type BidStateUpdate = {
  currentBid: number;
  currentTeamId: string;
  currentTeamName: string;
  bidEntry: { teamId: string; teamName: string; amount: number; timestamp: string };
  updatedAt: string;
};

/**
 * Update the admin state cache with the new bid values in a single pipeline:
 *   – SET auction:state:{id}  (write-through, 8 s TTL)
 *   – DEL auction:sseraw:{id}
 *   – DEL auction:snap:{id}:*
 */
export async function writeThroughBidState(
  auctionId: string,
  prev: Record<string, unknown>,
  update: BidStateUpdate
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    const prevHistory = Array.isArray(prev.bidHistory) ? prev.bidHistory as unknown[] : [];
    const newState = {
      ...prev,
      currentBid: update.currentBid,
      currentTeamId: update.currentTeamId,
      currentTeamName: update.currentTeamName,
      bidHistory: [...prevHistory, update.bidEntry].slice(-20),
      updatedAt: update.updatedAt,
    };
    await getRedis()
      .pipeline()
      .setex(stateKey(auctionId), STATE_CACHE_TTL_S, JSON.stringify(newState))
      .del(sseStateKey(auctionId))
      .del(snapKey(auctionId, "full"))
      .del(snapKey(auctionId, "state"))
      .del(snapKey(auctionId, "stats"))
      .exec();
  } catch {
    // Fall back to plain invalidation so stale cache doesn't persist.
    void invalidateCachedState(auctionId);
  }
}
