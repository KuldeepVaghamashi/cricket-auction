import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import { validateBid } from "@/lib/auction-utils";
import { pushAuctionInvalidation } from "@/lib/socket-hub";
import { emitBidUpdate } from "@/lib/socket-io-server";
import {
  acquireBidLock,
  releaseBidLock,
  invalidateCachedState,
  getCachedAuction,
  setCachedAuction,
  getCachedTeam,
  setCachedTeam,
} from "@/lib/auction-cache";
import type { AuctionState, Team, Auction, AuctionLog } from "@/lib/types";

/**
 * Process-local per-team throttle — cheap first line of defence against
 * accidental double-clicks from the same browser tab on this instance.
 * The distributed Redis lock below handles the cross-instance race condition.
 */
const bidThrottleMap = new Map<string, number>();
const BID_THROTTLE_MS = 250;

setInterval(() => {
  const cutoff = Date.now() - BID_THROTTLE_MS * 10;
  for (const [key, ts] of bidThrottleMap) {
    if (ts < cutoff) bidThrottleMap.delete(key);
  }
}, 60_000).unref?.();

// POST place bid
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid auction ID" }, { status: 400 });
    }

    const body = await request.json();
    const { teamId, amount } = body;

    if (!teamId || amount === undefined) {
      return NextResponse.json({ error: "Team ID and amount are required" }, { status: 400 });
    }

    if (!ObjectId.isValid(teamId)) {
      return NextResponse.json({ error: "Invalid team ID" }, { status: 400 });
    }

    const bidValue = Number(amount);
    if (!Number.isFinite(bidValue)) {
      return NextResponse.json({ error: "Invalid bid amount" }, { status: 400 });
    }

    // ── Process-local per-team throttle ──────────────────────────────────────
    const throttleKey = `${id}:${teamId}`;
    const nowMs = Date.now();
    if (nowMs - (bidThrottleMap.get(throttleKey) ?? 0) < BID_THROTTLE_MS) {
      return NextResponse.json(
        { error: "Please wait a moment before bidding again" },
        { status: 429 }
      );
    }
    bidThrottleMap.set(throttleKey, nowMs);

    // ── Pre-warm: DB connection + Redis cache reads + lock in parallel ────────
    // Auction and team docs are stable during active bidding — they only change
    // on non-bid events (complete/pick/reset). Reading them from Redis cache
    // before entering the lock means the critical section only needs ONE MongoDB
    // read (state) instead of three. On cache miss the full DB fetch is used as
    // fallback, and the result is cached for subsequent bids.
    const db = await getDb();
    const auctionId = new ObjectId(id);
    const teamObjectId = new ObjectId(teamId);

    const auctionsCol = db.collection<Auction>("auctions");
    const teamsCol = db.collection<Team>("teams");
    const statesCol = db.collection<AuctionState>("auctionStates");
    const logsCol = db.collection<AuctionLog>("auctionLogs");

    // Run lock acquisition and cache reads in parallel — lock is ~1–3 ms,
    // cache reads are ~1–5 ms. This keeps pre-lock latency near zero while
    // ensuring we hold the lock for as short a time as possible.
    const [lockToken, cachedAuction, cachedTeam] = await Promise.all([
      acquireBidLock(id),
      getCachedAuction(id),
      getCachedTeam(id, teamId),
    ]);

    // ── Distributed auction-level lock ───────────────────────────────────────
    if (!lockToken) {
      return NextResponse.json(
        { error: "Another bid is being processed, please try again" },
        { status: 429 }
      );
    }

    try {
      // Inside the lock: resolve each read from cache when available, or fall
      // back to MongoDB. State is always read fresh — it changes every bid and
      // must be consistent with the write that follows inside this lock.
      const auctionPromise: Promise<Auction | null> = cachedAuction
        ? Promise.resolve(cachedAuction as unknown as Auction)
        : auctionsCol.findOne(
            { _id: auctionId },
            { projection: { _id: 1, status: 1, minIncrement: 1, minBid: 1, maxPlayersPerTeam: 1, thresholdAmount: 1, thresholdIncrement: 1 } }
          );

      const teamPromise: Promise<Team | null> = cachedTeam
        ? Promise.resolve(cachedTeam as unknown as Team)
        : teamsCol.findOne(
            { _id: teamObjectId, auctionId },
            { projection: { _id: 1, name: 1, remainingBudget: 1, playersBought: 1 } }
          );

      const [auction, team, state] = await Promise.all([
        auctionPromise,
        teamPromise,
        statesCol.findOne(
          { auctionId },
          {
            // bidHistory is NOT needed for bid validation — omitting it keeps
            // the read smaller and faster. bidCounts is needed so we can return
            // the updated counts in the response without an extra DB round-trip.
            projection: {
              currentPlayerId: 1,
              currentBid: 1,
              currentTeamId: 1,
              currentTeamName: 1,
              bidCounts: 1,
            },
          }
        ),
      ]);

      // Warm cache on misses so subsequent bids skip the MongoDB round-trips.
      if (!cachedAuction && auction) void setCachedAuction(id, auction as unknown as Record<string, unknown>);
      if (!cachedTeam && team) void setCachedTeam(id, teamId, team as unknown as Record<string, unknown>);

      if (!auction) {
        return NextResponse.json({ error: "Auction not found" }, { status: 404 });
      }
      if (auction.status !== "active") {
        return NextResponse.json({ error: "Auction is not active" }, { status: 400 });
      }
      if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
      }
      if (!state || !state.currentPlayerId) {
        return NextResponse.json(
          { error: "No player is currently up for auction" },
          { status: 400 }
        );
      }

      // Leading team cannot outbid itself.
      if (state.currentTeamId?.toString() === teamObjectId.toString()) {
        return NextResponse.json(
          { error: "Leading team cannot place another bid" },
          { status: 400 }
        );
      }

      // Business-rule validation (budget, increment, slot limits).
      const isFirstBid = state.currentTeamId === null;
      const validation = validateBid(bidValue, team, auction, state.currentBid, { isFirstBid });
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      // ── Atomic write ────────────────────────────────────────────────────────
      const bidTimestamp = new Date();
      const bidEntryForDb = {
        teamId: teamObjectId,
        teamName: team.name,
        amount: bidValue,
        timestamp: bidTimestamp,
      };
      const updatedAt = bidTimestamp;

      // Compute next bidCounts locally so we can return it in the response
      // without an extra DB round-trip. state.bidCounts is the pre-write value
      // read at the top of the lock, so incrementing here is always accurate.
      const prevBidCounts = (state.bidCounts as Record<string, number> | undefined) ?? {};
      const nextBidCounts: Record<string, number> = {
        ...prevBidCounts,
        [teamId]: (prevBidCounts[teamId] ?? 0) + 1,
      };

      await statesCol.updateOne(
        { auctionId },
        {
          $set: {
            currentBid: bidValue,
            currentTeamId: teamObjectId,
            currentTeamName: team.name,
            updatedAt,
          },
          $push: { bidHistory: bidEntryForDb },
          // Atomically increment the per-team bid count — always accurate,
          // never truncated like bidHistory which is sliced for payloads.
          $inc: { [`bidCounts.${teamId}`]: 1 } as any,
        }
      );

      // Invalidate the Redis cache immediately so the next GET (from any
      // client) reads the just-committed state from MongoDB rather than stale
      // cached data. This is a single DEL — cheaper than the previous
      // GET+SETEX write-through, and it keeps the lock held for less time.
      // Fire-and-forget: cache miss on next GET is safe (cold read from MongoDB).
      void invalidateCachedState(id);

      // Non-blocking audit log.
      void logsCol
        .insertOne({
          auctionId,
          action: "bid_placed",
          details: { teamId: team._id?.toString(), teamName: team.name, amount: bidValue },
          timestamp: new Date(),
        })
        .catch((e) => console.error("Bid log insert failed:", e));

      const bidTimestampIso = bidTimestamp.toISOString();

      // Serialisable bid entry for response and WS delta.
      const bidEntryForPayload = {
        teamId,
        teamName: team.name,
        amount: bidValue,
        timestamp: bidTimestampIso,
      };

      // Native WS → viewer clients only (inline delta avoids a second HTTP round-trip).
      // Admin clients are notified via emitBidUpdate below — using both channels
      // would cause a double SWR mutation per bid (event flooding).
      pushAuctionInvalidation(id, ["st", "lg"], {
        currentBid: bidValue,
        currentTeamId: teamId,
        currentTeamName: team.name,
        bidEntry: {
          teamName: team.name,
          amount: bidValue,
          timestamp: bidTimestampIso,
        },
      });

      // Socket.IO → admin clients: targeted "bid:update" so only
      // currentBid / currentPlayer / timer re-render, not the full page.
      emitBidUpdate(id, {
        currentBid: bidValue,
        currentTeamId: teamId,
        currentTeamName: team.name,
        updatedAt: bidTimestampIso,
      });

      // Return full confirmed state so the placing-admin can update local
      // SWR state directly from this response — no extra GET needed.
      return NextResponse.json({
        success: true,
        currentBid: bidValue,
        currentTeamId: teamId,
        currentTeamName: team.name,
        updatedAt: bidTimestampIso,
        bidEntry: bidEntryForPayload,
        bidCounts: nextBidCounts,
      });
    } finally {
      // Always release — even if an error was thrown above.
      void releaseBidLock(id, lockToken);
    }
  } catch (error) {
    console.error("Bid error:", error);
    return NextResponse.json({ error: "Failed to place bid" }, { status: 500 });
  }
}
