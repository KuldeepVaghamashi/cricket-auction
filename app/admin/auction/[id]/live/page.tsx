"use client";

import { useState, use, useCallback, useMemo, useRef } from "react";
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
  Undo2,
  User,
  Users,
  DollarSign,
  AlertCircle,
  MousePointerClick,
} from "lucide-react";
import type { AuctionWithId, TeamWithStats, PlayerWithId } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ARENA_GLASS_CARD,
  ARENA_CARD_HEADER,
  ARENA_GRADIENT_TEXT,
  ARENA_BTN_CYAN,
  ARENA_BTN_OUTLINE,
} from "@/components/arena/arena-classes";

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
}

interface AuctionLogResponse {
  _id: string;
  auctionId: string;
  action: string;
  details: Record<string, unknown>;
  timestamp: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const TEAM_BUDGET_COLOR_CLASS = "text-primary";

function getTeamColorClass(_teamId: string | null | undefined) {
  // Single consistent shade requested by admin UI.
  return TEAM_BUDGET_COLOR_CLASS;
}

export default function LiveAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [viewerCopied, setViewerCopied] = useState(false);
  
  const { data: auction } = useSWR<AuctionWithId>(`/api/auctions/${id}`, fetcher);
  const { data: teams, mutate: mutateTeams } = useSWR<TeamWithStats[]>(
    `/api/auctions/${id}/teams`,
    fetcher,
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
    }
  );
  const { data: players, mutate: mutatePlayers } = useSWR<PlayerWithId[]>(
    `/api/auctions/${id}/players`,
    fetcher,
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
    }
  );
  const { data: state, mutate: mutateState } = useSWR<AuctionStateResponse>(
    `/api/auctions/${id}/state?lite=1`,
    fetcher,
    {
      // Sync bids/round across other devices/tabs (local actions still use mutate()).
      refreshInterval: 2000,
      dedupingInterval: 1500,
      revalidateOnFocus: true,
    }
  );
  const { data: logs, mutate: mutateLogs } = useSWR<AuctionLogResponse[]>(
    `/api/auctions/${id}/logs`,
    fetcher,
    {
      refreshInterval: 4000,
      revalidateOnFocus: true,
    }
  );

  const [loading, setLoading] = useState(false);
  const [bidLoadingTeamId, setBidLoadingTeamId] = useState<string | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBid, setPendingBid] = useState<number | null>(null);
  const lastBidClickRef = useRef(0);

  const refreshAll = useCallback(() => {
    mutateTeams();
    mutatePlayers();
    mutateState();
    mutateLogs();
  }, [mutateTeams, mutatePlayers, mutateState, mutateLogs]);

  const bidCountByTeamId = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!state?.bidHistory) return counts;
    for (const b of state.bidHistory) {
      counts[b.teamId] = (counts[b.teamId] ?? 0) + 1;
    }
    return counts;
  }, [state?.bidHistory]);

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
      const publicBaseUrl = process.env.NEXT_PUBLIC_VIEWER_BASE_URL?.toString() ?? "";

      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const hostname =
        typeof window !== "undefined" ? window.location.hostname : "";

      // If the admin is opened on a real hosted domain (Vercel/custom),
      // always copy the current origin so it matches the deployed site.
      const isLocal =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.startsWith("192.168.");

      // IMPORTANT:
      // To make the link work on any device/network, always prefer a known public URL
      // (set `NEXT_PUBLIC_VIEWER_BASE_URL` on Vercel to your Production domain).
      const hasPublic = /^https?:\/\//i.test(publicBaseUrl);
      const baseUrl = hasPublic ? publicBaseUrl : origin;

      const url = `${baseUrl}/auction/${id}`;
      await navigator.clipboard.writeText(url);
      setViewerCopied(true);
      window.setTimeout(() => setViewerCopied(false), 2000);
    } catch {
      alert("Unable to copy viewer link. You can open the viewer instead.");
    }
  };

  const handlePlaceBid = async (teamId: string, amount: number) => {
    const now = Date.now();
    if (now - lastBidClickRef.current < 180) return;
    lastBidClickRef.current = now;

    // Make team selection feel instant and avoid blocking the whole UI.
    setBidLoadingTeamId(teamId);
    setError(null);
    const optimisticAt = new Date().toISOString();
    const teamName = teams?.find((t) => t._id === teamId)?.name ?? null;

    // Optimistic update for immediate UI feedback.
    mutateState(
      (prev) => {
        if (!prev) return prev;
        const nextBid = {
          teamId,
          teamName: teamName ?? "Team",
          amount: Number(amount),
          timestamp: optimisticAt,
        };
        return {
          ...prev,
          currentBid: Number(amount),
          currentTeamId: teamId,
          currentTeamName: teamName,
          bidHistory: [...prev.bidHistory, nextBid].slice(-20),
        };
      },
      false
    );
    
    try {
      const res = await fetch(`/api/auctions/${id}/state/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, amount }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        mutateState();
        setError(data.error);
      } else {
        setPendingBid(null);
        playTone(660, 80);
        // Revalidate only state immediately; other datasets can remain on interval.
        mutateState();
      }
    } finally {
      setBidLoadingTeamId(null);
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

  const handleUndoLatestBid = async () => {
    if (!state) return;
    if (!state.currentPlayer) return;
    if (state.bidHistory.length === 0) return;

    setUndoLoading(true);
    setError(null);

    // Optimistic: pop the latest bid and restore previous leader/base.
    mutateState(
      (prev) => {
        if (!prev) return prev;
        const nextHistory = prev.bidHistory.slice(0, -1);
        const last = nextHistory.length > 0 ? nextHistory[nextHistory.length - 1] : null;
        return {
          ...prev,
          currentBid: last ? last.amount : prev.currentPlayer?.basePrice ?? prev.currentBid,
          currentTeamId: last ? last.teamId : null,
          currentTeamName: last ? last.teamName : null,
          bidHistory: nextHistory,
        };
      },
      false
    );

    try {
      const res = await fetch(`/api/auctions/${id}/state/undo-bid`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        mutateState(); // rollback by revalidating
        setError(data.error || "Failed to undo bid");
      } else {
        playTone(330, 70);
        mutateState();
      }
    } finally {
      setUndoLoading(false);
    }
  };

  if (!auction || !teams || !players || !state) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="font-head-arena text-sm text-muted-foreground">Loading auction…</div>
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
  return (
    <div className="min-h-0 p-4 lg:p-6">
      <div className="mx-auto max-w-[1800px]">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 md:gap-4">
            <Link href={`/admin/auction/${id}`}>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="font-head-arena text-xl font-extrabold tracking-tight break-words lg:text-2xl">
                {auction.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                <span className={cn(ARENA_GRADIENT_TEXT, "font-head-arena font-semibold")}>Live</span>{" "}
                auction controller
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
            <Badge
              className="animate-pulse border border-primary/40 bg-primary/12 font-head-arena text-[10px] font-bold uppercase tracking-[0.15em] text-arena-cyan shadow-lg shadow-primary/25"
            >
              LIVE
            </Badge>
            <Link href={`/auction/${id}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className={cn("gap-2", ARENA_BTN_OUTLINE)}>
                Open Viewer
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={handleCopyViewerLink}
              className={cn("gap-2", ARENA_BTN_OUTLINE)}
              disabled={viewerCopied}
            >
              {viewerCopied ? "Copied" : "Copy Viewer Link"}
            </Button>
          </div>
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
            <Card className={cn(ARENA_GLASS_CARD, "overflow-hidden")}>
              <CardHeader className={cn(ARENA_CARD_HEADER, "py-5")}>
                <CardTitle className="font-head-arena flex items-center gap-2 text-base">
                  <User className="h-5 w-5 text-primary" />
                  Active <span className={ARENA_GRADIENT_TEXT}>Spotlight</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {state.currentPlayer ? (
                  <div className="text-center">
                    <h2 className="mb-2 font-head-arena text-3xl font-extrabold uppercase italic tracking-tight text-foreground lg:text-4xl">
                      {state.currentPlayer.name}
                    </h2>
                    <Badge
                      variant="outline"
                      className="mb-4 border border-primary/30 bg-primary/8 px-4 py-1 font-head-arena text-lg text-arena-cyan"
                    >
                      Base: {state.currentPlayer.basePrice} pts
                    </Badge>

                    {/* Current Bid Display */}
                    <div
                      className={cn(
                        "mt-6 rounded-2xl border p-6 transition-[box-shadow,background-color] duration-300",
                        state.currentTeamId
                          ? "arena-glow-bid border-primary/25 bg-primary/10"
                          : "border-border/60 bg-secondary/35"
                      )}
                    >
                      <p className="mb-1 font-head-arena text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Current high bid
                      </p>
                      <p className="font-head-arena text-5xl font-extrabold text-arena-cyan lg:text-6xl">
                        {currentBid}
                      </p>
                      <p className="mt-2 text-lg">
                        {state.currentTeamName ? (
                          <span className="font-semibold text-primary">{state.currentTeamName}</span>
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
                      <span className="min-w-[100px] font-head-arena text-2xl font-bold">
                        {pendingBid !== null ? (
                          <span className="text-primary">{pendingBid}</span>
                        ) : (
                          currentBid
                        )}
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
                        variant="outline"
                        onClick={handleUndoLatestBid}
                        disabled={loading || undoLoading || state.bidHistory.length === 0}
                        className="gap-2 border-unsold/45 text-unsold hover:bg-unsold/12"
                      >
                        <Undo2 className="h-4 w-4" />
                        Undo Bid
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
                        className={cn("gap-2 font-head-arena text-xs font-bold uppercase tracking-wider", ARENA_BTN_CYAN)}
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

            {/* Team bid picker — high-contrast cards, matches arena theme */}
            {state.currentPlayer && (
              <Card className={cn(ARENA_GLASS_CARD, "overflow-hidden")}>
                <CardHeader className={cn(ARENA_CARD_HEADER, "py-5")}>
                  <CardTitle className="font-head-arena flex flex-wrap items-center gap-2 text-base sm:text-lg">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-arena-magenta/15 ring-1 ring-arena-magenta/25">
                      <Users className="h-5 w-5 text-arena-magenta" />
                    </span>
                    Place bid for team
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2 text-sm leading-relaxed">
                    <MousePointerClick className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      Tap a team to place{" "}
                      <span className="font-mono font-semibold tabular-nums text-primary">
                        {pendingBid ?? minLegalBid}
                      </span>{" "}
                      pts for this round.
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-5 pt-0 sm:px-6">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {teams.map((team) => {
                      const isLeading = state.currentTeamId === team._id;
                      const bidAmount = pendingBid ?? minLegalBid;
                      const canAffordBid = team.maxBid >= bidAmount;
                      const bidCount = bidCountByTeamId[team._id] ?? 0;
                      const canTeamBid = !isLeading;
                      const noSlots = team.remainingSlots <= 0;
                      const tooHigh = !canAffordBid;
                      const isBusy = bidLoadingTeamId === team._id;
                      const isDisabled =
                        loading ||
                        isBusy ||
                        !canTeamBid ||
                        tooHigh ||
                        noSlots;
                      const dimWhenBlocked = isDisabled && !isLeading;

                      return (
                        <button
                          key={team._id}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => handlePlaceBid(team._id, bidAmount)}
                          className={cn(
                            "relative rounded-2xl border p-4 text-left transition-all duration-200",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                            "border-border/80 bg-gradient-to-b from-secondary/95 to-card text-foreground shadow-sm",
                            !isDisabled && "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/10",
                            isLeading &&
                              "arena-glow-bid border-primary/55 bg-gradient-to-b from-primary/30 to-primary/15 ring-1 ring-primary/40",
                            isDisabled && "pointer-events-none hover:translate-y-0",
                            dimWhenBlocked && "opacity-[0.42] hover:border-border/80 hover:shadow-none",
                            isBusy && "ring-2 ring-primary/50"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-head-arena text-base font-bold tracking-tight text-foreground">
                              {team.name}
                            </span>
                            {isLeading ? (
                              <Badge className="shrink-0 border border-primary/35 bg-primary/20 text-[10px] font-bold uppercase tracking-wider text-arena-cyan">
                                Leading
                              </Badge>
                            ) : null}
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-border/60 bg-black/30 px-2.5 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Budget
                              </p>
                              <p
                                className={cn(
                                  "mt-0.5 font-mono text-sm font-bold tabular-nums",
                                  getTeamColorClass(team._id)
                                )}
                              >
                                {team.remainingBudget}
                              </p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-black/30 px-2.5 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Max bid
                              </p>
                              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-arena-magenta">
                                {team.maxBid}
                              </p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-black/30 px-2.5 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Slots
                              </p>
                              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-foreground">
                                {team.remainingSlots}
                              </p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-black/30 px-2.5 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Bids
                              </p>
                              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-foreground">
                                {bidCount}
                              </p>
                            </div>
                          </div>

                          {isLeading && (
                            <p className="mt-2.5 text-[11px] text-muted-foreground">
                              Current high bidder — cannot bid again until another team raises.
                            </p>
                          )}
                          {noSlots && !isLeading && (
                            <p className="mt-2.5 text-[11px] font-medium text-unsold">Roster full — cannot bid.</p>
                          )}
                          {tooHigh && !noSlots && !isLeading && (
                            <p className="mt-2.5 text-[11px] font-medium text-unsold">
                              Max bid below {bidAmount} pts for this amount.
                            </p>
                          )}
                        </button>
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
            <Card className={ARENA_GLASS_CARD}>
              <CardHeader className={cn(ARENA_CARD_HEADER, "py-4")}>
                <CardTitle className="font-head-arena flex items-center gap-2 text-base">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Budget tracker
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
                          className={cn(
                            "rounded-xl border border-border/60 bg-secondary/30 p-3 transition-[box-shadow] duration-200",
                            isLeading && "arena-glow-bid border-primary/28 bg-primary/6"
                          )}
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
                          <div className="mb-2 h-2 overflow-hidden rounded-full bg-border/50">
                            <div
                              className="h-full bg-gradient-to-r from-primary to-primary-end transition-all duration-500"
                              style={{ width: `${budgetPercent}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span className={`font-medium ${getTeamColorClass(team._id)}`}>
                              {team.remainingBudget} / {team.totalBudget} pts
                            </span>
                            <span>{team.playersCount} / {auction.maxPlayersPerTeam} players</span>
                          </div>
                          <p className="mt-1 text-xs">
                            Max bid: <span className="font-medium text-arena-magenta">{team.maxBid}</span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Recent Bid History */}
            <Card className={ARENA_GLASS_CARD}>
              <CardHeader className={cn(ARENA_CARD_HEADER, "py-4")}>
                <CardTitle className="font-head-arena text-base">
                  Recent <span className={ARENA_GRADIENT_TEXT}>bids</span>
                </CardTitle>
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
                          className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/35 p-2 text-sm"
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
            <Card className={ARENA_GLASS_CARD}>
              <CardHeader className={cn(ARENA_CARD_HEADER, "py-4")}>
                <CardTitle className="font-head-arena text-base">
                  Auction <span className="text-arena-magenta">log</span>
                </CardTitle>
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
                            className="flex items-start justify-between gap-3 rounded-lg border border-border/60 border-l-[3px] border-l-arena-magenta/55 bg-secondary/30 p-2"
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
            <Card className={ARENA_GLASS_CARD}>
              <CardHeader className={cn(ARENA_CARD_HEADER, "py-4")}>
                <CardTitle className="font-head-arena text-base">Player pool</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-border/60 bg-secondary/35 p-2">
                    <p className="text-2xl font-bold text-available">
                      {availablePlayers.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Available</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/35 p-2">
                    <p className="text-2xl font-bold text-sold">
                      {players.filter((p) => p.status === "sold").length}
                    </p>
                    <p className="text-xs text-muted-foreground">Sold</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/35 p-2">
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
