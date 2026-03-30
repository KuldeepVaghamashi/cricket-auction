import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Player, Team } from "@/lib/types";

// DELETE player
export async function DELETE(
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
    const playerObjectId = new ObjectId(playerId);

    // Get player to check if sold
    const player = await db
      .collection<Player>("players")
      .findOne({ _id: playerObjectId });

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    // If player was sold, refund the team
    if (player.soldTo && player.soldPrice) {
      await db.collection<Team>("teams").updateOne(
        { _id: player.soldTo },
        {
          $inc: { remainingBudget: player.soldPrice },
          $pull: { playersBought: playerObjectId },
        }
      );
    }

    // Delete player
    await db.collection<Player>("players").deleteOne({ _id: playerObjectId });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete player error:", error);
    return NextResponse.json(
      { error: "Failed to delete player" },
      { status: 500 }
    );
  }
}
