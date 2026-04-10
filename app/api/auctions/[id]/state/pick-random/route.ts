import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { AuctionState, Player, Auction, AuctionLog } from "@/lib/types";
import { notifyAuctionSubscribers } from "@/lib/notify-auction-subscribers";
import { writeThroughPick } from "@/lib/auction-cache";

// POST pick random player
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

    // Get available players first.
    const availablePlayers = await db
      .collection<Player>("players")
      .find({ auctionId, status: "available" })
      .toArray();

    // If none are available, keep replaying from the unsold pool
    // until each player eventually gets sold.
    let selectedPlayer: Player | null = null;

    if (availablePlayers.length > 0) {
      const randomIndex = Math.floor(Math.random() * availablePlayers.length);
      selectedPlayer = availablePlayers[randomIndex];
    } else {
      const replayCandidates = await db
        .collection<Player>("players")
        .find({
          auctionId,
          status: "unsold",
        })
        .toArray();

      if (replayCandidates.length === 0) {
        return NextResponse.json(
          { error: "No players left to pick" },
          { status: 400 }
        );
      }

      const randomIndex = Math.floor(Math.random() * replayCandidates.length);
      selectedPlayer = replayCandidates[randomIndex];
    }

    const pickedAt = new Date();
    await db.collection<AuctionState>("auctionStates").updateOne(
      { auctionId },
      {
        $set: {
          currentPlayerId: selectedPlayer._id,
          currentBid: selectedPlayer.basePrice,
          currentTeamId: null,
          currentTeamName: null,
          bidHistory: [],
          updatedAt: pickedAt,
        },
      },
      { upsert: true }
    );

    // Write-through: new clients see the picked player from Redis instantly.
    void writeThroughPick(
      id,
      {
        _id: selectedPlayer._id!.toString(),
        auctionId: selectedPlayer.auctionId.toString(),
        name: selectedPlayer.name,
        basePrice: selectedPlayer.basePrice,
      },
      pickedAt.toISOString()
    );

    // Non-blocking log — does not need to complete before broadcasting the pick.
    void db.collection<AuctionLog>("auctionLogs").insertOne({
      auctionId,
      action: "player_picked",
      details: {
        playerId: selectedPlayer._id?.toString(),
        playerName: selectedPlayer.name,
        basePrice: selectedPlayer.basePrice,
      },
      timestamp: new Date(),
    }).catch((e) => console.error("pick log insert failed:", e));

    // Broadcast with inline delta so viewer clients instantly show the new player
    // without an extra /viewer-snapshot fetch.
    notifyAuctionSubscribers(id, ["st", "lg"], {
      newRound: true,
      currentPlayer: {
        _id: selectedPlayer._id!.toString(),
        name: selectedPlayer.name,
        basePrice: selectedPlayer.basePrice,
      },
      currentBid: selectedPlayer.basePrice,
      currentTeamId: null,
      currentTeamName: null,
    });

    return NextResponse.json({
      success: true,
      player: {
        ...selectedPlayer,
        _id: selectedPlayer._id?.toString(),
        auctionId: selectedPlayer.auctionId.toString(),
      },
    });
  } catch (error) {
    console.error("Pick random error:", error);
    return NextResponse.json(
      { error: "Failed to pick random player" },
      { status: 500 }
    );
  }
}
