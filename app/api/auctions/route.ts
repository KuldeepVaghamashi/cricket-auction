import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Auction, AuctionState } from "@/lib/types";

// GET all auctions
export async function GET() {
  try {
    const db = await getDb();
    const auctions = await db
      .collection<Auction>("auctions")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(
      auctions.map((a) => ({
        ...a,
        _id: a._id?.toString(),
      }))
    );
  } catch (error) {
    console.error("Get auctions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch auctions" },
      { status: 500 }
    );
  }
}

// POST create new auction
export async function POST(request: NextRequest) {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, date, budget, minIncrement, minBid, maxPlayersPerTeam } = body;

    if (!name || !date || !budget || !minIncrement || !minBid || !maxPlayersPerTeam) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Parse datetime-local string properly as local time
    // datetime-local format: "YYYY-MM-DDTHH:mm"
    // We need to create a Date that represents the local time correctly
    let parsedDate: Date;
    if (typeof date === "string" && date.includes("T")) {
      // Parse the datetime-local string
      const [datePart, timePart] = date.split("T");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hours, minutes] = timePart.split(":").map(Number);
      parsedDate = new Date(year, month - 1, day, hours, minutes, 0);
    } else {
      parsedDate = new Date(date);
    }

    const auction: Auction = {
      name,
      date: parsedDate,
      budget: Number(budget),
      minIncrement: Number(minIncrement),
      minBid: Number(minBid),
      maxPlayersPerTeam: Number(maxPlayersPerTeam),
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection<Auction>("auctions").insertOne(auction);

    // Create auction state
    const auctionState: AuctionState = {
      auctionId: result.insertedId,
      currentPlayerId: null,
      currentBid: 0,
      currentTeamId: null,
      currentTeamName: null,
      bidHistory: [],
      updatedAt: new Date(),
    };

    await db.collection<AuctionState>("auctionStates").insertOne(auctionState);

    return NextResponse.json({
      ...auction,
      _id: result.insertedId.toString(),
    });
  } catch (error) {
    console.error("Create auction error:", error);
    return NextResponse.json(
      { error: "Failed to create auction" },
      { status: 500 }
    );
  }
}
