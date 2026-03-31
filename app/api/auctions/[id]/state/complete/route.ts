import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { AuctionState, Player, Team, Auction, AuctionLog } from "@/lib/types";

// POST mark player as sold or unsold
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
    const { action } = body; // "sold" or "unsold"

    if (!action || !["sold", "unsold"].includes(action)) {
      return NextResponse.json(
        { error: "Action must be 'sold' or 'unsold'" },
        { status: 400 }
      );
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

    const playerId = state.currentPlayerId;

    // Get current player
    const player = await db
      .collection<Player>("players")
      .findOne({ _id: playerId });

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    // Allow completion for:
    // - initial under-the-hammer players: status === "available"
    // - unsold replay round players: status === "unsold" and unsoldReplayed === true
    const isEligibleForCompletion =
      player.status === "available" ||
      (player.status === "unsold" && player.unsoldReplayed === true);

    if (!isEligibleForCompletion) {
      return NextResponse.json(
        { error: `Player is already ${player.status}` },
        { status: 400 }
      );
    }

    if (action === "sold") {
      if (!state.currentTeamId) {
        return NextResponse.json(
          { error: "No team has placed a bid" },
          { status: 400 }
        );
      }

      // Update player as sold
      await db.collection<Player>("players").updateOne(
        { _id: playerId },
        {
          $set: {
            status: "sold",
            soldTo: state.currentTeamId,
            soldPrice: state.currentBid,
          },
          $unset: {
            // Once sold, it should no longer be eligible for "unsold replay".
            unsoldReplayed: "",
          },
        }
      );

      // Update team budget and players
      await db.collection<Team>("teams").updateOne(
        { _id: state.currentTeamId },
        {
          $inc: { remainingBudget: -state.currentBid },
          // Idempotency: avoid duplicate entries if the same operation is retried.
          $addToSet: { playersBought: playerId },
        }
      );

      // Log action
      await db.collection<AuctionLog>("auctionLogs").insertOne({
        auctionId,
        action: "player_sold",
        details: {
          playerId: playerId.toString(),
          playerName: player.name,
          teamId: state.currentTeamId.toString(),
          teamName: state.currentTeamName,
          price: state.currentBid,
        },
        timestamp: new Date(),
      });
    } else {
      // Mark as unsold
      await db.collection<Player>("players").updateOne(
        { _id: playerId },
        {
          $set: { status: "unsold" },
          $unset: { soldTo: "", soldPrice: "" },
        }
      );

      // Log action
      await db.collection<AuctionLog>("auctionLogs").insertOne({
        auctionId,
        action: "player_unsold",
        details: {
          playerId: playerId.toString(),
          playerName: player.name,
        },
        timestamp: new Date(),
      });
    }

    // Reset auction state
    await db.collection<AuctionState>("auctionStates").updateOne(
      { auctionId },
      {
        $set: {
          currentPlayerId: null,
          currentBid: 0,
          currentTeamId: null,
          currentTeamName: null,
          bidHistory: [],
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      success: true,
      action,
      playerName: player.name,
      soldTo: action === "sold" ? state.currentTeamName : null,
      soldPrice: action === "sold" ? state.currentBid : null,
    });
  } catch (error) {
    console.error("Complete error:", error);
    return NextResponse.json(
      { error: "Failed to complete player auction" },
      { status: 500 }
    );
  }
}
