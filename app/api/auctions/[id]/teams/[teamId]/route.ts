import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Team, Player } from "@/lib/types";

// DELETE team
export async function DELETE(
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

    const db = await getDb();
    const teamObjectId = new ObjectId(teamId);

    // Release all players bought by this team
    await db.collection<Player>("players").updateMany(
      { soldTo: teamObjectId },
      { 
        $set: { status: "available" },
        $unset: { soldTo: "", soldPrice: "" }
      }
    );

    // Delete team
    const result = await db
      .collection<Team>("teams")
      .deleteOne({ _id: teamObjectId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete team error:", error);
    return NextResponse.json(
      { error: "Failed to delete team" },
      { status: 500 }
    );
  }
}
