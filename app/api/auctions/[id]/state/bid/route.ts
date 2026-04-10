import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import { validateBid } from "@/lib/auction-utils";
import {
  acquireBidLock,
  releaseBidLock,
  getCachedState,
  writeThroughBidState,
  incrSeq,
} from "@/lib/auction-cache";
import { pushAuctionEvent } from "@/lib/socket-hub";
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
    const { teamId, amount, requestId } = body;

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
      const teamsCol    = db.collection<Team>("teams");
      const statesCol   = db.collection<AuctionState>("auctionStates");
      const logsCol     = db.collection<AuctionLog>("auctionLogs");

      // Always read fresh from MongoDB inside the lock.
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

      if (!auction) return NextResponse.json({ error: "Auction not found" }, { status: 404 });
      if (auction.status !== "active") {
        return NextResponse.json({ error: "Auction is not active" }, { status: 400 });
      }
      if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
      if (!state || !state.currentPlayerId) {
        return NextResponse.json(
          { error: "No player is currently up for auction" },
          { status: 400 }
        );
      }
      if (state.currentTeamId?.toString() === teamObjectId.toString()) {
        return NextResponse.json(
          { error: "Leading team cannot place another bid" },
          { status: 400 }
        );
      }

      const isFirstBid = state.currentTeamId === null;
      const validation = validateBid(bidValue, team, auction, state.currentBid, { isFirstBid });
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      // ── Atomic DB write ─────────────────────────────────────────────────────
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
        }
      );

      // ── Sequence number ─────────────────────────────────────────────────────
      const seq = await incrSeq(id);

      // ── Write-through cache ─────────────────────────────────────────────────
      // Fetch the current cached state to merge bid into it (avoids empty window).
      const prevCached = (await getCachedState(id)) ?? {};
      void writeThroughBidState(id, prevCached, {
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

      // ── Non-blocking audit log ──────────────────────────────────────────────
      void logsCol
        .insertOne({
          auctionId,
          action: "bid_placed",
          details: { teamId: team._id?.toString(), teamName: team.name, amount: bidValue },
          timestamp: new Date(),
        })
        .catch((e) => console.error("Bid log insert failed:", e));

      // ── Publish typed event ─────────────────────────────────────────────────
      // BidEvent carries the full delta inline.  Viewers apply it without an
      // extra /viewer-snapshot fetch.  The requestId is echoed so the originating
      // admin tab can suppress the echo (it already applied an optimistic update).
      pushAuctionEvent(id, {
        v: 2,
        type: "bid",
        seq,
        ...(typeof requestId === "string" && requestId ? { requestId } : {}),
        currentBid: bidValue,
        currentTeamId: teamId,
        currentTeamName: team.name,
        bidEntry: {
          teamName: team.name,
          amount: bidValue,
          timestamp: updatedAt.toISOString(),
        },
      });

      return NextResponse.json({
        success: true,
        currentBid: bidValue,
        currentTeamId: teamId,
        currentTeamName: team.name,
        updatedAt: updatedAt.toISOString(),
      });
    } finally {
      void releaseBidLock(id, lockToken);
    }
  } catch (error) {
    console.error("Bid error:", error);
    return NextResponse.json({ error: "Failed to place bid" }, { status: 500 });
  }
}
