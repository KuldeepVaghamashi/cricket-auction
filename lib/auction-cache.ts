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

/** Lock TTL in milliseconds. Covers worst-case DB round-trip time.
 *  The critical section includes: 3 parallel DB reads + 1 updateOne + 1 Redis
 *  write-through. On a remote cloud DB this can reach 800–1200 ms under load.
 *  2000 ms gives safe headroom while still blocking subsequent bids for < 2 s
 *  in the degenerate case where the lock expires before the holder releases it. */
const BID_LOCK_TTL_MS = 2000;

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

// ---------------------------------------------------------------------------
// Auction Document Cache
//
// Auction settings (minIncrement, minBid, maxPlayersPerTeam, thresholdAmount,
// thresholdIncrement, status) are static during active bidding. Caching the
// auction doc eliminates one MongoDB read per bid — switching the critical
// path from "3 parallel DB reads" to "1 DB read + 2 Redis reads".
// TTL is 30 s so status changes propagate quickly.
// Invalidated explicitly by PUT /api/auctions/[id] whenever settings change.
// ---------------------------------------------------------------------------

const AUCTION_DOC_CACHE_TTL_S = 30;
const auctionDocKey = (auctionId: string) => `auction:doc:${auctionId}`;

export async function getCachedAuction(auctionId: string): Promise<Record<string, unknown> | null> {
  if (!REDIS_AVAILABLE) return null;
  try {
    const raw = await getRedis().get(auctionDocKey(auctionId));
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function setCachedAuction(
  auctionId: string,
  auction: Record<string, unknown>
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    await getRedis().setex(auctionDocKey(auctionId), AUCTION_DOC_CACHE_TTL_S, JSON.stringify(auction));
  } catch {
    // Non-fatal.
  }
}

export async function invalidateCachedAuction(auctionId: string): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    await getRedis().del(auctionDocKey(auctionId));
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Team Document Cache (bid path)
//
// A team's remainingBudget and playersBought only change when a player is
// sold (complete route). During active bidding on a player the team doc is
// stable — caching it eliminates a second MongoDB read per bid.
// TTL is 60 s. Invalidated by the complete route when action === "sold".
// ---------------------------------------------------------------------------

const TEAM_BID_CACHE_TTL_S = 60;
const teamBidKey = (auctionId: string, teamId: string) => `team:bid:${auctionId}:${teamId}`;

export async function getCachedTeam(
  auctionId: string,
  teamId: string
): Promise<Record<string, unknown> | null> {
  if (!REDIS_AVAILABLE) return null;
  try {
    const raw = await getRedis().get(teamBidKey(auctionId, teamId));
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function setCachedTeam(
  auctionId: string,
  teamId: string,
  team: Record<string, unknown>
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    await getRedis().setex(teamBidKey(auctionId, teamId), TEAM_BID_CACHE_TTL_S, JSON.stringify(team));
  } catch {
    // Non-fatal.
  }
}

export async function invalidateCachedTeam(auctionId: string, teamId: string): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    await getRedis().del(teamBidKey(auctionId, teamId));
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Write-through helpers
//
// Keeping cache and DB in sync on every mutation means new clients always
// get current state from Redis — no MongoDB cold-read on connect.
//
// All helpers are best-effort: a Redis failure leaves the cache stale but
// never corrupts the source of truth (MongoDB).
// ---------------------------------------------------------------------------

/**
 * Atomic delta-update for bid events.
 *
 * Patches only the bid-related fields so the current player is preserved.
 * MUST be called inside the bid lock so no concurrent bid can race this
 * read-modify-write.
 * If there is no cached entry yet (cold start), this is a no-op and the
 * next GET will warm the cache from MongoDB.
 */
export async function writeThroughBid(
  auctionId: string,
  patch: {
    currentBid: number;
    currentTeamId: string;
    currentTeamName: string;
    bidEntry: { teamId: string; teamName: string; amount: number; timestamp: string };
    updatedAt: string;
  }
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    const raw = await getRedis().get(stateKey(auctionId));
    if (!raw) return; // no baseline — next GET will warm the cache
    const cached = JSON.parse(raw) as Record<string, unknown>;
    const prev = Array.isArray(cached.bidHistory) ? (cached.bidHistory as unknown[]) : [];
    // Increment the team's bid count in the cached entry so the admin sees
    // an accurate count without waiting for a full MongoDB round-trip.
    const prevCounts = (cached.bidCounts as Record<string, number> | undefined) ?? {};
    const updated: Record<string, unknown> = {
      ...cached,
      currentBid: patch.currentBid,
      currentTeamId: patch.currentTeamId,
      currentTeamName: patch.currentTeamName,
      // Keep latest 10 entries — same cap as the lite GET endpoint.
      bidHistory: [...prev.slice(-9), patch.bidEntry],
      bidCounts: {
        ...prevCounts,
        [patch.currentTeamId]: (prevCounts[patch.currentTeamId] ?? 0) + 1,
      },
      updatedAt: patch.updatedAt,
    };
    await getRedis().setex(stateKey(auctionId), STATE_CACHE_TTL_S, JSON.stringify(updated));
  } catch {
    // Non-fatal: stale cache replaced on next GET.
  }
}

/**
 * Full write-through for pick-random events.
 *
 * Caches the complete new-player state so the first viewer to connect
 * after a pick sees the new player from Redis, not MongoDB.
 * Preserves the state document _id from the existing cache entry if
 * present so the admin lite response stays complete.
 */
export async function writeThroughPick(
  auctionId: string,
  player: { _id: string; auctionId: string; name: string; basePrice: number },
  updatedAt: string
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    const raw = await getRedis().get(stateKey(auctionId));
    const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const payload: Record<string, unknown> = {
      ...base, // preserves _id, auctionId string, and any extra fields
      auctionId,
      currentPlayerId: player._id,
      currentBid: player.basePrice,
      currentTeamId: null,
      currentTeamName: null,
      bidHistory: [],
      bidCounts: {},
      updatedAt,
      currentPlayer: {
        _id: player._id,
        auctionId: player.auctionId,
        name: player.name,
        basePrice: player.basePrice,
      },
    };
    await getRedis().setex(stateKey(auctionId), STATE_CACHE_TTL_S, JSON.stringify(payload));
  } catch {
    // Non-fatal.
  }
}

/**
 * Partial write-through for complete / undo-bid / reset events.
 *
 * Merges the given patch fields onto the cached state so new clients
 * immediately see the post-action state without hitting MongoDB.
 * If there is no existing cache entry the patch fields are written on
 * their own — the next full GET will fill in the rest from MongoDB.
 */
export async function writeThroughPatch(
  auctionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  if (!REDIS_AVAILABLE) return;
  try {
    const raw = await getRedis().get(stateKey(auctionId));
    const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const updated = { ...base, ...patch };
    await getRedis().setex(stateKey(auctionId), STATE_CACHE_TTL_S, JSON.stringify(updated));
  } catch {
    // Non-fatal.
  }
}
