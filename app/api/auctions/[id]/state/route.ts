import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCachedState, setCachedState } from "@/lib/auction-cache";
import type { AuctionState, Player } from "@/lib/types";

// GET auction state
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const lite = request.nextUrl.searchParams.get("lite") === "1";
    
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid auction ID" }, { status: 400 });
    }

    // ── Redis cache for the lite path ──────────────────────────────────────
    // The admin live page polls ?lite=1 every 12 s when WebSocket is down.
    // Serving from cache eliminates the MongoDB round-trip on most polls.
    // Cache is invalidated by bid/route.ts after every successful write.
    if (lite) {
      const cached = await getCachedState(id);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);

    // Limit bidHistory to last 20 entries in both lite and full modes.
    // The full array can grow indefinitely; clients never need the full history.
    let state = await db
      .collection<AuctionState>("auctionStates")
      .findOne(
        { auctionId },
        { projection: { bidHistory: { $slice: -20 } } } as any
      );

    // Create state if doesn't exist
    if (!state) {
      const newState: AuctionState = {
        auctionId,
        currentPlayerId: null,
        currentBid: 0,
        currentTeamId: null,
        currentTeamName: null,
        bidHistory: [],
        updatedAt: new Date(),
      };
      const inserted = await db.collection<AuctionState>("auctionStates").insertOne(newState);
      state = { ...newState, _id: inserted.insertedId };
    }

    // Get current player details if exists (project only required fields).
    let currentPlayer = null;
    if (state.currentPlayerId) {
      currentPlayer = await db
        .collection<Player>("players")
        .findOne(
          { _id: state.currentPlayerId },
          {
            projection: {
              _id: 1,
              auctionId: 1,
              name: 1,
              basePrice: 1,
            },
          }
        );
    }

    if (lite) {
      // Derive bidCounts from bidHistory as backward-compat fallback for
      // documents written before bidCounts was introduced.
      const bidCounts: Record<string, number> = state.bidCounts
        ? (state.bidCounts as unknown as Record<string, number>)
        : state.bidHistory.reduce<Record<string, number>>((acc, b) => {
            const key = b.teamId.toString();
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {});

      const litePayload = {
        _id: state._id?.toString(),
        auctionId: state.auctionId.toString(),
        currentPlayerId: state.currentPlayerId?.toString() || null,
        currentBid: state.currentBid,
        currentTeamId: state.currentTeamId?.toString() || null,
        currentTeamName: state.currentTeamName,
        // Keep only latest 10 bid updates for fast payloads.
        bidHistory: state.bidHistory.slice(-10).map((b) => ({
          teamId: b.teamId.toString(),
          teamName: b.teamName,
          amount: b.amount,
          timestamp: b.timestamp.toISOString(),
        })),
        // Accurate per-team count for the current round — never truncated.
        bidCounts,
        updatedAt: state.updatedAt.toISOString(),
        currentPlayer: currentPlayer
          ? {
              _id: currentPlayer._id?.toString(),
              auctionId: currentPlayer.auctionId.toString(),
              name: currentPlayer.name,
              basePrice: currentPlayer.basePrice,
            }
          : null,
      };
      // Populate cache for next poll — non-blocking.
      void setCachedState(id, litePayload);
      return NextResponse.json(litePayload);
    }

    return NextResponse.json({
      ...state,
      _id: state._id?.toString(),
      auctionId: state.auctionId.toString(),
      currentPlayerId: state.currentPlayerId?.toString() || null,
      currentTeamId: state.currentTeamId?.toString() || null,
      bidHistory: state.bidHistory.map((b) => ({
        ...b,
        teamId: b.teamId.toString(),
        timestamp: b.timestamp.toISOString(),
      })),
      currentPlayer: currentPlayer
        ? {
            ...currentPlayer,
            _id: currentPlayer._id?.toString(),
            auctionId: currentPlayer.auctionId.toString(),
          }
        : null,
    });
  } catch (error) {
    console.error("Get state error:", error);
    return NextResponse.json(
      { error: "Failed to fetch auction state" },
      { status: 500 }
    );
  }
}
