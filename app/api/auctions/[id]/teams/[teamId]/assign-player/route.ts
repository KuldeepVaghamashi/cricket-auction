import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Auction, AuctionLog, Player, Team } from "@/lib/types";

// POST assign an existing player from pool to a team (draft-only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, teamId } = await params;
    if (!ObjectId.isValid(id) || !ObjectId.isValid(teamId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const playerId = body?.playerId;
    if (!playerId || typeof playerId !== "string" || !ObjectId.isValid(playerId)) {
      return NextResponse.json({ error: "Valid playerId is required" }, { status: 400 });
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);
    const teamObjectId = new ObjectId(teamId);
    const playerObjectId = new ObjectId(playerId);

    const auction = await db
      .collection<Auction>("auctions")
      .findOne({ _id: auctionId }, { projection: { status: 1, maxPlayersPerTeam: 1 } });

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    // Only allowed before auction starts
    if (auction.status !== "draft") {
      return NextResponse.json(
        { error: "Player assignment is allowed only before auction starts" },
        { status: 400 }
      );
    }

    const [team, player] = await Promise.all([
      db
        .collection<Team>("teams")
        .findOne(
          { _id: teamObjectId, auctionId },
          { projection: { name: 1, remainingBudget: 1, playersBought: 1 } }
        ),
      db
        .collection<Player>("players")
        .findOne(
          { _id: playerObjectId, auctionId },
          { projection: { name: 1, basePrice: 1, status: 1 } }
        ),
    ]);

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    if (player.status !== "available") {
      return NextResponse.json({ error: "Player is not available in pool" }, { status: 400 });
    }

    const playersCount = team.playersBought.length;
    if (playersCount >= auction.maxPlayersPerTeam) {
      return NextResponse.json(
        { error: "Team has reached maximum players limit" },
        { status: 400 }
      );
    }

    if (team.remainingBudget < player.basePrice) {
      return NextResponse.json(
        { error: "Team does not have enough remaining budget" },
        { status: 400 }
      );
    }

    // Apply updates (team + player). Best-effort consistency without paid infra.
    await db.collection<Team>("teams").updateOne(
      { _id: teamObjectId },
      {
        $inc: { remainingBudget: -player.basePrice },
        $addToSet: { playersBought: playerObjectId },
      }
    );

    await db.collection<Player>("players").updateOne(
      { _id: playerObjectId },
      {
        $set: {
          status: "sold",
          soldTo: teamObjectId,
          soldPrice: player.basePrice,
        },
      }
    );

    // Log action (best-effort)
    void db.collection<AuctionLog>("auctionLogs").insertOne({
      auctionId,
      action: "player_assigned",
      details: {
        teamId: teamId,
        teamName: team.name,
        playerId,
        playerName: player.name,
        price: player.basePrice,
      },
      timestamp: new Date(),
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Assign player error:", error);
    return NextResponse.json({ error: "Failed to assign player" }, { status: 500 });
  }
}

