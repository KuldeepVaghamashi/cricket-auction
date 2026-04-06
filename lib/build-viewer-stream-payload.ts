import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { calculateMaxBid } from "@/lib/auction-utils";
import type { AuctionState, Auction, Team, Player } from "@/lib/types";
import type { ViewerStreamPayload } from "@/lib/viewer-stream-types";

export type ViewerSnapshotMode = "full" | "state" | "stats";

/**
 * One-shot payload for the public viewer (same fields as SSE stream events).
 * Used by GET viewer-snapshot and triggered after server-side mutations via WebSocket hints.
 */
export async function buildViewerStreamPayload(
  auctionId: ObjectId,
  mode: ViewerSnapshotMode = "full"
): Promise<Partial<ViewerStreamPayload>> {
  const db = await getDb();

  const auction = await db.collection<Auction>("auctions").findOne({ _id: auctionId });
  if (!auction) {
    return {
      error: "Auction not found",
      auction: {
        _id: auctionId.toString(),
        name: "",
        status: "",
        minIncrement: 0,
        maxPlayersPerTeam: 0,
      },
      state: null,
      currentPlayer: null,
      teams: [],
      playerStats: { available: 0, sold: 0, unsold: 0 },
      timestamp: new Date().toISOString(),
    };
  }

  const state = await db.collection<AuctionState>("auctionStates").findOne(
    { auctionId },
    {
      projection: {
        currentBid: 1,
        currentPlayerId: 1,
        currentTeamId: 1,
        currentTeamName: 1,
        updatedAt: 1,
        lastAction: 1,
        lastActionAt: 1,
        lastActionPlayerName: 1,
        lastActionTeamName: 1,
        lastActionPrice: 1,
        bidHistory: { $slice: -10 },
      } as Record<string, 1 | { $slice: number }>,
    }
  );

  const includeTeams = mode === "full";
  const includePlayerStats = mode === "full" || mode === "stats";

  let teamsWithStats: ViewerStreamPayload["teams"] | undefined = undefined;
  if (includeTeams) {
    const teams = await db
      .collection<Team>("teams")
      .find(
        { auctionId },
        {
          projection: {
            _id: 1,
            name: 1,
            captainName: 1,
            totalBudget: 1,
            remainingBudget: 1,
            playersBought: 1,
          },
        }
      )
      .toArray();

    teamsWithStats = teams.map((team) => ({
      _id: team._id?.toString() ?? "",
      name: team.name,
      captainName: team.captainName ?? undefined,
      totalBudget: team.totalBudget,
      remainingBudget: team.remainingBudget,
      playersCount: team.playersBought.length,
      remainingSlots: auction.maxPlayersPerTeam - team.playersBought.length,
      maxBid: calculateMaxBid(team, auction),
    }));
  }

  let playerStats: ViewerStreamPayload["playerStats"] | undefined = undefined;
  if (includePlayerStats) {
    const [availableCount, soldCount, unsoldCount] = await Promise.all([
      db.collection<Player>("players").countDocuments({ auctionId, status: "available" }),
      db.collection<Player>("players").countDocuments({ auctionId, status: "sold" }),
      db.collection<Player>("players").countDocuments({ auctionId, status: "unsold" }),
    ]);

    playerStats = {
      available: availableCount,
      sold: soldCount,
      unsold: unsoldCount,
    };
  }

  let currentPlayer: ViewerStreamPayload["currentPlayer"] = null;
  const nextIdRaw = state?.currentPlayerId ?? null;
  if (nextIdRaw) {
    const nextId =
      typeof nextIdRaw === "string"
        ? ObjectId.isValid(nextIdRaw)
          ? new ObjectId(nextIdRaw)
          : null
        : nextIdRaw;
    if (nextId) {
      const player = await db
        .collection<Player>("players")
        .findOne({ _id: nextId }, { projection: { _id: 1, name: 1, basePrice: 1 } });
      if (player) {
        currentPlayer = {
          _id: player._id?.toString() ?? "",
          name: player.name,
          basePrice: player.basePrice,
        };
      }
    }
  }

  const bidHistorySlice = (state?.bidHistory ?? []).slice(-10);

  const result: Partial<ViewerStreamPayload> = {
    auction: {
      _id: auction._id?.toString() ?? "",
      name: auction.name,
      status: auction.status,
      minIncrement: auction.minIncrement,
      maxPlayersPerTeam: auction.maxPlayersPerTeam,
    },
    state: state
      ? {
          currentBid: state.currentBid,
          currentTeamId: state.currentTeamId?.toString() || null,
          currentTeamName: state.currentTeamName,
          updatedAt: state.updatedAt?.toISOString?.() ?? null,
          lastAction: state.lastAction ?? null,
          lastActionAt: state.lastActionAt?.toISOString?.() ?? null,
          lastActionPlayerName: state.lastActionPlayerName ?? null,
          lastActionTeamName: state.lastActionTeamName ?? null,
          lastActionPrice: state.lastActionPrice ?? null,
          bidHistory: bidHistorySlice.map((b) => ({
            teamName: b.teamName,
            amount: b.amount,
            timestamp: b.timestamp instanceof Date ? b.timestamp.toISOString() : String(b.timestamp),
          })),
        }
      : null,
    currentPlayer,
    timestamp: new Date().toISOString(),
  };

  if (teamsWithStats) result.teams = teamsWithStats;
  if (playerStats) result.playerStats = playerStats;

  return result;
}
