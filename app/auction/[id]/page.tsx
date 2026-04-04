"use client";

import { useState, useEffect, useRef, use, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Users, DollarSign, Gavel, ChevronDown, Package, Ban, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { auctionDateToUtcMs, formatAuctionStartLocal } from "@/lib/auction-date";

/** Payload from GET /api/auctions/[id]/stream (SSE); drives live viewer without polling /state?lite=1 */
interface StreamPayload {
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
    updatedAt: string | null;
    lastAction: "sold" | "unsold" | null;
    lastActionAt: string | null;
    lastActionPlayerName: string | null;
    lastActionTeamName: string | null;
    lastActionPrice: number | null;
    bidHistory: Array<{ teamName: string; amount: number; timestamp?: string }>;
  } | null;
  currentPlayer: { _id: string; name: string; basePrice: number } | null;
  teams: Array<{
    _id?: string;
    name: string;
    captainName?: string;
    totalBudget: number;
    remainingBudget: number;
    playersCount: number;
    remainingSlots: number;
    maxBid: number;
  }>;
  playerStats: { available: number; sold: number; unsold: number };
  timestamp: string;
  error?: string;
}

const jsonFetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : "Request failed";
    throw new Error(msg);
  }
  return data as T;
};

export default function AuctionViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  /** Live viewer: which pool list to show above sold players */
  const [poolFilter, setPoolFilter] = useState<"available" | "unsold" | null>(null);
  const soldSectionRef = useRef<HTMLDivElement>(null);
  const [streamData, setStreamData] = useState<StreamPayload | null>(null);
  const [completionAnimation, setCompletionAnimation] = useState<{
    action: "sold" | "unsold";
    at: string;
  } | null>(null);
  const lastCompletionAtRef = useRef<string | null>(null);

  const {
    data: auctionMeta,
    error: auctionErr,
    isLoading: auctionLoading,
    mutate: mutateAuction,
  } = useSWR<AuctionWithId>(`/api/auctions/${id}`, jsonFetcher, {
    refreshInterval: (data) => (data?.status === "active" ? 0 : 20_000),
    revalidateOnFocus: true,
  });

  const auctionReady = Boolean(auctionMeta) && !auctionErr;
  const isActive = auctionMeta?.status === "active";

  const { data: allTeams } = useSWR<TeamWithStats[]>(
    auctionReady && !isActive ? `/api/auctions/${id}/teams` : null,
    jsonFetcher,
    { refreshInterval: 8000, revalidateOnFocus: true }
  );
  const { data: allPlayers, mutate: mutatePlayers } = useSWR<PlayerWithId[]>(
    auctionReady ? `/api/auctions/${id}/players` : null,
    jsonFetcher,
    {
      // During live auction we rely on SSE (and we trigger `mutatePlayers()` only when `currentPlayerId` changes).
      // This avoids unnecessary polling and keeps the network clean.
      refreshInterval: isActive ? 0 : 8000,
      revalidateOnFocus: !isActive,
    }
  );

  useEffect(() => {
    if (!isActive || !id) {
      setStreamData(null);
      return;
    }

    const es = new EventSource(`/api/auctions/${id}/stream`);

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StreamPayload;
        setStreamData(parsed);
        if (parsed.auction?.status && parsed.auction.status !== "active") {
          void mutateAuction();
        }
      } catch (e) {
        console.error("SSE parse error:", e);
      }
    };

    return () => {
      es.close();
    };
  }, [id, isActive, mutateAuction]);

  const prevPlayerIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isActive || !streamData) return;
    const pid = streamData.currentPlayer?._id ?? null;
    if (prevPlayerIdRef.current !== null && pid !== prevPlayerIdRef.current) {
      void mutatePlayers();
    }
    prevPlayerIdRef.current = pid;
  }, [streamData?.currentPlayer?._id, isActive, mutatePlayers]);

  // Trigger sold/unsold animation when admin presses those buttons.
  useEffect(() => {
    if (!isActive || !streamData?.state?.lastActionAt) return;
    const at = streamData.state.lastActionAt;
    if (lastCompletionAtRef.current === at) return;

    const msAgo = Date.now() - new Date(at).getTime();
    // Avoid animating old events when user opens viewer after the action.
    if (Number.isFinite(msAgo) && msAgo > 30000) return;

    lastCompletionAtRef.current = at;
    const action = streamData.state.lastAction;
    if (action !== "sold" && action !== "unsold") return;

    setCompletionAnimation({ action, at });
    const t = window.setTimeout(() => setCompletionAnimation(null), 1600);
    return () => window.clearTimeout(t);
  }, [isActive, streamData?.state?.lastAction, streamData?.state?.lastActionAt]);

  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const playerStats = useMemo(() => {
    if (isActive && streamData?.playerStats) return streamData.playerStats;
    if (!allPlayers) return { available: 0, sold: 0, unsold: 0 };
    return {
      available: allPlayers.filter((p) => p.status === "available").length,
      sold: allPlayers.filter((p) => p.status === "sold").length,
      unsold: allPlayers.filter((p) => p.status === "unsold").length,
    };
  }, [isActive, streamData?.playerStats, allPlayers]);

  const availablePlayersSorted = useMemo(() => {
    if (!allPlayers) return [];
    return allPlayers
      .filter((p) => p.status === "available")
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [allPlayers]);

  const unsoldPlayersSorted = useMemo(() => {
    if (!allPlayers) return [];
    return allPlayers
      .filter((p) => p.status === "unsold")
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [allPlayers]);

  const togglePoolFilter = (key: "available" | "unsold") => {
    setPoolFilter((prev) => (prev === key ? null : key));
  };

  const scrollToSold = () => {
    setPoolFilter(null);
    soldSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const loadingInitial =
    (auctionLoading && !auctionErr) || (auctionReady && isActive && streamData === null);

  if (loadingInitial) {
    return (
      <div className="app-public-shell">
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-xl bg-primary/20" />
            <p className="animate-pulse text-muted-foreground">Loading auction…</p>
          </div>
        </div>
      </div>
    );
  }

  if (auctionErr || !auctionMeta) {
    return (
      <div className="app-public-shell">
        <header className="app-glass-header">
          <div className="container mx-auto flex h-14 items-center px-4">
            <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
              <BrandMark className="h-9 w-9" iconClassName="h-5 w-5" />
              Cricket Auction
            </Link>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="app-surface-card max-w-md border-0">
            <CardContent className="pt-8 pb-8 text-center">
              <p className="text-destructive">{auctionErr?.message ?? "Auction not found"}</p>
              <Button asChild className="mt-6" variant="outline">
                <Link href="/">Back to home</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isActive && streamData?.error) {
    return (
      <div className="app-public-shell">
        <header className="app-glass-header">
          <div className="container mx-auto flex h-14 items-center px-4">
            <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
              <BrandMark className="h-9 w-9" iconClassName="h-5 w-5" />
              Cricket Auction
            </Link>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="app-surface-card max-w-md border-0">
            <CardContent className="pt-8 pb-8 text-center">
              <p className="text-destructive">{streamData.error}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (auctionMeta.status !== "active") {
    const teamNameById = new Map<string, string>(
      (allTeams ?? []).map((t) => [t._id, t.name])
    );
    const soldPlayers = (allPlayers ?? []).filter((p) => p.status === "sold");
    const isDraft = auctionMeta.status === "draft";

    const startsAtMs = auctionDateToUtcMs(auctionMeta.date);
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
      <div className="app-public-shell">
        <header className="app-glass-header sticky top-0 z-10">
          <div className="container mx-auto flex h-14 items-center justify-between gap-3 px-4">
            <Link href="/" className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
              <BrandMark className="h-9 w-9 shrink-0" iconClassName="h-5 w-5" />
              <span className="truncate">Cricket Auction</span>
            </Link>
          </div>
        </header>

        <main className="flex flex-1 flex-col px-4 py-8">
          <Card className="app-surface-card mx-auto w-full max-w-4xl border-0 py-0">
            <CardHeader className="border-b border-border/50 bg-secondary/20 pb-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/20">
                <Gavel className="h-9 w-9 text-primary" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight sm:text-3xl">{auctionMeta.name}</CardTitle>
            </CardHeader>
            <CardContent className="pt-8">
              <div className="flex flex-col items-center text-center gap-3">
                <Badge variant="outline" className="text-lg px-4 py-2">
                  {auctionMeta.status === "draft" ? "Auction Not Started" : "Auction Completed"}
                </Badge>
                {hasStartsAt && (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-secondary/30 px-5 py-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Scheduled start
                    </p>
                    <p className="text-center text-lg font-semibold tracking-tight">
                      {formatAuctionStartLocal(startsAtMs)}
                    </p>
                  </div>
                )}
                {isDraft && hasStartsAt && (
                  <div
                    className={cn(
                      "rounded-xl border px-5 py-4 text-center",
                      hasCountdown
                        ? "border-primary/35 bg-primary/10"
                        : "border-border/60 bg-muted/20"
                    )}
                  >
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {hasCountdown ? "Time until start" : "Status"}
                    </p>
                    <p
                      className={cn(
                        "mt-1 font-head-arena text-2xl font-bold tabular-nums tracking-tight",
                        hasCountdown ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      {hasCountdown ? formatCountdown(msRemaining) : "Starting soon"}
                    </p>
                  </div>
                )}
                {isDraft && !hasStartsAt && (
                  <Badge variant="secondary" className="text-base px-4 py-2">
                    No start time set — check back soon
                  </Badge>
                )}
                <p className="text-muted-foreground">
                  {auctionMeta.status === "draft"
                    ? "The auction has not started yet. Please wait for the auctioneer to begin."
                    : "This auction has been completed. Here are the sold results."}
                </p>
              </div>

              <div className="mt-8">
                <h3 className="mb-4 text-lg font-bold tracking-tight">Sold players</h3>
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
        </main>

        <footer className="mt-auto border-t border-border/60 bg-card/50 py-6 backdrop-blur-md">
          <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
            <p>Designed and Developed By Kuldeep Ahir</p>
          </div>
        </footer>
      </div>
    );
  }

  if (!streamData) {
    return (
      <div className="app-public-shell">
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="text-center">
            <div className="mx-auto mb-4 h-2 w-32 overflow-hidden rounded-full bg-border">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
            <p className="text-muted-foreground">Connecting to live feed…</p>
          </div>
        </div>
      </div>
    );
  }

  const stateLite = streamData.state;
  const currentPlayer = streamData.currentPlayer;
  const teamsLive = streamData.teams;

  const recentBidCounts: Record<string, number> = {};
  (stateLite?.bidHistory ?? []).forEach((b) => {
    recentBidCounts[b.teamName] = (recentBidCounts[b.teamName] ?? 0) + 1;
  });

  const teamNameById = new Map<string, string>(
    teamsLive.filter((t) => t._id).map((t) => [t._id as string, t.name])
  );
  const soldPlayers = (allPlayers ?? []).filter((p) => p.status === "sold");
  const selectedTeamName =
    selectedTeamId ? teamNameById.get(selectedTeamId) ?? "Selected Team" : null;
  const selectedTeamSoldPlayers = selectedTeamId
    ? soldPlayers.filter((p) => p.soldTo === selectedTeamId)
    : [];

  return (
    <div className="app-public-shell flex flex-col">
      <header className="app-glass-header sticky top-0 z-10">
        <div className="container mx-auto flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link href="/" className="shrink-0" aria-label="Cricket Auction home">
              <BrandMark className="h-9 w-9" iconClassName="h-5 w-5" />
            </Link>
            <h1 className="truncate text-sm font-bold tracking-tight sm:text-lg">{auctionMeta.name}</h1>
          </div>
          <Badge
            variant="default"
            className="shrink-0 animate-pulse border border-primary/30 bg-primary/90 shadow-md shadow-primary/20"
          >
            LIVE
          </Badge>
        </div>
      </header>

      <main className="container mx-auto flex-1 px-4 py-6">
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
              <CardContent className="p-4 sm:p-6 relative">
                {completionAnimation && (
                  <div
                    className={[
                      "absolute inset-0 z-10 flex items-center justify-center text-center px-4 pointer-events-none",
                      completionAnimation.action === "sold"
                        ? "bg-sold/20 border border-sold/50"
                        : "bg-unsold/20 border border-unsold/45",
                    ].join(" ")}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div
                        className={
                          completionAnimation.action === "sold"
                            ? "text-sold font-bold text-4xl sm:text-5xl animate-pulse"
                            : "text-unsold font-bold text-4xl sm:text-5xl animate-bounce"
                        }
                      >
                        {completionAnimation.action === "sold" ? "SOLD" : "UNSOLD"}
                      </div>
                      <div className="text-sm sm:text-base text-muted-foreground animate-pulse">
                        {streamData?.state?.lastActionPlayerName
                          ? streamData.state.lastActionPlayerName
                          : "Player"}
                        {completionAnimation.action === "sold" && typeof streamData?.state?.lastActionPrice === "number"
                          ? ` • ${streamData.state.lastActionPrice} pts`
                          : ""}
                      </div>
                    </div>
                  </div>
                )}
                {currentPlayer ? (
                  <div className="text-center">
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-3 break-words">
                      {currentPlayer.name}
                    </h2>
                    <Badge variant="outline" className="text-lg px-4 py-1">
                      Base: {currentPlayer.basePrice} pts
                    </Badge>

                    {/* Current Bid Display */}
                    <div
                      className={`
                        mt-8 p-8 rounded-xl transition-glow
                        ${stateLite?.currentTeamId ? "bg-primary/10 glow-primary" : "bg-secondary"}
                      `}
                    >
                      <p className="text-muted-foreground mb-2">Current Bid</p>
                      <p className="text-4xl sm:text-6xl lg:text-7xl font-bold text-primary">
                        {stateLite?.currentBid || currentPlayer.basePrice}
                      </p>
                      <p className="text-xl mt-4">
                        {stateLite?.currentTeamName ? (
                          <span className="text-primary font-semibold">
                            {stateLite.currentTeamName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Waiting for bids...</span>
                        )}
                      </p>
                    </div>

                    {/* Bid History */}
                    {stateLite?.bidHistory && stateLite.bidHistory.length > 0 && (
                      <div className="mt-6">
                        <p className="text-sm text-muted-foreground mb-3">Recent Bids</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {[...stateLite.bidHistory].reverse().slice(0, 5).map((bid, i) => (
                            <Badge
                              key={bid.timestamp ? `${bid.timestamp}-${i}` : `${bid.teamName}-${bid.amount}-${i}`}
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

            {/* Player pool stats — tap Available / Unsold to browse; Sold scrolls to list below */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              <button
                type="button"
                onClick={() => togglePoolFilter("available")}
                aria-pressed={poolFilter === "available"}
                className={cn(
                  "rounded-2xl border bg-card/90 p-5 text-left shadow-sm transition-all duration-200",
                  "hover:border-available/45 hover:bg-available/5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-available/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  poolFilter === "available" &&
                    "border-available/50 bg-available/10 shadow-[0_0_28px_-6px] shadow-available/35 ring-1 ring-available/25"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <Package className="h-5 w-5 shrink-0 text-available opacity-90" aria-hidden />
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                      poolFilter === "available" && "rotate-180 text-available"
                    )}
                    aria-hidden
                  />
                </div>
                <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-available">
                  {playerStats.available}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">Available</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Tap to show all names</p>
              </button>

              <button
                type="button"
                onClick={scrollToSold}
                className={cn(
                  "rounded-2xl border bg-card/90 p-5 text-left shadow-sm transition-all duration-200",
                  "hover:border-sold/45 hover:bg-sold/5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <Trophy className="h-5 w-5 shrink-0 text-sold opacity-90" aria-hidden />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    View list
                  </span>
                </div>
                <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-sold">
                  {playerStats.sold}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">Sold</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Jump to results below</p>
              </button>

              <button
                type="button"
                onClick={() => togglePoolFilter("unsold")}
                aria-pressed={poolFilter === "unsold"}
                className={cn(
                  "rounded-2xl border bg-card/90 p-5 text-left shadow-sm transition-all duration-200",
                  "hover:border-unsold/45 hover:bg-unsold/5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-unsold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  poolFilter === "unsold" &&
                    "border-unsold/50 bg-unsold/10 shadow-[0_0_28px_-6px] shadow-unsold/30 ring-1 ring-unsold/25"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <Ban className="h-5 w-5 shrink-0 text-unsold opacity-90" aria-hidden />
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                      poolFilter === "unsold" && "rotate-180 text-unsold"
                    )}
                    aria-hidden
                  />
                </div>
                <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-unsold">
                  {playerStats.unsold}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">Unsold</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Tap to show all names</p>
              </button>
            </div>

            {/* Filtered pool list (available or unsold) */}
            {poolFilter && (
              <Card
                className={cn(
                  "mt-4 overflow-hidden border shadow-md",
                  poolFilter === "available" && "border-available/30 bg-gradient-to-b from-available/5 to-card",
                  poolFilter === "unsold" && "border-unsold/30 bg-gradient-to-b from-unsold/5 to-card"
                )}
              >
                <CardHeader className="space-y-1 border-b border-border/60 py-4">
                  <CardTitle
                    className={cn(
                      "flex items-center gap-2 text-lg",
                      poolFilter === "available" && "text-available",
                      poolFilter === "unsold" && "text-unsold"
                    )}
                  >
                    {poolFilter === "available" ? (
                      <>
                        <Package className="h-5 w-5" />
                        Available players
                      </>
                    ) : (
                      <>
                        <Ban className="h-5 w-5" />
                        Unsold players
                      </>
                    )}
                    <Badge variant="secondary" className="ml-auto font-mono text-xs tabular-nums">
                      {poolFilter === "available"
                        ? availablePlayersSorted.length
                        : unsoldPlayersSorted.length}
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {poolFilter === "available"
                      ? "Still in the pool — not yet sold or marked unsold."
                      : "Passed without a sale in this auction."}
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  {!allPlayers ? (
                    <p className="p-6 text-sm text-muted-foreground">Loading player list…</p>
                  ) : poolFilter === "available" && availablePlayersSorted.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">No available players right now.</p>
                  ) : poolFilter === "unsold" && unsoldPlayersSorted.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">No unsold players yet.</p>
                  ) : (
                    <ScrollArea className="h-[min(320px,50vh)] sm:h-[280px]">
                      <ul className="divide-y divide-border/50 p-2">
                        {(poolFilter === "available" ? availablePlayersSorted : unsoldPlayersSorted).map(
                          (p) => {
                            const isOnBlock =
                              poolFilter === "available" && currentPlayer?._id === p._id;
                            return (
                              <li
                                key={p._id}
                                className={cn(
                                  "flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-3 sm:px-4",
                                  isOnBlock && "bg-primary/10 ring-1 ring-primary/25"
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold leading-tight">{p.name}</p>
                                  {isOnBlock && (
                                    <p className="mt-0.5 text-xs font-medium text-primary">
                                      On the block now
                                    </p>
                                  )}
                                </div>
                                <Badge variant="outline" className="shrink-0 tabular-nums">
                                  Base {p.basePrice} pts
                                </Badge>
                              </li>
                            );
                          }
                        )}
                      </ul>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Sold results — always visible under pool tools */}
            <div ref={soldSectionRef} id="viewer-sold-section" className="mt-6 scroll-mt-24">
              <Card className="overflow-hidden border-sold/25 bg-gradient-to-br from-card via-card to-sold/5 shadow-md ring-1 ring-border/80">
                <CardHeader className="border-b border-border/60 bg-sold/5 pb-4">
                  <div className="flex flex-wrap items-center gap-2 gap-y-1">
                    <Trophy className="h-5 w-5 text-sold" />
                    <CardTitle className="text-lg sm:text-xl">Sold players</CardTitle>
                    <Badge className="bg-sold/15 text-sold hover:bg-sold/20 border-sold/30">
                      {soldPlayers.length} total
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Player, winning team, and points — updates live during the auction.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[min(360px,55vh)] sm:h-[300px]">
                    <div className="p-4">
                      {!allPlayers ? (
                        <p className="text-sm text-muted-foreground">Loading results…</p>
                      ) : soldPlayers.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 py-12 text-center">
                          <p className="text-sm font-medium text-muted-foreground">
                            No sales yet
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Sold players will appear here as the auction progresses.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-border/60">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-border/60 hover:bg-transparent">
                                <TableHead className="w-[40%] text-foreground">Player</TableHead>
                                <TableHead className="text-foreground">Sold to</TableHead>
                                <TableHead className="text-right text-foreground">Points</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {soldPlayers.map((p) => (
                                <TableRow
                                  key={p._id}
                                  className="border-border/50 transition-colors hover:bg-sold/5"
                                >
                                  <TableCell className="font-semibold">{p.name}</TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {p.soldTo ? teamNameById.get(p.soldTo) ?? "—" : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono tabular-nums text-sold">
                                    {typeof p.soldPrice === "number" ? p.soldPrice : "—"}
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
                    {teamsLive.map((team) => {
                      const budgetPercent = (team.remainingBudget / team.totalBudget) * 100;
                      const isLeading = stateLite?.currentTeamId === team._id;

                      return (
                        <div
                          key={team._id ?? team.name}
                          className={`
                            p-4 rounded-lg border transition-glow cursor-pointer
                            ${isLeading ? "border-primary glow-primary bg-primary/5" : ""}
                            ${selectedTeamId === team._id ? "border-primary bg-primary/10" : ""}
                          `}
                          onClick={() => team._id && setSelectedTeamId(team._id)}
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
                              {team.playersCount} / {auctionMeta.maxPlayersPerTeam}
                            </div>
                          </div>
                          <p className="text-xs mt-2 text-muted-foreground">
                            Max bid:{" "}
                            <span className="font-medium text-arena-magenta">{team.maxBid}</span>{" "}
                            pts
                          </p>
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

      <footer className="mt-auto border-t border-border/60 bg-card/50 py-6 backdrop-blur-md">
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
