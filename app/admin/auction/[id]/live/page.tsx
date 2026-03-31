"use client";

import { useState, use, useCallback } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ArrowLeft, 
  Shuffle, 
  Plus, 
  Minus, 
  Check, 
  X, 
  RotateCcw,
  User,
  Users,
  DollarSign,
  AlertCircle
} from "lucide-react";
import type { AuctionWithId, TeamWithStats, PlayerWithId } from "@/lib/types";

interface AuctionStateResponse {
  _id: string;
  auctionId: string;
  currentPlayerId: string | null;
  currentBid: number;
  currentTeamId: string | null;
  currentTeamName: string | null;
  bidHistory: Array<{
    teamId: string;
    teamName: string;
    amount: number;
    timestamp: string;
  }>;
  currentPlayer: PlayerWithId | null;
  playerTimerEndsAt?: number | null;
  playerTimerSeconds?: number | null;
}

interface AuctionLogResponse {
  _id: string;
  auctionId: string;
  action: string;
  details: Record<string, unknown>;
  timestamp: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function LiveAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [viewerCopied, setViewerCopied] = useState(false);
  
  const { data: auction } = useSWR<AuctionWithId>(`/api/auctions/${id}`, fetcher);
  const { data: teams, mutate: mutateTeams } = useSWR<TeamWithStats[]>(
    `/api/auctions/${id}/teams`,
    fetcher,
    { refreshInterval: 2000 }
  );
  const { data: players, mutate: mutatePlayers } = useSWR<PlayerWithId[]>(
    `/api/auctions/${id}/players`,
    fetcher,
    { refreshInterval: 2000 }
  );
  const { data: state, mutate: mutateState } = useSWR<AuctionStateResponse>(
    `/api/auctions/${id}/state`,
    fetcher,
    { refreshInterval: 1000 }
  );
  const { data: logs } = useSWR<AuctionLogResponse[]>(
    `/api/auctions/${id}/logs`,
    fetcher,
    { refreshInterval: 2500 }
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBid, setPendingBid] = useState<number | null>(null);

  const refreshAll = useCallback(() => {
    mutateTeams();
    mutatePlayers();
    mutateState();
  }, [mutateTeams, mutatePlayers, mutateState]);

