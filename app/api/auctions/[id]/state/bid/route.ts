import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import { validateBid } from "@/lib/auction-utils";
import type { AuctionState, Team, Auction, AuctionLog } from "@/lib/types";

const bidThrottleMap = new Map<string, number>();
const BID_THROTTLE_MS = 250;

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
      return NextResponse.json(
        { error: "Team ID and amount are required" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);
    if (!ObjectId.isValid(teamId)) {
      return NextResponse.json({ error: "Invalid team ID" }, { status: 400 });
    }
    const teamObjectId = new ObjectId(teamId);
    const bidValue = Number(amount);
    if (!Number.isFinite(bidValue)) {
      return NextResponse.json({ error: "Invalid bid amount" }, { status: 400 });
    }

    // Server-side throttle to avoid burst clicking/floods.
    const throttleKey = `${id}:${teamId}`;
    const nowMs = Date.now();
    const lastMs = bidThrottleMap.get(throttleKey) ?? 0;
    if (nowMs - lastMs < BID_THROTTLE_MS) {
      return NextResponse.json({ error: "Please wait a moment before bidding again" }, { status: 429 });
    }
    bidThrottleMap.set(throttleKey, nowMs);

    const auctionsCol = db.collection<Auction>("auctions");
    const teamsCol = db.collection<Team>("teams");
    const statesCol = db.collection<AuctionState>("auctionStates");
    const logsCol = db.collection<AuctionLog>("auctionLogs");

    // Fetch required documents in parallel with minimal projections.
    const [auction, team, state] = await Promise.all([
      auctionsCol.findOne(
        { _id: auctionId },
        {
          projection: {
            _id: 1,
            status: 1,
            minIncrement: 1,
            minBid: 1,
            maxPlayersPerTeam: 1,
          },
        }
      ),
      teamsCol.findOne(
        { _id: teamObjectId, auctionId },
        {
          projection: {
            _id: 1,
            name: 1,
            remainingBudget: 1,
            playersBought: 1,
          },
        }
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

    // Prevent the currently-leading team from bidding again.
    // This enforces: if a team is leading, it cannot bid while it is itself the leading team.
    if (state.currentTeamId && state.currentTeamId.toString() === teamObjectId.toString()) {
      return NextResponse.json(
        { error: "Leading team cannot place another bid" },
        { status: 400 }
      );
    }

    // Validate bid
    const isFirstBid = state.currentTeamId === null;
    const validation = validateBid(bidValue, team, auction, state.currentBid, { isFirstBid });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Update state with new bid
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

    // Non-blocking logging to keep bid latency low.
    void logsCol.insertOne({
      auctionId,
      action: "bid_placed",
      details: {
        teamId: team._id?.toString(),
        teamName: team.name,
        amount: bidValue,
      },
      timestamp: new Date(),
    }).catch((error) => {
      console.error("Bid log insert failed:", error);
    });

    return NextResponse.json({
      success: true,
      currentBid: bidValue,
      currentTeamId: teamId,
      currentTeamName: team.name,
      updatedAt: updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Bid error:", error);
    return NextResponse.json(
      { error: "Failed to place bid" },
      { status: 500 }
    );
  }
}
