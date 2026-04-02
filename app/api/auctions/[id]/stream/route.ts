import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { calculateMaxBid } from "@/lib/auction-utils";
import type { AuctionState, Auction, Team, Player } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long-lived stream; raise on Vercel (Project Settings → Functions) if connections drop early. */
export const maxDuration = 300;

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

      // Optimize DB work:
      // - Every tick: only read current auction state (currentBid + bidHistory).
      // - Less frequently: refresh heavy data (teams/maxBid + player counts + auction meta).
      const db = await getDb();
      const now = () => Date.now();
      const TICK_MS = 200;
      const REFRESH_AUCTION_MS = 10000;
      const REFRESH_TEAMS_MS = 4000;
      const REFRESH_STATS_MS = 4000;

      let inFlight = false;
      let lastStateKey: string | null = null;

      let cachedAuction: Auction | null = null;
      let cachedTeamsWithStats:
        | Array<{
            _id: string;
            name: string;
            captainName?: string;
            totalBudget: number;
            remainingBudget: number;
            playersCount: number;
            remainingSlots: number;
            maxBid: number;
          }>
        | null = null;
      let cachedPlayerStats: { available: number; sold: number; unsold: number } = {
        available: 0,
        sold: 0,
        unsold: 0,
      };
      let cachedCurrentPlayer: { _id: string; name: string; basePrice: number } | null =
        null;
      let cachedCurrentPlayerId: ObjectId | null = null;
      let teamsLastFetch = 0;
      let statsLastFetch = 0;
      let auctionLastFetch = 0;

      const fetchAuction = async () => {
        try {
          const auction = await db.collection<Auction>("auctions").findOne({ _id: auctionId });
          if (!auction) {
            cachedAuction = null;
            return;
          }
          cachedAuction = auction;
          auctionLastFetch = now();
        } catch {
          // ignore; we'll retry next tick
        }
      };

      const fetchTeamsAndStats = async () => {
        if (!cachedAuction) return;
        try {
          const auction = cachedAuction;

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

          cachedTeamsWithStats = teams.map((team) => ({
            _id: team._id?.toString() ?? "",
            name: team.name,
            captainName: team.captainName ?? undefined,
            totalBudget: team.totalBudget,
            remainingBudget: team.remainingBudget,
            playersCount: team.playersBought.length,
            remainingSlots: auction.maxPlayersPerTeam - team.playersBought.length,
            maxBid: calculateMaxBid(team, auction),
          }));

          // Player stats via indexed counts.
          const [availableCount, soldCount, unsoldCount] = await Promise.all([
            db
              .collection<Player>("players")
              .countDocuments({ auctionId, status: "available" }),
            db.collection<Player>("players").countDocuments({ auctionId, status: "sold" }),
            db
              .collection<Player>("players")
              .countDocuments({ auctionId, status: "unsold" }),
          ]);

          cachedPlayerStats = {
            available: availableCount,
            sold: soldCount,
            unsold: unsoldCount,
          };

          teamsLastFetch = now();
          statsLastFetch = now();
        } catch {
          // ignore; we'll retry on next refresh window
        }
      };

      const fetchCurrentPlayerIfNeeded = async (state: AuctionState | null) => {
        const nextIdRaw = state?.currentPlayerId ?? null;
        if (!nextIdRaw) {
          cachedCurrentPlayerId = null;
          cachedCurrentPlayer = null;
          return;
        }

        // Safety: in some environments `currentPlayerId` may come as a string.
        // Convert to ObjectId when possible so Mongo `_id` lookups work reliably.
        const nextId =
          typeof nextIdRaw === "string"
            ? ObjectId.isValid(nextIdRaw)
              ? new ObjectId(nextIdRaw)
              : null
            : nextIdRaw;

        if (!nextId) {
          cachedCurrentPlayerId = null;
          cachedCurrentPlayer = null;
          return;
        }

        if (cachedCurrentPlayerId && nextId.toString() === cachedCurrentPlayerId.toString()) return;

        try {
          const player = await db
            .collection<Player>("players")
            .findOne(
              { _id: nextId },
              { projection: { _id: 1, name: 1, basePrice: 1 } }
            );
          cachedCurrentPlayerId = nextId;
          cachedCurrentPlayer = player
            ? {
                _id: player._id?.toString() ?? "",
                name: player.name,
                basePrice: player.basePrice,
              }
            : null;
        } catch {
          // ignore
        }
      };

      const fetchAndSend = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          // Refresh auction meta occasionally (status can change draft->active->completed).
          if (!cachedAuction || now() - auctionLastFetch > REFRESH_AUCTION_MS) {
            await fetchAuction();
          }
          if (!cachedAuction) {
            sendEvent({ error: "Auction not found" });
            return;
          }

          // Always read current auction state for near-real-time bids.
          const state = await db
            .collection<AuctionState>("auctionStates")
            .findOne(
              { auctionId },
              {
                projection: {
                  currentBid: 1,
                  currentPlayerId: 1,
                  currentTeamId: 1,
                  currentTeamName: 1,
                  updatedAt: 1,
                  // Reduce payload; viewer only shows last ~5.
                  bidHistory: { $slice: -10 },
                } as any,
              }
            );

          const stateKey = state
            ? `${state.currentBid}-${state.currentTeamId?.toString() ?? ""}-${
                // Include current player so viewer updates immediately when phase changes.
                state.currentPlayerId?.toString?.() ?? ""
              }-${cachedAuction?.status ?? ""}-${
                state.updatedAt instanceof Date
                  ? state.updatedAt.getTime()
                  : String(state.updatedAt)
              }`
            : "null";

          // Optimization: only push to the client when bid state actually changes.
          // This reduces UI re-renders and network overhead, improving perceived realtime feel.
          if (stateKey === lastStateKey) return;
          lastStateKey = stateKey;

          // Refresh teams/maxBid and player stats occasionally.
          if (
            !cachedTeamsWithStats ||
            now() - teamsLastFetch > REFRESH_TEAMS_MS ||
            now() - statsLastFetch > REFRESH_STATS_MS
          ) {
            await fetchTeamsAndStats();
          }

          // Refresh current player only when it changes.
          await fetchCurrentPlayerIfNeeded(state);

          sendEvent({
            auction: {
              _id: cachedAuction._id?.toString(),
              name: cachedAuction.name,
              status: cachedAuction.status,
              minIncrement: cachedAuction.minIncrement,
              maxPlayersPerTeam: cachedAuction.maxPlayersPerTeam,
            },
            state: state
              ? {
                  currentBid: state.currentBid,
                  currentTeamId: state.currentTeamId?.toString() || null,
                  currentTeamName: state.currentTeamName,
                  updatedAt: state.updatedAt?.toISOString?.() ?? null,
                  bidHistory: state.bidHistory.slice(-10).map((b) => ({
                    teamName: b.teamName,
                    amount: b.amount,
                    timestamp: b.timestamp.toISOString(),
                  })),
                }
              : null,
            currentPlayer: cachedCurrentPlayer,
            teams: cachedTeamsWithStats ?? [],
            playerStats: cachedPlayerStats,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("SSE fetch error:", error);
          sendEvent({ error: "Failed to fetch data" });
        } finally {
          inFlight = false;
        }
      };

      // Send initial data
      await fetchAndSend();

      // Push updates frequently for near-real-time bids.
      const interval = setInterval(fetchAndSend, TICK_MS);

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
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
