import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import { validateBid } from "@/lib/auction-utils";
import { pushAuctionInvalidation } from "@/lib/socket-hub";
import { emitBidUpdate } from "@/lib/socket-io-server";
import { acquireBidLock, releaseBidLock, writeThroughBid } from "@/lib/auction-cache";
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

    // ── Distributed auction-level lock ───────────────────────────────────────
    // Serialises all bids for the same auction across every server instance.
    // Prevents two simultaneous bids from both reading the same currentBid,
    // both passing validation, and the second overwriting the first.
    const lockToken = await acquireBidLock(id);
    if (!lockToken) {
      return NextResponse.json(
        { error: "Another bid is being processed, please try again" },
        { status: 429 }
      );
    }

    try {
      const db = await getDb();
      const auctionId = new ObjectId(id);
      const teamObjectId = new ObjectId(teamId);

      const auctionsCol = db.collection<Auction>("auctions");
      const teamsCol = db.collection<Team>("teams");
      const statesCol = db.collection<AuctionState>("auctionStates");
      const logsCol = db.collection<AuctionLog>("auctionLogs");

      // Fetch auction, team, and state in parallel (minimal projections).
      // Always read fresh from MongoDB inside the lock — cache is for reads
      // outside the critical section.
      const [auction, team, state] = await Promise.all([
        auctionsCol.findOne(
          { _id: auctionId },
          { projection: { _id: 1, status: 1, minIncrement: 1, minBid: 1, maxPlayersPerTeam: 1 } }
        ),
        teamsCol.findOne(
          { _id: teamObjectId, auctionId },
          { projection: { _id: 1, name: 1, remainingBudget: 1, playersBought: 1 } }
        ),
        statesCol.findOne(
          { auctionId },
          {
            projection: {
              currentPlayerId: 1,
              currentBid: 1,
              currentTeamId: 1,
              currentTeamName: 1,
              bidHistory: 1,
            },
          }
        ),
      ]);

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
      const bidEntry = {
        teamId: teamObjectId,
        teamName: team.name,
        amount: bidValue,
        timestamp: new Date(),
      };
      const updatedAt = new Date();

      await statesCol.updateOne(
        { auctionId },
        {
          $set: {
            currentBid: bidValue,
            currentTeamId: teamObjectId,
            currentTeamName: team.name,
            updatedAt,
          },
          $push: { bidHistory: bidEntry },
          // Atomically increment the per-team bid count for the current round.
          // More accurate than computing count from the sliced bidHistory payload.
          $inc: { [`bidCounts.${teamId}`]: 1 } as any,
        }
      );

      // Write-through: patch the cached state with the new bid so the next
      // client to connect gets current data from Redis, not MongoDB.
      // Awaited inside the bid lock — the read-modify-write is fully
      // serialised, so no concurrent bid can race this cache update.
      await writeThroughBid(id, {
        currentBid: bidValue,
        currentTeamId: teamId,
        currentTeamName: team.name,
        bidEntry: {
          teamId,
          teamName: team.name,
          amount: bidValue,
          timestamp: updatedAt.toISOString(),
        },
        updatedAt: updatedAt.toISOString(),
      });

      // Non-blocking audit log.
      void logsCol
        .insertOne({
          auctionId,
          action: "bid_placed",
          details: { teamId: team._id?.toString(), teamName: team.name, amount: bidValue },
          timestamp: new Date(),
        })
        .catch((e) => console.error("Bid log insert failed:", e));

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
          timestamp: updatedAt.toISOString(),
        },
      });

      // Socket.IO → admin clients: targeted "bid:update" so only
      // currentBid / currentPlayer / timer re-render, not the full page.
      emitBidUpdate(id, {
        currentBid: bidValue,
        currentTeamId: teamId,
        currentTeamName: team.name,
        updatedAt: updatedAt.toISOString(),
      });

      return NextResponse.json({
        success: true,
        currentBid: bidValue,
        currentTeamId: teamId,
        currentTeamName: team.name,
        updatedAt: updatedAt.toISOString(),
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
