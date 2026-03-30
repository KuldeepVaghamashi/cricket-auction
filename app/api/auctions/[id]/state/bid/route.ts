import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import { validateBid } from "@/lib/auction-utils";
import type { AuctionState, Team, Auction, AuctionLog } from "@/lib/types";

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
    const teamObjectId = new ObjectId(teamId);

    // Get auction
    const auction = await db
      .collection<Auction>("auctions")
      .findOne({ _id: auctionId });

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    if (auction.status !== "active") {
      return NextResponse.json(
        { error: "Auction is not active" },
        { status: 400 }
      );
    }

    // Get team
    const team = await db
      .collection<Team>("teams")
      .findOne({ _id: teamObjectId });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Get current state
    const state = await db
      .collection<AuctionState>("auctionStates")
      .findOne({ auctionId });

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
    const validation = validateBid(amount, team, auction, state.currentBid, { isFirstBid });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Update state with new bid
    const bidEntry = {
      teamId: teamObjectId,
      teamName: team.name,
      amount: Number(amount),
      timestamp: new Date(),
    };

    await db.collection<AuctionState>("auctionStates").updateOne(
      { auctionId },
      {
        $set: {
          currentBid: Number(amount),
          currentTeamId: teamObjectId,
          currentTeamName: team.name,
          updatedAt: new Date(),
        },
        $push: { bidHistory: bidEntry },
      }
    );

    // Log action
    await db.collection<AuctionLog>("auctionLogs").insertOne({
      auctionId,
      action: "bid_placed",
      details: {
        teamId: team._id?.toString(),
        teamName: team.name,
        amount: Number(amount),
      },
      timestamp: new Date(),
    });

    return NextResponse.json({
      success: true,
      currentBid: Number(amount),
      currentTeamId: teamId,
      currentTeamName: team.name,
    });
  } catch (error) {
    console.error("Bid error:", error);
    return NextResponse.json(
      { error: "Failed to place bid" },
      { status: 500 }
    );
  }
}
