import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Player, Team, Auction, AuctionLog } from "@/lib/types";
import { notifyAuctionSubscribers } from "@/lib/notify-auction-subscribers";
import { invalidateCachedTeam } from "@/lib/auction-cache";

/**
 * POST /api/auctions/[id]/players/[playerId]/revert
 *
 * Reverts a sold or unsold player back to "available" status.
 * If the player was sold the team's budget is refunded and the player
 * is removed from their roster, exactly mirroring the inverse of
 * the complete route's "sold" path.
 *
 * This route is only available while the auction is active so it
 * cannot be used to corrupt a completed auction's final results.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, playerId } = await params;

    if (!ObjectId.isValid(id) || !ObjectId.isValid(playerId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);
    const playerObjectId = new ObjectId(playerId);

    const auction = await db
      .collection<Auction>("auctions")
      .findOne({ _id: auctionId }, { projection: { _id: 1, status: 1 } });

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }
    if (auction.status !== "active") {
      return NextResponse.json({ error: "Auction is not active" }, { status: 400 });
    }

    const player = await db
      .collection<Player>("players")
      .findOne({ _id: playerObjectId, auctionId });

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    if (player.status === "available") {
      return NextResponse.json({ error: "Player is already available" }, { status: 400 });
    }
    if (player.status !== "sold" && player.status !== "unsold") {
      return NextResponse.json(
        { error: "Only sold or unsold players can be reverted" },
        { status: 400 }
      );
    }

    const wasSold = player.status === "sold";

    // Refund the team that bought the player.
    if (wasSold && player.soldTo && player.soldPrice !== undefined) {
      await db.collection<Team>("teams").updateOne(
        { _id: player.soldTo },
        {
          $inc: { remainingBudget: player.soldPrice },
          $pull: { playersBought: playerObjectId } as any,
        }
      );
      // Drop the cached team doc so the next bid reads fresh budget from MongoDB.
      void invalidateCachedTeam(id, player.soldTo.toString());
    }

    // Restore the player to the available pool.
    await db.collection<Player>("players").updateOne(
      { _id: playerObjectId },
      {
        $set: { status: "available" },
        $unset: { soldTo: "", soldPrice: "", unsoldReplayed: "" },
      }
    );

    // Audit log — best-effort, never block the response.
    void db
      .collection<AuctionLog>("auctionLogs")
      .insertOne({
        auctionId,
        action: "player_reverted",
        details: {
          playerId,
          playerName: player.name,
          previousStatus: player.status,
          ...(wasSold && {
            refundedTeamId: player.soldTo?.toString(),
            refundedPrice: player.soldPrice,
          }),
        },
        timestamp: new Date(),
      })
      .catch((e) => console.error("Revert log insert failed:", e));

    // Notify all connected clients.
    // "tm" scope required when a sold player is reverted (team budget changed).
    const scopes = wasSold
      ? (["tm", "pl", "lg"] as const)
      : (["pl", "lg"] as const);
    notifyAuctionSubscribers(id, scopes as any);

    return NextResponse.json({
      success: true,
      playerId,
      playerName: player.name,
      previousStatus: player.status,
    });
  } catch (error) {
    console.error("Revert player error:", error);
    return NextResponse.json({ error: "Failed to revert player" }, { status: 500 });
  }
}