  const playTone = (frequency: number, durationMs = 90) => {
    // Web Audio API: generate a short beep (no external audio assets).
    if (typeof window === "undefined") return;
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;

      const ctx = new AudioContextCtor();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gainNode.gain.value = 0.03;

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();
      window.setTimeout(() => {
        oscillator.stop();
        ctx.close().catch(() => {});
      }, durationMs);
    } catch {
      // Sound is best-effort; never block auction actions.
    }
  };

  const handlePickRandom = async () => {
    setLoading(true);
    setError(null);
    setPendingBid(null);
    
    try {
      const res = await fetch(`/api/auctions/${id}/state/pick-random`, {
        method: "POST",
      });
      const data = await res.json();
      
      if (!res.ok) {
        setError(data.error);
      } else {
        playTone(880, 70);
        refreshAll();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopyViewerLink = async () => {
    try {
      // Always copy the current site domain so the link works
      // on Vercel and when sharing to anyone.
      const url =
        typeof window !== "undefined"
          ? `${window.location.origin}/auction/${id}`
          : `/auction/${id}`;
      await navigator.clipboard.writeText(url);
      setViewerCopied(true);
      window.setTimeout(() => setViewerCopied(false), 2000);
    } catch {
      alert("Unable to copy viewer link. You can open the viewer instead.");
    }
  };

  const handlePlaceBid = async (teamId: string, amount: number) => {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/auctions/${id}/state/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, amount }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        setError(data.error);
      } else {
        setPendingBid(null);
        playTone(660, 80);
        refreshAll();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (action: "sold" | "unsold") => {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/auctions/${id}/state/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        setError(data.error);
      } else {
        setPendingBid(null);
        playTone(action === "sold" ? 523 : 220, 130);
        refreshAll();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setLoading(true);
    setError(null);
    setPendingBid(null);
    
    try {
      const res = await fetch(`/api/auctions/${id}/state/reset`, {
        method: "POST",
      });
      const data = await res.json();
      
      if (!res.ok) {
        setError(data.error);
      } else {
        playTone(440, 90);
        refreshAll();
      }
    } finally {
      setLoading(false);
    }
  };

  if (!auction || !teams || !players || !state) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading auction...</div>
      </div>
    );
  }

  const availablePlayers = players.filter((p) => p.status === "available");
  const unsoldReplayCandidates = players.filter(
    (p) => p.status === "unsold" && p.unsoldReplayed !== true
  );
  const pickablePlayersCount = availablePlayers.length + unsoldReplayCandidates.length;
  const serverCurrentBid = state.currentBid;
  const increment = auction.minIncrement;
  const minLegalBid = state.currentTeamId ? serverCurrentBid + increment : serverCurrentBid;
  const currentBid = pendingBid ?? serverCurrentBid;
  const timerSecondsLeft =
    typeof state.playerTimerEndsAt === "number"
      ? Math.max(0, Math.ceil((state.playerTimerEndsAt - Date.now()) / 1000))
      : null;

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div className="flex items-center gap-3 md:gap-4">
            <Link href={`/admin/auction/${id}`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl lg:text-2xl font-bold">{auction.name}</h1>
              <p className="text-sm text-muted-foreground">
                Live Auction Controller
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-start md:justify-end">
            <Link href={`/auction/${id}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2">
                Open Viewer
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={handleCopyViewerLink}
              className="gap-2"
              disabled={viewerCopied}
            >
              {viewerCopied ? "Copied" : "Copy Viewer Link"}
            </Button>
          </div>
          <Badge variant="default" className="self-start md:self-auto bg-primary animate-pulse">
            LIVE
          </Badge>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setError(null)}
              className="ml-auto h-6 px-2"
            >
              Dismiss
            </Button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Current Player & Controls */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {/* Current Player Card */}
            <Card className="overflow-hidden">
              <CardHeader className="bg-secondary/50">
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Current Player
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {state.currentPlayer ? (
                  <div className="text-center">
                    <h2 className="text-3xl lg:text-4xl font-bold mb-2">
                      {state.currentPlayer.name}
                    </h2>
                    <Badge variant="outline" className="mb-4 text-lg px-4 py-1">
                      Base: {state.currentPlayer.basePrice} pts
                    </Badge>
                    {timerSecondsLeft !== null && (
                      <Badge variant="secondary" className="mb-4 text-lg px-4 py-1">
                        Timer: {timerSecondsLeft}s
                      </Badge>
                    )}
                    
                    {/* Current Bid Display */}
                    <div className={`
                      mt-6 p-6 rounded-xl transition-glow
                      ${state.currentTeamId ? "bg-primary/10 glow-primary" : "bg-secondary"}
                    `}>
                      <p className="text-sm text-muted-foreground mb-1">Current Bid</p>
                      <p className="text-5xl lg:text-6xl font-bold text-primary">
                        {currentBid}
                      </p>
                      <p className="text-lg mt-2">
                        {state.currentTeamName ? (
                          <span className="text-primary font-semibold">
                            {state.currentTeamName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No bids yet</span>
                        )}
                      </p>
                    </div>

                    {/* Bid Controls */}
                    <div className="flex flex-wrap items-center justify-center gap-4 mt-6">
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => {
                          setPendingBid((prev) => {
                            const base = prev ?? minLegalBid;
                            return Math.max(minLegalBid, base - increment);
                          });
                        }}
                        disabled={loading || (pendingBid ?? minLegalBid) <= minLegalBid}
                      >
                        <Minus className="h-5 w-5" />
                      </Button>
                      <span className="text-2xl font-bold min-w-[100px]">
                        {pendingBid !== null ? <span className="text-primary">{pendingBid}</span> : currentBid}
                      </span>
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => {
                          setPendingBid((prev) => {
                            const base = prev ?? minLegalBid;
                            return base + increment;
                          });
                        }}
                        disabled={loading}
                      >
                        <Plus className="h-5 w-5" />
                      </Button>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap justify-center gap-3 mt-6">
                      <Button
                        variant="outline"
                        onClick={handleReset}
                        disabled={loading}
                        className="gap-2"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reset
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => handleComplete("unsold")}
                        disabled={loading}
                        className="gap-2"
                      >
                        <X className="h-4 w-4" />
                        Skip
                      </Button>
                      <Button
                        onClick={() => handleComplete("sold")}
                        disabled={loading || !state.currentTeamId}
                        className="gap-2"
                      >
                        <Check className="h-4 w-4" />
                        Sold
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-4">
                      No player selected. Pick a random player to start bidding.
                    </p>
                    <Button
                      onClick={handlePickRandom}
                      disabled={loading || pickablePlayersCount === 0}
                      size="lg"
                      className="gap-2"
                    >
                      <Shuffle className="h-5 w-5" />
                      Pick Random Player
                    </Button>
                    {pickablePlayersCount === 0 && (
                      <p className="text-sm text-muted-foreground mt-4">
                        No players left to pick in the pool.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Team Bidding Grid */}
            {state.currentPlayer && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Place Bid for Team
                  </CardTitle>
                  <CardDescription>
                    Click a team to place the current bid amount
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {teams.map((team) => {
                      const isLeading = state.currentTeamId === team._id;
                      const bidAmount = pendingBid ?? minLegalBid;
                      const canAffordBid = team.maxBid >= bidAmount;
                      const bidCount = state.bidHistory.filter((b) => b.teamId === team._id).length;
                      const canTeamBid = !isLeading;
                      
                      return (
                        <Button
                          key={team._id}
                          variant={isLeading ? "default" : "outline"}
                          className={`
                            h-auto p-4 flex flex-col items-start gap-1 transition-glow
                            ${isLeading ? "glow-primary" : ""}
                            ${!canAffordBid || team.remainingSlots <= 0 ? "opacity-50" : ""}
                          `}
                          disabled={loading || !canTeamBid || !canAffordBid || team.remainingSlots <= 0}
                          onClick={() => handlePlaceBid(team._id, bidAmount)}
                        >
                          <span className="font-semibold">{team.name}</span>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-80">
                            <span>Budget: {team.remainingBudget}</span>
                            <span>Max: {team.maxBid}</span>
                            <span>Slots: {team.remainingSlots}</span>
                            <span>Bids: {bidCount}</span>
                          </div>
                          {isLeading && (
                            <Badge variant="secondary" className="mt-1 text-xs">
                              Leading
                            </Badge>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Pick Random Button when player selected */}
            {state.currentPlayer && (
              <Button
                variant="outline"
                onClick={handlePickRandom}
                disabled={loading || pickablePlayersCount === 0}
                className="gap-2"
              >
                <Shuffle className="h-4 w-4" />
                Skip & Pick New Player ({pickablePlayersCount} left)
              </Button>
            )}
          </div>

          {/* Right Column - Teams Overview & Recent Bids */}
          <div className="flex flex-col gap-6">
            {/* Teams Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="h-4 w-4" />
                  Team Budgets
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[300px]">
                  <div className="p-4 flex flex-col gap-3">
                    {teams.map((team) => {
                      const budgetPercent = (team.remainingBudget / team.totalBudget) * 100;
                      const isLeading = state.currentTeamId === team._id;
                      
                      return (
                        <div
                          key={team._id}
                          className={`
                            p-3 rounded-lg border transition-glow
                            ${isLeading ? "border-primary glow-primary bg-primary/5" : ""}
                          `}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm">{team.name}</span>
                            {isLeading && (
                              <Badge variant="default" className="text-xs">
                                Leading
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Captain: {team.captainName || "-"}
                          </p>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden mb-2">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${budgetPercent}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{team.remainingBudget} / {team.totalBudget} pts</span>
                            <span>{team.playersCount} / {auction.maxPlayersPerTeam} players</span>
                          </div>
                          <p className="text-xs mt-1">
                            Max bid: <span className="font-medium text-primary">{team.maxBid}</span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Recent Bid History */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Bids</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[200px]">
                  <div className="p-4 flex flex-col gap-2">
                    {state.bidHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No bids yet
                      </p>
                    ) : (
                      [...state.bidHistory].reverse().map((bid, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 bg-secondary/50 rounded text-sm"
                        >
                          <span>{bid.teamName}</span>
                          <span className="font-medium">{bid.amount} pts</span>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Auction Activity Log */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Auction Activity</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[220px]">
                  <div className="p-4 flex flex-col gap-2">
                    {!logs ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Loading logs...
                      </p>
                    ) : logs.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No activity yet
                      </p>
                    ) : (
                      logs.map((log) => {
                        const t = new Date(log.timestamp);
                        const time = isNaN(t.getTime())
                          ? log.timestamp
                          : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                        let message = log.action;
                        if (log.action === "bid_placed") {
                          const teamName = typeof log.details.teamName === "string" ? log.details.teamName : "";
                          const amount = typeof log.details.amount === "number" ? log.details.amount : null;
                          message = amount !== null ? `${teamName} bid ${amount} pts` : `Bid placed (${teamName})`;
                        } else if (log.action === "player_picked") {
                          const playerName = typeof log.details.playerName === "string" ? log.details.playerName : "";
                          message = `Picked ${playerName}`;
                        } else if (log.action === "player_sold") {
                          const playerName = typeof log.details.playerName === "string" ? log.details.playerName : "";
                          const teamName = typeof log.details.teamName === "string" ? log.details.teamName : "";
                          const price = typeof log.details.price === "number" ? log.details.price : null;
                          message = price !== null ? `${playerName} sold to ${teamName} (${price} pts)` : `Sold ${playerName}`;
                        } else if (log.action === "player_unsold") {
                          const playerName = typeof log.details.playerName === "string" ? log.details.playerName : "";
                          message = `Unsold ${playerName}`;
                        } else if (log.action === "bid_reset") {
                          const playerName = typeof log.details.playerName === "string" ? log.details.playerName : "";
                          const resetTo = typeof log.details.resetTo === "number" ? log.details.resetTo : null;
                          message = resetTo !== null ? `Reset ${playerName} to ${resetTo} pts` : `Bid reset (${playerName})`;
                        }

                        return (
                          <div
                            key={log._id}
                            className="flex items-start justify-between gap-3 p-2 bg-secondary/50 rounded"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{message}</div>
                            </div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap mt-0.5">
                              {time}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Player Pool Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Player Pool</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 bg-secondary rounded">
                    <p className="text-2xl font-bold text-available">
                      {availablePlayers.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Available</p>
                  </div>
                  <div className="p-2 bg-secondary rounded">
                    <p className="text-2xl font-bold text-sold">
                      {players.filter((p) => p.status === "sold").length}
                    </p>
                    <p className="text-xs text-muted-foreground">Sold</p>
                  </div>
                  <div className="p-2 bg-secondary rounded">
                    <p className="text-2xl font-bold text-unsold">
                      {players.filter((p) => p.status === "unsold").length}
                    </p>
                    <p className="text-xs text-muted-foreground">Unsold</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
