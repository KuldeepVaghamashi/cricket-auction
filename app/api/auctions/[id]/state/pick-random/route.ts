import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { AuctionState, Player, Auction, AuctionLog } from "@/lib/types";

// POST pick random player
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const PLAYER_TIMER_SECONDS = 10;

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

    // If none are available, start the "unsold replay" round:
    // pick from unsold players that haven't been replayed yet.
    let selectedPlayer: Player | null = null;
    let isReplayPick = false;

    if (availablePlayers.length > 0) {
      const randomIndex = Math.floor(Math.random() * availablePlayers.length);
      selectedPlayer = availablePlayers[randomIndex];
    } else {
      const replayCandidates = await db
        .collection<Player>("players")
        .find({
          auctionId,
          status: "unsold",
          // Undefined field should be treated as "not replayed yet".
          unsoldReplayed: { $ne: true },
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
      isReplayPick = true;
    }

    // Update auction state
    const playerUpdate = isReplayPick
      ? { $set: { unsoldReplayed: true } }
      : undefined;

    if (playerUpdate) {
      await db.collection<Player>("players").updateOne(
        { _id: selectedPlayer._id },
        playerUpdate
      );
    }

    await db.collection<AuctionState>("auctionStates").updateOne(
      { auctionId },
      {
        $set: {
          currentPlayerId: selectedPlayer._id,
          currentBid: selectedPlayer.basePrice,
          currentTeamId: null,
          currentTeamName: null,
          bidHistory: [],
          playerTimerEndsAt: Date.now() + PLAYER_TIMER_SECONDS * 1000,
          playerTimerSeconds: PLAYER_TIMER_SECONDS,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // Log action
    await db.collection<AuctionLog>("auctionLogs").insertOne({
      auctionId,
      action: "player_picked",
      details: {
        playerId: selectedPlayer._id?.toString(),
        playerName: selectedPlayer.name,
        basePrice: selectedPlayer.basePrice,
      },
      timestamp: new Date(),
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
