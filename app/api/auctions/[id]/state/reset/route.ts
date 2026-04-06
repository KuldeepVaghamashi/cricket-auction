import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { AuctionState, Player, AuctionLog } from "@/lib/types";
import { notifyAuctionSubscribers } from "@/lib/notify-auction-subscribers";

// POST reset current bid
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

    const db = await getDb();
    const auctionId = new ObjectId(id);

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

    // Get current player for base price
    const player = await db
      .collection<Player>("players")
      .findOne({ _id: state.currentPlayerId });

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    // Reset to base price
    await db.collection<AuctionState>("auctionStates").updateOne(
      { auctionId },
      {
        $set: {
          currentBid: player.basePrice,
          currentTeamId: null,
          currentTeamName: null,
          bidHistory: [],
          updatedAt: new Date(),
        },
      }
    );

    // Log action
    await db.collection<AuctionLog>("auctionLogs").insertOne({
      auctionId,
      action: "bid_reset",
      details: {
        playerId: player._id?.toString(),
        playerName: player.name,
        resetTo: player.basePrice,
      },
      timestamp: new Date(),
    });

    // Reset affects only auction state (current bid resets) and logs.
    notifyAuctionSubscribers(id, ["st", "lg"]);

    return NextResponse.json({
      success: true,
      currentBid: player.basePrice,
    });
  } catch (error) {
    console.error("Reset error:", error);
    return NextResponse.json(
      { error: "Failed to reset bid" },
      { status: 500 }
    );
  }
}
