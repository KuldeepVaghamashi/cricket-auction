import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { AuctionState, Player, Team, Auction, AuctionLog } from "@/lib/types";
import { notifyAuctionSubscribers } from "@/lib/notify-auction-subscribers";
import { invalidateCachedState } from "@/lib/auction-cache";

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

    // Fetch auction + state in parallel — two independent reads, no reason to serialize.
    const [auction, state] = await Promise.all([
      db.collection<Auction>("auctions").findOne(
        { _id: auctionId },
        { projection: { _id: 1, status: 1, maxPlayersPerTeam: 1 } }
      ),
      db.collection<AuctionState>("auctionStates").findOne({ auctionId }),
    ]);

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    if (auction.status !== "active") {
      return NextResponse.json(
        { error: "Auction is not active" },
        { status: 400 }
      );
    }

    if (!state || !state.currentPlayerId) {
      return NextResponse.json(
        { error: "No player is currently up for auction" },
        { status: 400 }
      );
    }

    const playerId = state.currentPlayerId;

    // Get current player (depends on state.currentPlayerId from above, so sequential is correct).
    const player = await db
      .collection<Player>("players")
      .findOne({ _id: playerId });

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    // Allow completion for both first-time and replayed players.
    const isEligibleForCompletion =
      player.status === "available" ||
      player.status === "unsold";

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

      // Non-blocking log — same pattern as bid route; keeps response latency low.
      void db.collection<AuctionLog>("auctionLogs").insertOne({
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
      }).catch((e) => console.error("sold log insert failed:", e));
    } else {
      // Mark as unsold
      await db.collection<Player>("players").updateOne(
        { _id: playerId },
        {
          $set: { status: "unsold" },
          $unset: { soldTo: "", soldPrice: "" },
        }
      );

      void db.collection<AuctionLog>("auctionLogs").insertOne({
        auctionId,
        action: "player_unsold",
        details: {
          playerId: playerId.toString(),
          playerName: player.name,
        },
        timestamp: new Date(),
      }).catch((e) => console.error("unsold log insert failed:", e));
    }

    // Reset auction state — clear bidHistory and bidCounts for the completed round.
    const completionAt = new Date();
    await db.collection<AuctionState>("auctionStates").updateOne(
      { auctionId },
      {
        $set: {
          currentPlayerId: null,
          currentBid: 0,
          currentTeamId: null,
          currentTeamName: null,
          bidHistory: [],
          bidCounts: {},
          updatedAt: completionAt,
          lastAction: action,
          lastActionAt: completionAt,
          lastActionPlayerName: player.name,
          lastActionTeamName: action === "sold" ? state.currentTeamName : null,
          lastActionPrice: action === "sold" ? state.currentBid : null,
        },
      }
    );

    // Delete the Redis cache BEFORE notifying subscribers so that any
    // revalidation triggered by the socket event reads fresh from MongoDB.
    // writeThroughPatch is async — firing it void and then notifying immediately
    // meant the admin could receive and render stale cached state.
    await invalidateCachedState(id);

    // Completion updates:
    // - sold: auction state + team purses + player statuses + logs
    // - unsold: auction state + player statuses + logs (teams do not change)
    const scopes =
      action === "sold" ? (["st", "tm", "pl", "lg"] as const) : (["st", "pl", "lg"] as const);
    notifyAuctionSubscribers(id, scopes as any);

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
