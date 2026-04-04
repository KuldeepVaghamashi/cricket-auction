import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Auction, Player } from "@/lib/types";
import {
  normalizePhoneDigits,
  isValidRegisterPhone,
  sanitizePlayerRegisterName,
} from "@/lib/player-register";

/**
 * Public endpoint: players add themselves to the pool before the auction starts.
 * Only allowed while auction status is `draft`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid auction" }, { status: 400 });
    }

    const body = await request.json();
    const nameRaw = typeof body.name === "string" ? body.name : "";
    const phoneRaw = typeof body.phone === "string" ? body.phone : "";

    const name = sanitizePlayerRegisterName(nameRaw);
    const phoneDigits = normalizePhoneDigits(phoneRaw);

    if (name.length < 2) {
      return NextResponse.json(
        { error: "Please enter your full name (at least 2 characters)." },
        { status: 400 }
      );
    }

    if (!isValidRegisterPhone(phoneDigits)) {
      return NextResponse.json(
        { error: "Please enter a valid phone number (at least 10 digits)." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);

    const auction = await db.collection<Auction>("auctions").findOne({ _id: auctionId });

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    if (auction.status !== "draft") {
      return NextResponse.json(
        { error: "Registration is closed — this auction has already started or finished." },
        { status: 403 }
      );
    }

    const dup = await db.collection<Player>("players").findOne({
      auctionId,
      phone: phoneDigits,
    });

    if (dup) {
      return NextResponse.json(
        { error: "This phone number is already registered for this auction." },
        { status: 409 }
      );
    }

    const player: Player = {
      auctionId,
      name,
      basePrice: auction.minBid,
      status: "available",
      phone: phoneDigits,
      selfRegistered: true,
      createdAt: new Date(),
    };

    try {
      const result = await db.collection<Player>("players").insertOne(player);
      return NextResponse.json({
        ok: true,
        message: "You are registered for this auction.",
        playerId: result.insertedId.toString(),
      });
    } catch (insertErr: unknown) {
      const code = insertErr && typeof insertErr === "object" && "code" in insertErr ? (insertErr as { code: number }).code : 0;
      if (code === 11000) {
        return NextResponse.json(
          { error: "This phone number is already registered for this auction." },
          { status: 409 }
        );
      }
      throw insertErr;
    }
  } catch (error) {
    console.error("Player self-register error:", error);
    return NextResponse.json({ error: "Registration failed. Try again later." }, { status: 500 });
  }
}
