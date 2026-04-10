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
  AlertCircle,
  MousePointerClick,
  ChevronRight,
  ExternalLink,
  Link2,
  Copy,
  Radio,
  Wallet,
  Trophy,
  Ban,
} from "lucide-react";
import type { AuctionWithId, TeamWithStats, PlayerWithId } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ARENA_GLASS_CARD,
  ARENA_CARD_HEADER,
  ARENA_GRADIENT_TEXT,
  ARENA_BTN_CYAN,
  ARENA_BTN_OUTLINE,
  ARENA_MANAGE_HERO,
  ARENA_WORKSPACE_SHELL,
  ARENA_TABLE_FRAME,
  ARENA_DIALOG_SURFACE,
} from "@/components/arena/arena-classes";
import { StatTile } from "@/components/arena/stat-tile";
import { resolvePublicViewerBaseUrl } from "@/lib/public-url";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuctionSocket, type AuctionLiveMutators, type BidEvent } from "@/lib/use-auction-live-sync";

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

// Extracted outside the component: pure utility with no React deps — never recreated on render.
function playTone(frequency: number, durationMs = 90) {
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
}

const TEAM_BUDGET_COLOR_CLASS = "text-sky-400";

function getTeamColorClass(_teamId: string | null | undefined) {
  // Single consistent shade requested by admin UI.
  return TEAM_BUDGET_COLOR_CLASS;
}

const LIVE_FALLBACK_POLL_MS = 12_000;

