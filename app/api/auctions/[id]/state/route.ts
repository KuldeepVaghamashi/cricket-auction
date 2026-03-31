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
    const lite = request.nextUrl.searchParams.get("lite") === "1";
    
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
        updatedAt: new Date(),
      };
      await db.collection<AuctionState>("auctionStates").insertOne(newState);
      state = newState;
    }

    // Get current player details if exists (project only required fields).
    let currentPlayer = null;
    if (state.currentPlayerId) {
      currentPlayer = await db
        .collection<Player>("players")
        .findOne(
          { _id: state.currentPlayerId },
          {
            projection: {
              _id: 1,
              auctionId: 1,
              name: 1,
              basePrice: 1,
            },
          }
        );
    }

    if (lite) {
      return NextResponse.json({
        _id: state._id?.toString(),
        auctionId: state.auctionId.toString(),
        currentPlayerId: state.currentPlayerId?.toString() || null,
        currentBid: state.currentBid,
        currentTeamId: state.currentTeamId?.toString() || null,
        currentTeamName: state.currentTeamName,
        // Keep only latest 10 bid updates for fast payloads.
        bidHistory: state.bidHistory.slice(-10).map((b) => ({
          teamId: b.teamId.toString(),
          teamName: b.teamName,
          amount: b.amount,
          timestamp: b.timestamp.toISOString(),
        })),
        updatedAt: state.updatedAt.toISOString(),
        currentPlayer: currentPlayer
          ? {
              _id: currentPlayer._id?.toString(),
              auctionId: currentPlayer.auctionId.toString(),
              name: currentPlayer.name,
              basePrice: currentPlayer.basePrice,
            }
          : null,
      });
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
