"use client";

import { useState, useEffect, use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Users, DollarSign, Gavel } from "lucide-react";
import useSWR from "swr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AuctionWithId, PlayerWithId, TeamWithStats } from "@/lib/types";

interface StreamData {
  auction: {
    _id: string;
    name: string;
    status: string;
    minIncrement: number;
    maxPlayersPerTeam: number;
  };
  state: {
    currentBid: number;
    currentTeamId: string | null;
    currentTeamName: string | null;
    bidHistory: Array<{ teamName: string; amount: number }>;
  } | null;
  currentPlayer: {
    _id: string;
    name: string;
    basePrice: number;
  } | null;
  teams: Array<{
    _id: string;
    name: string;
    captainName?: string;
    totalBudget: number;
    remainingBudget: number;
    playersCount: number;
    remainingSlots: number;
    maxBid: number;
  }>;
  playerStats: {
    available: number;
    sold: number;
    unsold: number;
  };
  timestamp: string;
  error?: string;
}

export default function AuctionViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<StreamData | null>(null);
  const [connected, setConnected] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const fetcher = (url: string) => fetch(url).then((res) => res.json());

  // These lists change less frequently than the live SSE stream,
  // so we can poll them less often and avoid extra load for many viewers.
  const { data: allTeams } = useSWR<TeamWithStats[]>(`/api/auctions/${id}/teams`, fetcher, {
    refreshInterval: 7000,
    revalidateOnFocus: false,
  });
  const { data: allPlayers } = useSWR<PlayerWithId[]>(`/api/auctions/${id}/players`, fetcher, {
    refreshInterval: 7000,
    revalidateOnFocus: false,
  });
  const { data: auctionMeta } = useSWR<AuctionWithId>(`/api/auctions/${id}`, fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  });
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const eventSource = new EventSource(`/api/auctions/${id}/stream`);

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        setData(parsed);
      } catch (e) {
        console.error("Failed to parse SSE data:", e);
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [id]);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse text-muted-foreground mb-2">
            Connecting to auction...
          </div>
          {!connected && (
            <p className="text-sm text-muted-foreground">
              Please wait while we establish connection
            </p>
          )}
        </div>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive">{data.error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.auction.status !== "active") {
    const teamNameById = new Map<string, string>(
      (allTeams ?? []).map((t) => [t._id, t.name])
    );
    const soldPlayers = (allPlayers ?? []).filter((p) => p.status === "sold");
    const isDraft = data.auction.status === "draft";

    const startsAtMs = auctionMeta?.date ? new Date(auctionMeta.date).getTime() : NaN;
    const hasStartsAt = Number.isFinite(startsAtMs);
    const msRemaining = hasStartsAt ? startsAtMs - nowMs : 0;
    const hasCountdown = isDraft && hasStartsAt && msRemaining > 0;

    const formatCountdown = (ms: number) => {
      const totalSeconds = Math.floor(ms / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
      return `${hours}h ${minutes}m ${seconds}s`;
    };

    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-4xl">
            <CardHeader className="text-center">
              <Gavel className="h-12 w-12 mx-auto text-primary mb-4" />
              <CardTitle>{data.auction.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center text-center gap-3">
                <Badge variant="outline" className="text-lg px-4 py-2">
                  {data.auction.status === "draft" ? "Auction Not Started" : "Auction Completed"}
                </Badge>
                {hasStartsAt && (
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-sm text-muted-foreground">Scheduled Start</p>
                    <p className="font-semibold">
                      {new Date(startsAtMs).toLocaleString()}
                    </p>
                  </div>
                )}
                {isDraft && (
                  <Badge variant={hasCountdown ? "default" : "secondary"} className="text-base px-4 py-2">
                    {hasCountdown
                      ? `Starts in: ${formatCountdown(msRemaining)}`
                      : "Starting soon"}
                  </Badge>
                )}
                <p className="text-muted-foreground">
                  {data.auction.status === "draft"
                    ? "The auction has not started yet. Please wait for the auctioneer to begin."
                    : "This auction has been completed. Here are the sold results."}
                </p>
              </div>

              <div className="mt-6">
                <h3 className="text-lg font-semibold mb-3">Sold Players</h3>
                {!allPlayers || !allTeams ? (
                  <p className="text-sm text-muted-foreground">Loading results...</p>
                ) : soldPlayers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No players were sold.</p>
                ) : (
                  <ScrollArea className="h-[360px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Player</TableHead>
                          <TableHead>Sold To</TableHead>
                          <TableHead className="text-right">Points</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {soldPlayers.map((p) => (
                          <TableRow key={p._id}>
                            <TableCell className="font-medium">{p.name}</TableCell>
                            <TableCell>
                              {p.soldTo ? teamNameById.get(p.soldTo) ?? "-" : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {typeof p.soldPrice === "number" ? p.soldPrice : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <footer className="border-t py-6 bg-card">
          <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
            <p>Designed and Developed By Kuldeep Ahir</p>
          </div>
        </footer>
      </div>
    );
  }

  const recentBidCounts: Record<string, number> = {};
  (data.state?.bidHistory ?? []).forEach((b) => {
    recentBidCounts[b.teamName] = (recentBidCounts[b.teamName] ?? 0) + 1;
  });

  const teamNameById = new Map<string, string>(
    (allTeams ?? []).map((t) => [t._id, t.name])
  );
  const soldPlayers = (allPlayers ?? []).filter((p) => p.status === "sold");
  const selectedTeamName =
    selectedTeamId ? teamNameById.get(selectedTeamId) ?? "Selected Team" : null;
  const selectedTeamSoldPlayers = selectedTeamId
    ? soldPlayers.filter((p) => p.soldTo === selectedTeamId)
    : [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Gavel className="h-6 w-6 text-primary" />
            <h1 className="font-bold text-sm sm:text-lg truncate max-w-[220px] sm:max-w-none">
              {data.auction.name}
            </h1>
          </div>
          <Badge variant="default" className="bg-primary animate-pulse">
            LIVE
          </Badge>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 flex-1">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Section - Current Player */}
          <div className="lg:col-span-2">
            <Card className="overflow-hidden">
              <CardHeader className="bg-secondary/50">
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Current Player
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-6">
                {data.currentPlayer ? (
                  <div className="text-center">
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-3 break-words">
                      {data.currentPlayer.name}
                    </h2>
                    <Badge variant="outline" className="text-lg px-4 py-1">
                      Base: {data.currentPlayer.basePrice} pts
                    </Badge>

                    {/* Current Bid Display */}
                    <div
                      className={`
                        mt-8 p-8 rounded-xl transition-glow
                        ${data.state?.currentTeamId ? "bg-primary/10 glow-primary" : "bg-secondary"}
                      `}
                    >
                      <p className="text-muted-foreground mb-2">Current Bid</p>
                      <p className="text-4xl sm:text-6xl lg:text-7xl font-bold text-primary">
                        {data.state?.currentBid || data.currentPlayer.basePrice}
                      </p>
                      <p className="text-xl mt-4">
                        {data.state?.currentTeamName ? (
                          <span className="text-primary font-semibold">
                            {data.state.currentTeamName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Waiting for bids...</span>
                        )}
                      </p>
                    </div>

                    {/* Bid History */}
                    {data.state?.bidHistory && data.state.bidHistory.length > 0 && (
                      <div className="mt-6">
                        <p className="text-sm text-muted-foreground mb-3">Recent Bids</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {[...data.state.bidHistory].reverse().slice(0, 5).map((bid, i) => (
                            <Badge
                              key={i}
                              variant={i === 0 ? "default" : "outline"}
                              className="text-sm"
                            >
                              {bid.teamName}: {bid.amount}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-secondary mb-4">
                      <User className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <p className="text-xl text-muted-foreground">
                      Waiting for next player...
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      The auctioneer will pick the next player shortly
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Player Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-3xl font-bold text-available">
                    {data.playerStats.available}
                  </p>
                  <p className="text-sm text-muted-foreground">Available</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-3xl font-bold text-sold">
                    {data.playerStats.sold}
                  </p>
                  <p className="text-sm text-muted-foreground">Sold</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-3xl font-bold text-unsold">
                    {data.playerStats.unsold}
                  </p>
                  <p className="text-sm text-muted-foreground">Unsold</p>
                </CardContent>
              </Card>
            </div>

            {/* Sold So Far */}
            <div className="mt-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Sold Players</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Player → Team → Points (updates during the auction)
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[240px]">
                    <div className="p-4">
                      {!allPlayers || !allTeams ? (
                        <p className="text-sm text-muted-foreground">Loading results...</p>
                      ) : soldPlayers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No players sold yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Player</TableHead>
                              <TableHead>Sold To</TableHead>
                              <TableHead className="text-right">Points</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {soldPlayers.map((p) => (
                              <TableRow key={p._id}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell>
                                  {p.soldTo ? teamNameById.get(p.soldTo) ?? "-" : "-"}
                                </TableCell>
                                <TableCell className="text-right">
                                  {typeof p.soldPrice === "number" ? p.soldPrice : "-"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Right Column - Teams */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Teams
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[600px]">
                  <div className="p-4 flex flex-col gap-3">
                    {data.teams.map((team) => {
                      const budgetPercent = (team.remainingBudget / team.totalBudget) * 100;
                      const isLeading = data.state?.currentTeamId === team._id;

                      return (
                        <div
                          key={team._id}
                          className={`
                            p-4 rounded-lg border transition-glow cursor-pointer
                            ${isLeading ? "border-primary glow-primary bg-primary/5" : ""}
                            ${selectedTeamId === team._id ? "border-primary bg-primary/10" : ""}
                          `}
                          onClick={() => setSelectedTeamId(team._id)}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold">{team.name}</span>
                            {isLeading && (
                              <Badge variant="default" className="text-xs">
                                Leading
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs mt-1 text-muted-foreground">
                            Captain: {team.captainName || "-"}
                          </p>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden mb-2">
                            <div
                              className="h-full bg-primary transition-all duration-500"
                              style={{ width: `${budgetPercent}%` }}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <div>
                              <DollarSign className="h-3 w-3 inline" />
                              {team.remainingBudget} / {team.totalBudget}
                            </div>
                            <div>
                              <User className="h-3 w-3 inline" />
                              {team.playersCount} / {data.auction.maxPlayersPerTeam}
                            </div>
                          </div>
                          <p className="text-xs mt-2 text-muted-foreground">
                            Recent bids: {recentBidCounts[team.name] ?? 0}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <footer className="border-t py-6 bg-card">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Designed and Developed By Kuldeep Ahir</p>
        </div>
      </footer>

      <Dialog open={!!selectedTeamId} onOpenChange={(open) => !open && setSelectedTeamId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedTeamName ? `Sold Players - ${selectedTeamName}` : "Sold Players"}
            </DialogTitle>
            <DialogDescription>
              Team-wise sold player list.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            {selectedTeamSoldPlayers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sold players for this team.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTeamSoldPlayers.map((p) => (
                    <TableRow key={p._id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right">
                        {typeof p.soldPrice === "number" ? p.soldPrice : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
