import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { AuctionState, Player, AuctionLog } from "@/lib/types";

// POST undo latest bid (only the most recent bidHistory entry)
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

    const state = await db
      .collection<AuctionState>("auctionStates")
      .findOne({ auctionId }, { projection: { currentPlayerId: 1, bidHistory: 1 } });

    if (!state || !state.currentPlayerId) {
      return NextResponse.json(
        { error: "No player is currently up for auction" },
        { status: 400 }
      );
    }

    const bidHistory = Array.isArray(state.bidHistory) ? state.bidHistory : [];
    if (bidHistory.length === 0) {
      return NextResponse.json({ error: "No bids to undo" }, { status: 400 });
    }

    const player = await db
      .collection<Player>("players")
      .findOne(
        { _id: state.currentPlayerId },
        { projection: { _id: 1, name: 1, basePrice: 1 } }
      );

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const nextHistory = bidHistory.slice(0, -1);
    const last = nextHistory.length > 0 ? nextHistory[nextHistory.length - 1] : null;

    const updatedAt = new Date();
    await db.collection<AuctionState>("auctionStates").updateOne(
      { auctionId },
      {
        $set: {
          currentBid: last ? last.amount : player.basePrice,
          currentTeamId: last ? last.teamId : null,
          currentTeamName: last ? last.teamName : null,
          bidHistory: nextHistory,
          updatedAt,
        },
      }
    );

    // Log action (best-effort)
    void db.collection<AuctionLog>("auctionLogs").insertOne({
      auctionId,
      action: "bid_undone",
      details: {
        playerId: player._id?.toString(),
        playerName: player.name,
        undoneBidAmount: bidHistory[bidHistory.length - 1]?.amount ?? null,
      },
      timestamp: new Date(),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      currentBid: last ? last.amount : player.basePrice,
      currentTeamId: last ? last.teamId?.toString() ?? null : null,
      currentTeamName: last ? last.teamName : null,
    });
  } catch (error) {
    console.error("Undo bid error:", error);
    return NextResponse.json({ error: "Failed to undo bid" }, { status: 500 });
  }
}

