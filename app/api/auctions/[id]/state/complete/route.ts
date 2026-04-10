import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { AuctionState, Player, Team, Auction, AuctionLog } from "@/lib/types";
import { pushAuctionEvent } from "@/lib/socket-hub";
import { invalidateCachedState, incrSeq } from "@/lib/auction-cache";

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
      return NextResponse.json({ error: "Auction is not active" }, { status: 400 });
    }
    if (!state || !state.currentPlayerId) {
      return NextResponse.json(
        { error: "No player is currently up for auction" },
        { status: 400 }
      );
    }

    const playerId = state.currentPlayerId;

    const player = await db.collection<Player>("players").findOne({ _id: playerId });

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const isEligible = player.status === "available" || player.status === "unsold";
    if (!isEligible) {
      return NextResponse.json(
        { error: `Player is already ${player.status}` },
        { status: 400 }
      );
    }

    const playersCol = db.collection<Player>("players");
    const teamsCol   = db.collection<Team>("teams");
    const logsCol    = db.collection<AuctionLog>("auctionLogs");

    let newTeamRemainingBudget = 0;

    if (action === "sold") {
      if (!state.currentTeamId) {
        return NextResponse.json(
          { error: "No team has placed a bid" },
          { status: 400 }
        );
      }

      await playersCol.updateOne(
        { _id: playerId },
        {
          $set: { status: "sold", soldTo: state.currentTeamId, soldPrice: state.currentBid },
          $unset: { unsoldReplayed: "" },
        }
      );

      // Use findOneAndUpdate to get the updated budget in one round-trip.
      const updatedTeam = await teamsCol.findOneAndUpdate(
        { _id: state.currentTeamId },
        {
          $inc: { remainingBudget: -state.currentBid },
          $addToSet: { playersBought: playerId },
        },
        { returnDocument: "after", projection: { remainingBudget: 1 } }
      );
      newTeamRemainingBudget = updatedTeam?.remainingBudget ?? 0;

      void logsCol.insertOne({
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
      await playersCol.updateOne(
        { _id: playerId },
        { $set: { status: "unsold" }, $unset: { soldTo: "", soldPrice: "" } }
      );

      void logsCol.insertOne({
        auctionId,
        action: "player_unsold",
        details: { playerId: playerId.toString(), playerName: player.name },
        timestamp: new Date(),
      }).catch((e) => console.error("unsold log insert failed:", e));
    }

    // Reset auction state
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
          updatedAt: completionAt,
          lastAction: action,
          lastActionAt: completionAt,
          lastActionPlayerName: player.name,
          lastActionTeamName: action === "sold" ? state.currentTeamName : null,
          lastActionPrice: action === "sold" ? state.currentBid : null,
        },
      }
    );

    // Invalidate all caches (sell/unsold affect teams, player stats, state).
    void invalidateCachedState(id);

    // Compute accurate player stats after the update.
    const [available, sold, unsold] = await Promise.all([
      playersCol.countDocuments({ auctionId, status: "available" }),
      playersCol.countDocuments({ auctionId, status: "sold" }),
      playersCol.countDocuments({ auctionId, status: "unsold" }),
    ]);

    const seq = await incrSeq(id);
    const playerStats = { available, sold, unsold };

    // Publish typed event with inline delta so viewers update teams/stats
    // without fetching a new snapshot.
    if (action === "sold") {
      pushAuctionEvent(id, {
        v: 2,
        type: "sell",
        seq,
        playerId: playerId.toString(),
        teamId: state.currentTeamId!.toString(),
        soldPrice: state.currentBid,
        newTeamRemainingBudget,
        playerStats,
      });
    } else {
      pushAuctionEvent(id, {
        v: 2,
        type: "unsold",
        seq,
        playerId: playerId.toString(),
        playerStats,
      });
    }

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
