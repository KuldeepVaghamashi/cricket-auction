import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Auction, Player, Team } from "@/lib/types";
import {
  normalizePhoneDigits,
  isValidRegisterPhone,
  sanitizePlayerRegisterName,
} from "@/lib/player-register";

/** Update pool player (name, phone, base price) while auction is draft — any source. */
export async function PUT(
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
    const auctionObjectId = new ObjectId(id);
    const playerObjectId = new ObjectId(playerId);

    const auction = await db.collection<Auction>("auctions").findOne({ _id: auctionObjectId });
    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }
    if (auction.status !== "draft") {
      return NextResponse.json(
        { error: "Players can only be edited before the auction starts (draft)." },
        { status: 403 }
      );
    }

    const player = await db.collection<Player>("players").findOne({ _id: playerObjectId });
    if (!player || !player.auctionId.equals(auctionObjectId)) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    if (player.status !== "available") {
      return NextResponse.json(
        { error: "Only players still in the pool (available) can be edited before start." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const name = sanitizePlayerRegisterName(typeof body.name === "string" ? body.name : "");
    if (name.length < 2) {
      return NextResponse.json({ error: "Name must be at least 2 characters." }, { status: 400 });
    }

    const basePrice = Number(body.basePrice);
    if (!Number.isFinite(basePrice) || basePrice < 1) {
      return NextResponse.json({ error: "Base price must be at least 1." }, { status: 400 });
    }

    const phoneRaw = typeof body.phone === "string" ? body.phone : "";
    const clearPhone = phoneRaw.trim() === "";
    const phoneDigits = clearPhone ? "" : normalizePhoneDigits(phoneRaw);

    if (!clearPhone && !isValidRegisterPhone(phoneDigits)) {
      return NextResponse.json(
        { error: "Phone must be left blank or be 10–15 digits." },
        { status: 400 }
      );
    }

    if (!clearPhone) {
      const dup = await db.collection<Player>("players").findOne({
        auctionId: auctionObjectId,
        phone: phoneDigits,
        _id: { $ne: playerObjectId },
      });
      if (dup) {
        return NextResponse.json(
          { error: "Another player in this auction already uses this phone number." },
          { status: 409 }
        );
      }
    }

    try {
      if (clearPhone) {
        await db.collection<Player>("players").updateOne(
          { _id: playerObjectId },
          { $set: { name, basePrice }, $unset: { phone: "" } }
        );
      } else {
        await db.collection<Player>("players").updateOne(
          { _id: playerObjectId },
          { $set: { name, basePrice, phone: phoneDigits } }
        );
      }
    } catch (insertErr: unknown) {
      const code =
        insertErr && typeof insertErr === "object" && "code" in insertErr
          ? (insertErr as { code: number }).code
          : 0;
      if (code === 11000) {
        return NextResponse.json(
          { error: "Another player in this auction already uses this phone number." },
          { status: 409 }
        );
      }
      throw insertErr;
    }

    const updated = await db.collection<Player>("players").findOne({ _id: playerObjectId });
    if (!updated) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    return NextResponse.json({
      ...updated,
      _id: updated._id?.toString(),
      auctionId: updated.auctionId.toString(),
      soldTo: updated.soldTo?.toString(),
    });
  } catch (error) {
    console.error("Update player error:", error);
    return NextResponse.json({ error: "Failed to update player" }, { status: 500 });
  }
}

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
