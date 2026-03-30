import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Auction } from "@/lib/types";

// GET single auction
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
    const auction = await db
      .collection<Auction>("auctions")
      .findOne({ _id: new ObjectId(id) });

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...auction,
      _id: auction._id?.toString(),
    });
  } catch (error) {
    console.error("Get auction error:", error);
    return NextResponse.json(
      { error: "Failed to fetch auction" },
      { status: 500 }
    );
  }
}

// PUT update auction
export async function PUT(
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
    const db = await getDb();

    const updateData: Partial<Auction> = {
      updatedAt: new Date(),
    };

    if (body.name) updateData.name = body.name;
    if (body.date) updateData.date = new Date(body.date);
    if (body.budget) updateData.budget = Number(body.budget);
    if (body.minIncrement) updateData.minIncrement = Number(body.minIncrement);
    if (body.minBid) updateData.minBid = Number(body.minBid);
    if (body.maxPlayersPerTeam) updateData.maxPlayersPerTeam = Number(body.maxPlayersPerTeam);
    if (body.status) updateData.status = body.status;

    const result = await db
      .collection<Auction>("auctions")
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateData },
        { returnDocument: "after" }
      );

    if (!result) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...result,
      _id: result._id?.toString(),
    });
  } catch (error) {
    console.error("Update auction error:", error);
    return NextResponse.json(
      { error: "Failed to update auction" },
      { status: 500 }
    );
  }
}

// DELETE auction
export async function DELETE(
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

    // Delete related data
    await Promise.all([
      db.collection("teams").deleteMany({ auctionId }),
      db.collection("players").deleteMany({ auctionId }),
      db.collection("auctionStates").deleteMany({ auctionId }),
      db.collection("auctionLogs").deleteMany({ auctionId }),
    ]);

    // Delete auction
    const result = await db
      .collection<Auction>("auctions")
      .deleteOne({ _id: auctionId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete auction error:", error);
    return NextResponse.json(
      { error: "Failed to delete auction" },
      { status: 500 }
    );
  }
}
