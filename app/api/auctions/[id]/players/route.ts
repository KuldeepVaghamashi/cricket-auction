import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Player, Auction } from "@/lib/types";
import { notifyAuctionSubscribers } from "@/lib/notify-auction-subscribers";

// GET all players for an auction
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid auction ID" }, { status: 400 });
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);

    const players = await db
      .collection<Player>("players")
      .find({ auctionId })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(
      players.map((p) => ({
        ...p,
        _id: p._id?.toString(),
        auctionId: p.auctionId.toString(),
        soldTo: p.soldTo?.toString(),
      }))
    );
  } catch (error) {
    console.error("Get players error:", error);
    return NextResponse.json(
      { error: "Failed to fetch players" },
      { status: 500 }
    );
  }
}

// POST create new player
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
    const { name, basePrice } = body;

    if (!name) {
      return NextResponse.json({ error: "Player name is required" }, { status: 400 });
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);

    // Get auction for default base price
    const auction = await db
      .collection<Auction>("auctions")
      .findOne({ _id: auctionId });

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    const price = basePrice ? Number(basePrice) : auction.minBid;

    const player: Player = {
      auctionId,
      name,
      basePrice: price,
      status: "available",
      createdAt: new Date(),
    };

    const result = await db.collection<Player>("players").insertOne(player);

    // Notify live clients so the new player appears in the pool immediately.
    if (auction.status === "active") {
      notifyAuctionSubscribers(id, ["pl"]);
    }

    return NextResponse.json({
      ...player,
      _id: result.insertedId.toString(),
      auctionId: player.auctionId.toString(),
    });
  } catch (error) {
    console.error("Create player error:", error);
    return NextResponse.json(
      { error: "Failed to create player" },
      { status: 500 }
    );
  }
}
