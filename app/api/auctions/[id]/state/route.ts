import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AuctionState, Player } from "@/lib/types";

// GET auction state
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid auction ID" }, { status: 400 });
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);

    let state = await db
      .collection<AuctionState>("auctionStates")
      .findOne({ auctionId });

    // Create state if doesn't exist
    if (!state) {
      const newState: AuctionState = {
        auctionId,
        currentPlayerId: null,
        currentBid: 0,
        currentTeamId: null,
        currentTeamName: null,
        bidHistory: [],
        playerTimerEndsAt: undefined,
        playerTimerSeconds: undefined,
        updatedAt: new Date(),
      };
      await db.collection<AuctionState>("auctionStates").insertOne(newState);
      state = newState;
    }

    // Get current player details if exists
    let currentPlayer = null;
    if (state.currentPlayerId) {
      currentPlayer = await db
        .collection<Player>("players")
        .findOne({ _id: state.currentPlayerId });
    }

    return NextResponse.json({
      ...state,
      _id: state._id?.toString(),
      auctionId: state.auctionId.toString(),
      currentPlayerId: state.currentPlayerId?.toString() || null,
      currentTeamId: state.currentTeamId?.toString() || null,
      bidHistory: state.bidHistory.map((b) => ({
        ...b,
        teamId: b.teamId.toString(),
        timestamp: b.timestamp.toISOString(),
      })),
      currentPlayer: currentPlayer
        ? {
            ...currentPlayer,
            _id: currentPlayer._id?.toString(),
            auctionId: currentPlayer.auctionId.toString(),
          }
        : null,
    });
  } catch (error) {
    console.error("Get state error:", error);
    return NextResponse.json(
      { error: "Failed to fetch auction state" },
      { status: 500 }
    );
  }
}