export default function LiveAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [viewerCopied, setViewerCopied] = useState(false);
  const [poolDialog, setPoolDialog] = useState<null | "available" | "sold" | "unsold">(null);
  const [auctionWsConnected, setAuctionWsConnected] = useState(false);
  const mutatorsRef = useRef<AuctionLiveMutators>({});

  const swrLiveOpts = useMemo(
    () => ({
      refreshInterval: auctionWsConnected ? 0 : LIVE_FALLBACK_POLL_MS,
      revalidateOnFocus: !auctionWsConnected,
      dedupingInterval: 2000,
    }),
    [auctionWsConnected]
  );

  const { data: auction } = useSWR<AuctionWithId>(`/api/auctions/${id}`, fetcher, swrLiveOpts);
  const { data: teams, mutate: mutateTeams } = useSWR<TeamWithStats[]>(
    `/api/auctions/${id}/teams`,
    fetcher,
    swrLiveOpts
  );
  const { data: players, mutate: mutatePlayers } = useSWR<PlayerWithId[]>(
    `/api/auctions/${id}/players`,
    fetcher,
    swrLiveOpts
  );
  const { data: state, mutate: mutateState } = useSWR<AuctionStateResponse>(
    `/api/auctions/${id}/state?lite=1`,
    fetcher,
    swrLiveOpts
  );
  const { data: logs, mutate: mutateLogs } = useSWR<AuctionLogResponse[]>(
    `/api/auctions/${id}/logs`,
    fetcher,
    swrLiveOpts
  );

  mutatorsRef.current = {
    mutateState,
    mutateTeams,
    mutatePlayers,
    mutateLogs,
    patchState: (event: BidEvent) => {
      // Echo suppression: skip if this WS message was triggered by our own bid.
      // The optimistic update in handlePlaceBid already applied the same values.
      if (event.requestId && event.requestId === pendingRequestIdRef.current) return;
      mutateState(
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            currentBid: event.currentBid,
            currentTeamId: event.currentTeamId,
            currentTeamName: event.currentTeamName,
            bidHistory: [
              ...prev.bidHistory,
              {
                teamId: event.currentTeamId ?? "",
                teamName: event.bidEntry.teamName,
                amount: event.bidEntry.amount,
                timestamp: event.bidEntry.timestamp,
              },
            ].slice(-20),
          };
        },
        false // no revalidation — event is authoritative
      );
    },
  };
  useAuctionSocket(id, mutatorsRef, setAuctionWsConnected);

  const [loading, setLoading] = useState(false);
  const [bidLoadingTeamId, setBidLoadingTeamId] = useState<string | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBid, setPendingBid] = useState<number | null>(null);
  const lastBidClickRef = useRef(0);
  /** Tracks the requestId of the admin's own in-flight bid for echo suppression. */
  const pendingRequestIdRef = useRef<string | null>(null);

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

  // Memoized player lists — recomputed only when `players` changes, not on every render
  // (e.g. pendingBid / loading state changes no longer trigger O(n log n) sorts).
  const playerLists = useMemo(() => {
    if (!players) return null;
    const available = players.filter((p) => p.status === "available");
    const unsoldReplay = players.filter((p) => p.status === "unsold" && p.unsoldReplayed !== true);
    const sold = players.filter((p) => p.status === "sold");
    const unsold = players.filter((p) => p.status === "unsold");
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);
    return {
      available,
      unsoldReplayCandidates: unsoldReplay,
      pickableCount: available.length + unsoldReplay.length,
      soldCount: sold.length,
      unsoldCount: unsold.length,
      soldList: sold.slice().sort(byName),
      unsoldList: unsold.slice().sort(byName),
      availableSorted: available.slice().sort(byName),
    };
  }, [players]);

  // Memoized lookup map — rebuilt only when teams list changes.
  const teamNameById = useMemo(
    () => new Map(teams?.map((t) => [t._id, t.name]) ?? []),
    [teams]
  );

  const handlePickRandom = useCallback(async () => {
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
  }, [id, refreshAll]);

  const handleCopyViewerLink = async () => {
    try {
      const base = resolvePublicViewerBaseUrl();
      if (!base) {
        alert("Set NEXT_PUBLIC_VIEWER_BASE_URL or open admin from your public site to copy a full link.");
        return;
      }
      await navigator.clipboard.writeText(`${base}/auction/${id}`);
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

    setBidLoadingTeamId(teamId);
    setError(null);
    const optimisticAt = new Date().toISOString();
    const teamName = teams?.find((t) => t._id === teamId)?.name ?? null;

    // Generate a requestId so the WS echo of this bid can be suppressed —
    // the optimistic update below already reflects the correct state.
    const requestId = crypto.randomUUID();
    pendingRequestIdRef.current = requestId;

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
        body: JSON.stringify({ teamId, amount, requestId }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        pendingRequestIdRef.current = null;
        mutateState(); // roll back optimistic update
        setError(data.error);
      } else {
        setPendingBid(null);
        playTone(660, 80);
        // Clear the echo-suppression token — any subsequent WS bid message
        // (from a different admin or a delayed delivery) should be applied.
        pendingRequestIdRef.current = null;
        // If WS is not connected, revalidate so the fallback poll picks up
        // the confirmed state from the server.
        if (!auctionWsConnected) mutateState();
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
      <div className="mx-auto max-w-[1800px] px-4 py-10 sm:px-6">
        <div
          className={cn(
            ARENA_MANAGE_HERO,
            "animate-pulse px-8 py-20 text-center font-head-arena text-sm tracking-wide text-muted-foreground"
          )}
        >
          Loading live control…
        </div>
      </div>
    );
  }

  // All player list computations are memoized above (playerLists / teamNameById).
  // Destructure here for readable usage in JSX — these assignments are O(1).
  const {
    available: availablePlayers,
    pickableCount: pickablePlayersCount,
    soldCount,
    unsoldCount,
    soldList: soldPlayersList,
    unsoldList: unsoldPlayersList,
    availableSorted,
  } = playerLists!;
  const serverCurrentBid = state.currentBid;
  const increment = auction.minIncrement;
  const minLegalBid = state.currentTeamId ? serverCurrentBid + increment : serverCurrentBid;
  const currentBid = pendingBid ?? serverCurrentBid;

  return (
    <div className="min-h-0 px-4 py-6 sm:px-6 lg:py-8">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <Link href={`/admin/auction/${id}`} className="shrink-0 pt-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full border border-white/10 bg-black/30 text-muted-foreground shadow-md backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-arena-cyan"
              aria-label="Back to manage auction"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <section className={cn(ARENA_MANAGE_HERO, "min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-7")}>
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/18 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-arena-magenta/12 blur-3xl" aria-hidden />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <nav className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground" aria-label="Breadcrumb">
                  <Link href="/admin" className="font-medium transition-colors hover:text-arena-cyan">
                    Dashboard
                  </Link>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
                  <Link href={`/admin/auction/${id}`} className="font-medium transition-colors hover:text-arena-cyan">
                    Manage
                  </Link>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
                  <span className="font-head-arena font-semibold text-arena-cyan">Live</span>
                </nav>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-head-arena text-[10px] font-bold uppercase tracking-[0.2em] text-arena-magenta/90">
                    Live control
                  </span>
                  <Badge className="animate-pulse border border-primary/45 bg-primary/15 font-head-arena text-[10px] font-bold uppercase tracking-[0.15em] text-arena-cyan shadow-lg shadow-primary/20">
                    <Radio className="mr-1 h-3 w-3" />
                    On air
                  </Badge>
                </div>
                <h1 className="mt-2 font-head-arena text-2xl font-extrabold tracking-tight break-words sm:text-3xl">
                  {auction.name}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Drive bidding, complete sales, and share the public board — synced with the viewer in real time.
                </p>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:max-w-md lg:w-auto lg:shrink-0">
                <Link
                  href={`/auction/${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 transition-all hover:border-primary/25 hover:bg-primary/[0.07]"
                  )}
                >
                  <ExternalLink className="h-4 w-4 shrink-0 text-arena-cyan" />
                  <span className="text-left text-[11px] font-semibold leading-tight">Open viewer</span>
                </Link>
                <button
                  type="button"
                  onClick={handleCopyViewerLink}
                  disabled={viewerCopied}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-left transition-all hover:border-primary/25 hover:bg-primary/[0.07] disabled:opacity-60"
                >
                  {viewerCopied ? (
                    <Copy className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-[11px] font-semibold leading-tight">
                    {viewerCopied ? "Link copied" : "Copy viewer URL"}
                  </span>
                </button>
              </div>
            </div>
          </section>
        </div>

        {error && (
          <div
            className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/35 bg-destructive/10 px-4 py-3 shadow-inner"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 text-sm leading-relaxed text-destructive">{error}</p>
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-8 shrink-0 text-destructive hover:bg-destructive/15">
              Dismiss
            </Button>
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
          <button
            type="button"
            onClick={() => setPoolDialog("available")}
            className={cn(
              "block w-full rounded-2xl text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "hover:-translate-y-0.5 active:translate-y-0"
            )}
            aria-label={`View ${availablePlayers.length} available players`}
          >
            <StatTile
              label="Available"
              value={availablePlayers.length}
              sub="Tap to view pool"
              icon={User}
              tone="live"
              highlight={poolDialog === "available"}
              className={cn(poolDialog === "available" && "ring-2 ring-primary/40")}
            />
          </button>
          <button
            type="button"
            onClick={() => setPoolDialog("sold")}
            className={cn(
              "block w-full rounded-2xl text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "hover:-translate-y-0.5 active:translate-y-0"
            )}
            aria-label={`View ${soldCount} sold players`}
          >
            <StatTile
              label="Sold"
              value={soldCount}
              sub="Tap to view list"
              icon={Trophy}
              tone="complete"
              className={cn(poolDialog === "sold" && "ring-2 ring-primary/40")}
            />
          </button>
          <button
            type="button"
            onClick={() => setPoolDialog("unsold")}
            className={cn(
              "block w-full rounded-2xl text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "hover:-translate-y-0.5 active:translate-y-0"
            )}
            aria-label={`View ${unsoldCount} unsold players`}
          >
            <StatTile
              label="Unsold"
              value={unsoldCount}
              sub="Tap to view list"
              icon={Ban}
              tone="draft"
              className={cn(poolDialog === "unsold" && "ring-2 ring-primary/40")}
            />
          </button>
        </div>

        <div className={cn(ARENA_WORKSPACE_SHELL, "grid gap-6 lg:grid-cols-3 lg:p-4")}>
          {/* Left Column - Current Player & Controls */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <Card
              className={cn(
                ARENA_GLASS_CARD,
                "overflow-hidden border-white/[0.08] bg-[color-mix(in_oklab,var(--arena-glass)_88%,transparent)] shadow-xl shadow-black/30"
              )}
            >
              <CardHeader className={cn(ARENA_CARD_HEADER, "px-6 py-5")}>
                <CardTitle className="font-head-arena flex items-center gap-2 text-base tracking-tight sm:text-lg">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-arena-cyan">
                    <User className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  Active <span className={ARENA_GRADIENT_TEXT}>spotlight</span>
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  Current player on the block — adjust bid, undo, mark sold or skip.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0 sm:px-8 sm:pb-8">
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
                        "mt-6 rounded-2xl border p-6 transition-[box-shadow,background-color] duration-300 sm:p-8",
                        state.currentTeamId
                          ? "arena-glow-bid border-primary/35 bg-gradient-to-b from-primary/15 to-primary/5"
                          : "border-white/[0.08] bg-black/25 shadow-inner"
                      )}
                    >
                      <p className="mb-1 font-head-arena text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Current high bid
                      </p>
                      <p className="font-head-arena text-5xl font-extrabold tabular-nums tracking-tight text-arena-cyan sm:text-6xl lg:text-7xl">
                        {currentBid}
                      </p>
                      <p className="mt-3 text-base sm:text-lg">
                        {state.currentTeamName ? (
                          <span className="font-semibold text-primary">{state.currentTeamName}</span>
                        ) : (
                          <span className="text-muted-foreground">No bids yet</span>
                        )}
                      </p>
                    </div>

                    {/* Bid Controls */}
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
                      <Button
                        variant="outline"
                        size="lg"
                        className={cn("h-12 w-12 rounded-xl border-white/15 p-0", ARENA_BTN_OUTLINE)}
                        onClick={() => {
                          setPendingBid((prev) => {
                            const base = prev ?? minLegalBid;
                            return Math.max(minLegalBid, base - increment);
                          });
                        }}
                        disabled={loading || (pendingBid ?? minLegalBid) <= minLegalBid}
                        aria-label="Decrease next bid"
                      >
                        <Minus className="h-5 w-5" />
                      </Button>
                      <div className="min-w-[7rem] text-center">
                        <p className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Next bid (pts)
                        </p>
                        <p className="font-head-arena text-3xl font-extrabold tabular-nums text-primary sm:text-4xl">
                          {pendingBid !== null ? pendingBid : minLegalBid}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="lg"
                        className={cn("h-12 w-12 rounded-xl border-white/15 p-0", ARENA_BTN_OUTLINE)}
                        onClick={() => {
                          setPendingBid((prev) => {
                            const base = prev ?? minLegalBid;
                            return base + increment;
                          });
                        }}
                        disabled={loading}
                        aria-label="Increase next bid"
                      >
                        <Plus className="h-5 w-5" />
                      </Button>
                    </div>

                    <div className="mt-6 flex flex-wrap justify-center gap-2 sm:gap-3">
                      <Button
                        variant="outline"
                        onClick={handleReset}
                        disabled={loading}
                        className={cn("gap-2 font-head-arena text-[11px] font-semibold uppercase tracking-wide", ARENA_BTN_OUTLINE)}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reset
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleUndoLatestBid}
                        disabled={loading || undoLoading || state.bidHistory.length === 0}
                        className="gap-2 border-unsold/45 font-head-arena text-[11px] font-semibold uppercase tracking-wide text-unsold hover:bg-unsold/12"
                      >
                        <Undo2 className="h-4 w-4" />
                        Undo bid
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => handleComplete("unsold")}
                        disabled={loading}
                        className="gap-2 font-head-arena text-[11px] font-semibold uppercase tracking-wide"
                      >
                        <X className="h-4 w-4" />
                        Skip
                      </Button>
                      <Button
                        onClick={() => handleComplete("sold")}
                        disabled={loading || !state.currentTeamId}
                        className={cn(
                          "min-w-[7rem] gap-2 px-6 font-head-arena text-[11px] font-bold uppercase tracking-wider shadow-lg shadow-primary/20",
                          ARENA_BTN_CYAN
                        )}
                      >
                        <Check className="h-4 w-4" />
                        Sold
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 py-14 text-center">
                    <p className="mb-2 text-sm font-medium text-foreground">No player on the block</p>
                    <p className="mx-auto mb-6 max-w-sm text-sm text-muted-foreground">
                      Draw the next name from the pool to open bidding.
                    </p>
                    <Button
                      onClick={handlePickRandom}
                      disabled={loading || pickablePlayersCount === 0}
                      size="lg"
                      className={cn("gap-2 font-head-arena text-xs font-bold uppercase tracking-wider", ARENA_BTN_CYAN)}
                    >
                      <Shuffle className="h-5 w-5" />
                      Pick random player
                    </Button>
                    {pickablePlayersCount === 0 && (
                      <p className="mt-4 text-sm text-muted-foreground">No pickable players left in the pool.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Team bid picker — high-contrast cards, matches arena theme */}
            {state.currentPlayer && (
              <Card
                className={cn(
                  ARENA_GLASS_CARD,
                  "overflow-hidden border-white/[0.08] bg-[color-mix(in_oklab,var(--arena-glass)_88%,transparent)] shadow-xl shadow-black/30"
                )}
              >
                <CardHeader className={cn(ARENA_CARD_HEADER, "px-6 py-5")}>
                  <CardTitle className="font-head-arena flex flex-wrap items-center gap-2 text-base tracking-tight sm:text-lg">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-arena-magenta/15 ring-1 ring-arena-magenta/30">
                      <Users className="h-5 w-5 text-arena-magenta" strokeWidth={1.75} />
                    </span>
                    Place bid for team
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2 text-sm leading-relaxed">
                    <MousePointerClick className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      Tap a team card to submit{" "}
                      <span className="font-mono text-sm font-bold tabular-nums text-primary">
                        {pendingBid ?? minLegalBid}
                      </span>{" "}
                      pts (next legal bid).
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-6 pt-0 sm:px-6">
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
                className={cn("w-full gap-2 font-head-arena text-[11px] font-semibold uppercase tracking-wide sm:w-auto", ARENA_BTN_OUTLINE)}
              >
                <Shuffle className="h-4 w-4" />
                Next player ({pickablePlayersCount} left)
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-5">
            <Card
              className={cn(
                ARENA_GLASS_CARD,
                "overflow-hidden border-white/[0.08] bg-[color-mix(in_oklab,var(--arena-glass)_88%,transparent)] shadow-lg shadow-black/25"
              )}
            >
              <CardHeader className={cn(ARENA_CARD_HEADER, "px-5 py-4")}>
                <CardTitle className="font-head-arena flex items-center gap-2 text-base tracking-tight">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                    <Wallet className="h-4 w-4 text-arena-cyan" strokeWidth={1.75} />
                  </span>
                  Budget tracker
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed">Remaining purse and roster per team</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[min(300px,40vh)] sm:h-[300px]">
                  <div className="flex flex-col gap-3 p-4">
                    {teams.map((team) => {
                      const budgetPercent = (team.remainingBudget / team.totalBudget) * 100;
                      const isLeading = state.currentTeamId === team._id;
                      
                      return (
                        <div
                          key={team._id}
                          className={cn(
                            "rounded-xl border border-white/[0.06] bg-black/25 p-3 shadow-inner transition-[box-shadow] duration-200",
                            isLeading && "arena-glow-bid border-primary/35 bg-primary/[0.08]"
                          )}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="font-head-arena text-sm font-bold tracking-tight">{team.name}</span>
                            {isLeading && (
                              <Badge className="shrink-0 border border-primary/35 bg-primary/15 text-[10px] font-bold uppercase tracking-wide text-arena-cyan">
                                Leading
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">Captain: {team.captainName || "—"}</p>
                          <div className="mb-2 mt-2 h-2 overflow-hidden rounded-full bg-black/40">
                            <div
                              className="h-full bg-gradient-to-r from-primary to-primary-end transition-all duration-500"
                              style={{ width: `${budgetPercent}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[11px] text-muted-foreground">
                            <span className={cn("font-semibold tabular-nums", getTeamColorClass(team._id))}>
                              {team.remainingBudget} / {team.totalBudget} pts
                            </span>
                            <span className="tabular-nums">
                              {team.playersCount} / {auction.maxPlayersPerTeam}
                            </span>
                          </div>
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            Max bid{" "}
                            <span className="font-mono font-semibold tabular-nums text-arena-magenta">{team.maxBid}</span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card
              className={cn(
                ARENA_GLASS_CARD,
                "overflow-hidden border-white/[0.08] bg-[color-mix(in_oklab,var(--arena-glass)_88%,transparent)] shadow-lg shadow-black/25"
              )}
            >
              <CardHeader className={cn(ARENA_CARD_HEADER, "px-5 py-4")}>
                <CardTitle className="font-head-arena text-base tracking-tight">
                  Recent <span className={ARENA_GRADIENT_TEXT}>bids</span>
                </CardTitle>
                <CardDescription className="text-xs">Newest first</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[min(200px,30vh)] sm:h-[200px]">
                  <div className={cn(ARENA_TABLE_FRAME, "m-3 flex flex-col gap-2 border-0 bg-transparent p-2")}>
                    {state.bidHistory.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">No bids this round yet</p>
                    ) : (
                      [...state.bidHistory].reverse().map((bid, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2 text-sm"
                        >
                          <span className="truncate font-medium">{bid.teamName}</span>
                          <span className="ml-2 shrink-0 font-mono font-semibold tabular-nums text-arena-cyan">
                            {bid.amount}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card
              className={cn(
                ARENA_GLASS_CARD,
                "overflow-hidden border-white/[0.08] bg-[color-mix(in_oklab,var(--arena-glass)_88%,transparent)] shadow-lg shadow-black/25"
              )}
            >
              <CardHeader className={cn(ARENA_CARD_HEADER, "px-5 py-4")}>
                <CardTitle className="font-head-arena text-base tracking-tight">
                  Auction <span className="text-arena-magenta">log</span>
                </CardTitle>
                <CardDescription className="text-xs">Audit trail</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[min(220px,32vh)] sm:h-[220px]">
                  <div className="flex flex-col gap-2 p-4">
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
                            className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] border-l-[3px] border-l-arena-magenta/50 bg-black/25 p-2.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium leading-snug">{message}</div>
                            </div>
                            <div className="mt-0.5 shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
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

            <Card
              className={cn(
                ARENA_GLASS_CARD,
                "overflow-hidden border-white/[0.08] bg-[color-mix(in_oklab,var(--arena-glass)_88%,transparent)] shadow-lg shadow-black/25"
              )}
            >
              <CardHeader className={cn(ARENA_CARD_HEADER, "px-5 py-4")}>
                <CardTitle className="font-head-arena text-base tracking-tight">Pool snapshot</CardTitle>
                <CardDescription className="text-xs">Quick counts</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-available/25 bg-available/10 py-3 shadow-inner">
                    <p className="text-2xl font-extrabold tabular-nums text-available">{availablePlayers.length}</p>
                    <p className="mt-0.5 font-head-arena text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Avail.
                    </p>
                  </div>
                  <div className="rounded-xl border border-sold/25 bg-sold/10 py-3 shadow-inner">
                    <p className="text-2xl font-extrabold tabular-nums text-sold">{soldCount}</p>
                    <p className="mt-0.5 font-head-arena text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Sold
                    </p>
                  </div>
                  <div className="rounded-xl border border-unsold/25 bg-unsold/10 py-3 shadow-inner">
                    <p className="text-2xl font-extrabold tabular-nums text-unsold">
                      {players.filter((p) => p.status === "unsold").length}
                    </p>
                    <p className="mt-0.5 font-head-arena text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Unsold
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Dialog open={poolDialog !== null} onOpenChange={(open) => !open && setPoolDialog(null)}>
          <DialogContent className={cn(ARENA_DIALOG_SURFACE, "max-h-[85vh] max-w-2xl gap-0 p-0")}>
            <DialogHeader className="border-b border-white/[0.08] px-6 py-4 text-left">
              <DialogTitle className="font-head-arena text-xl tracking-tight">
                {poolDialog === "available" && (
                  <>
                    Available <span className={ARENA_GRADIENT_TEXT}>players</span>
                  </>
                )}
                {poolDialog === "sold" && (
                  <>
                    Sold <span className={ARENA_GRADIENT_TEXT}>players</span>
                  </>
                )}
                {poolDialog === "unsold" && (
                  <>
                    Unsold <span className="text-unsold">players</span>
                  </>
                )}
              </DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                {poolDialog === "available" &&
                  "Everyone still in the pool (same view as the public viewer)."}
                {poolDialog === "sold" && "Sales recorded so far — team and points."}
                {poolDialog === "unsold" && "Players passed without a sale in this auction."}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[min(60vh,520px)] px-4 py-4">
              {poolDialog === "available" && (
                <div className={ARENA_TABLE_FRAME}>
                  {availableSorted.length === 0 ? (
                    <p className="p-8 text-center text-sm text-muted-foreground">No available players.</p>
                  ) : (
                    <Table>
                      <TableHeader className="bg-gradient-to-b from-white/[0.06] to-transparent [&_tr]:border-white/[0.06]">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Player
                          </TableHead>
                          <TableHead className="text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Base
                          </TableHead>
                          <TableHead className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Status
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {availableSorted.map((p) => {
                          const onBlock = state.currentPlayer?._id === p._id;
                          return (
                            <TableRow
                              key={p._id}
                              className={cn(
                                "border-white/[0.05]",
                                onBlock && "bg-primary/10 ring-1 ring-primary/25"
                              )}
                            >
                              <TableCell className="px-4 py-3 font-medium">{p.name}</TableCell>
                              <TableCell className="px-4 py-3 text-right font-mono tabular-nums">
                                {p.basePrice}
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                {onBlock ? (
                                  <Badge className="border-primary/35 bg-primary/15 text-[10px] font-bold uppercase text-arena-cyan">
                                    On block
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
              {poolDialog === "sold" && (
                <div className={ARENA_TABLE_FRAME}>
                  {soldPlayersList.length === 0 ? (
                    <p className="p-8 text-center text-sm text-muted-foreground">No sales yet.</p>
                  ) : (
                    <Table>
                      <TableHeader className="bg-gradient-to-b from-white/[0.06] to-transparent [&_tr]:border-white/[0.06]">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Player
                          </TableHead>
                          <TableHead className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Sold to
                          </TableHead>
                          <TableHead className="text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Pts
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {soldPlayersList.map((p) => (
                          <TableRow key={p._id} className="border-white/[0.05] hover:bg-sold/5">
                            <TableCell className="px-4 py-3 font-semibold">{p.name}</TableCell>
                            <TableCell className="px-4 py-3 text-muted-foreground">
                              {p.soldTo ? teamNameById.get(p.soldTo) ?? "—" : "—"}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-sold">
                              {typeof p.soldPrice === "number" ? p.soldPrice : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
              {poolDialog === "unsold" && (
                <div className={ARENA_TABLE_FRAME}>
                  {unsoldPlayersList.length === 0 ? (
                    <p className="p-8 text-center text-sm text-muted-foreground">No unsold players.</p>
                  ) : (
                    <Table>
                      <TableHeader className="bg-gradient-to-b from-white/[0.06] to-transparent [&_tr]:border-white/[0.06]">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Player
                          </TableHead>
                          <TableHead className="text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Base
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unsoldPlayersList.map((p) => (
                          <TableRow key={p._id} className="border-white/[0.05] hover:bg-unsold/5">
                            <TableCell className="px-4 py-3 font-medium">{p.name}</TableCell>
                            <TableCell className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                              {p.basePrice}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </ScrollArea>
            <div className="border-t border-white/[0.08] px-6 py-3">
              <Button variant="outline" className={ARENA_BTN_OUTLINE} onClick={() => setPoolDialog(null)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
