import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AuctionLog } from "@/lib/types";

// GET auction logs
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

    const logs = await db
      .collection<AuctionLog>("auctionLogs")
      .find({ auctionId })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json(
      logs.map((log) => ({
        ...log,
        _id: log._id?.toString(),
        auctionId: log.auctionId.toString(),
        timestamp: log.timestamp.toISOString(),
      }))
    );
  } catch (error) {
    console.error("Get logs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}
