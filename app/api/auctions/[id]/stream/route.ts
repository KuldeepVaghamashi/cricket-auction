import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { calculateMaxBid } from "@/lib/auction-utils";
import type { AuctionState, Auction, Team, Player } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    return new Response("Invalid auction ID", { status: 400 });
  }

  const encoder = new TextEncoder();
  const auctionId = new ObjectId(id);

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const fetchAndSend = async () => {
        try {
          const db = await getDb();

          // Get auction
          const auction = await db
            .collection<Auction>("auctions")
            .findOne({ _id: auctionId });

          if (!auction) {
            sendEvent({ error: "Auction not found" });
            return;
          }

          // Get auction state
          const state = await db
            .collection<AuctionState>("auctionStates")
            .findOne({ auctionId });

          // Get teams with stats
          const teams = await db.collection<Team>("teams").find({ auctionId }).toArray();
          const teamsWithStats = teams.map((team) => ({
            _id: team._id?.toString(),
            name: team.name,
            captainName: team.captainName ?? undefined,
            totalBudget: team.totalBudget,
            remainingBudget: team.remainingBudget,
            playersCount: team.playersBought.length,
            remainingSlots: auction.maxPlayersPerTeam - team.playersBought.length,
            maxBid: calculateMaxBid(team, auction),
          }));

          // Get current player if exists
          let currentPlayer = null;
          if (state?.currentPlayerId) {
            const player = await db
              .collection<Player>("players")
              .findOne({ _id: state.currentPlayerId });
            if (player) {
              currentPlayer = {
                _id: player._id?.toString(),
                name: player.name,
                basePrice: player.basePrice,
              };
            }
          }

          // Get player stats
          const players = await db.collection<Player>("players").find({ auctionId }).toArray();
          const playerStats = {
            available: players.filter((p) => p.status === "available").length,
            sold: players.filter((p) => p.status === "sold").length,
            unsold: players.filter((p) => p.status === "unsold").length,
          };

          sendEvent({
            auction: {
              _id: auction._id?.toString(),
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
                  bidHistory: state.bidHistory.slice(-10).map((b) => ({
                    teamName: b.teamName,
                    amount: b.amount,
                  })),
                  playerTimerEndsAt: state.playerTimerEndsAt ?? null,
                  playerTimerSeconds: state.playerTimerSeconds ?? null,
                }
              : null,
            currentPlayer,
            teams: teamsWithStats,
            playerStats,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("SSE fetch error:", error);
          sendEvent({ error: "Failed to fetch data" });
        }
      };

      // Send initial data
      await fetchAndSend();

      // Set up interval for updates
      const interval = setInterval(fetchAndSend, 2000);

      // Clean up on close
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
