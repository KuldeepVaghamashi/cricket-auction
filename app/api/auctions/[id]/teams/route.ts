import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import { calculateMaxBid } from "@/lib/auction-utils";
import type { Team, Auction, TeamWithStats } from "@/lib/types";

// GET all teams for an auction
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

    // Get auction for max players info
    const auction = await db
      .collection<Auction>("auctions")
      .findOne({ _id: auctionId });

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    const teams = await db
      .collection<Team>("teams")
      .find({ auctionId })
      .toArray();

    const teamsWithStats: TeamWithStats[] = teams.map((team) => {
      const playersCount = team.playersBought.length;
      const remainingSlots = auction.maxPlayersPerTeam - playersCount;
      const maxBid = calculateMaxBid(team, auction);

      return {
        _id: team._id!.toString(),
        auctionId: team.auctionId.toString(),
        name: team.name,
      captainName: team.captainName ?? undefined,
        totalBudget: team.totalBudget,
        remainingBudget: team.remainingBudget,
        playersBought: team.playersBought.map((p) => p.toString()),
        playersCount,
        remainingSlots,
        maxBid,
        createdAt: team.createdAt,
      };
    });

    return NextResponse.json(teamsWithStats);
  } catch (error) {
    console.error("Get teams error:", error);
    return NextResponse.json(
      { error: "Failed to fetch teams" },
      { status: 500 }
    );
  }
}

// POST create new team
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
    const { name, totalBudget, captainName } = body;

    if (!name) {
      return NextResponse.json({ error: "Team name is required" }, { status: 400 });
    }

    const db = await getDb();
    const auctionId = new ObjectId(id);

    // Get auction for default budget
    const auction = await db
      .collection<Auction>("auctions")
      .findOne({ _id: auctionId });

    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    const budget = totalBudget ? Number(totalBudget) : auction.budget;

    const team: Team = {
      auctionId,
      name,
      captainName: captainName || undefined,
      totalBudget: budget,
      remainingBudget: budget,
      playersBought: [],
      createdAt: new Date(),
    };

    const result = await db.collection<Team>("teams").insertOne(team);

    return NextResponse.json({
      ...team,
      _id: result.insertedId.toString(),
      auctionId: team.auctionId.toString(),
      playersBought: [],
      playersCount: 0,
      remainingSlots: auction.maxPlayersPerTeam,
      maxBid: budget,
    });
  } catch (error) {
    console.error("Create team error:", error);
    return NextResponse.json(
      { error: "Failed to create team" },
      { status: 500 }
    );
  }
}
