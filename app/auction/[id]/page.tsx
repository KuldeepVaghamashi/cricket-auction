"use client";

import { useState, useEffect, useRef, use, memo, useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  User,
  Users,
  DollarSign,
  Gavel,
  ChevronDown,
  Package,
  Ban,
  Trophy,
  Radio,
  AlertCircle,
} from "lucide-react";
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
import {
  ARENA_GLASS_CARD,
  ARENA_CARD_HEADER,
  ARENA_GRADIENT_TEXT,
  ARENA_TABLE_FRAME,
  ARENA_DIALOG_SURFACE,
  ARENA_WORKSPACE_SHELL,
  ARENA_MANAGE_HERO,
  ARENA_BTN_OUTLINE,
} from "@/components/arena/arena-classes";
import type { ViewerStreamPayload } from "@/lib/viewer-stream-types";
import { useViewerLiveFeed } from "@/lib/use-viewer-live-feed";

const VIEWER_SURFACE = cn(
  ARENA_GLASS_CARD,
  "border-white/[0.08] bg-[color-mix(in_oklab,var(--card)_86%,transparent)] shadow-[0_28px_70px_-32px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.03]"
);

const VIEWER_SHELL = cn("app-public-shell", "viewer-page-root");

const ViewerPublicHeader = memo(function ViewerPublicHeader({
  eyebrow,
  title,
  right,
  homeAria = "AuctionArena — home",
}: {
  eyebrow: string;
  title: string;
  right?: ReactNode;
  homeAria?: string;
}) {
  return (
    <header className="app-glass-header sticky top-0 z-10 arena-top-edge">
      <div className="container mx-auto flex h-[3.75rem] max-w-7xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <Link
          href="/"
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none"
          aria-label={homeAria}
        >
          <BrandMark
            className="h-9 w-9 shrink-0 rounded-xl transition-[transform,filter] duration-200 group-hover:scale-[1.03] group-focus-visible:ring-2 group-focus-visible:ring-primary/40 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background"
            iconClassName="h-5 w-5"
          />
          <div className="min-w-0 text-left">
            <p className="font-head-arena text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {eyebrow}
            </p>
            <h1 className="truncate font-head-arena text-sm font-extrabold tracking-tight text-foreground sm:text-base">
              {title}
            </h1>
          </div>
        </Link>
        {right ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div> : null}
      </div>
    </header>
  );
});

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  return `${hours}h ${minutes}m ${seconds}s`;
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
  const [streamData, setStreamData] = useState<ViewerStreamPayload | null>(null);
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

  useViewerLiveFeed(id, isActive, mutateAuction, setStreamData);

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

  // Derived values — memoized so the 1 s `nowMs` tick and per-bid stream
  // updates don't recompute them on every render.

  const soldPlayers = useMemo(
    () => (allPlayers ?? []).filter((p) => p.status === "sold"),
    [allPlayers]
  );

  // Active view uses streamData.teams; completed/draft view uses allTeams.
  const teamNameById = useMemo(
    () =>
      isActive
        ? new Map<string, string>(
            (streamData?.teams ?? [])
              .filter((t) => t._id)
              .map((t) => [t._id as string, t.name])
          )
        : new Map<string, string>(
            (allTeams ?? []).map((t) => [t._id as string, t.name])
          ),
    [isActive, streamData?.teams, allTeams]
  );

  const recentBidCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (streamData?.state?.bidHistory ?? []).forEach((b) => {
      counts[b.teamName] = (counts[b.teamName] ?? 0) + 1;
    });
    return counts;
  }, [streamData?.state?.bidHistory]);

  const selectedTeamName = useMemo(
    () => (selectedTeamId ? teamNameById.get(selectedTeamId) ?? "Selected Team" : null),
    [selectedTeamId, teamNameById]
  );

  const selectedTeamSoldPlayers = useMemo(
    () => (selectedTeamId ? soldPlayers.filter((p) => p.soldTo === selectedTeamId) : []),
    [selectedTeamId, soldPlayers]
  );

  // Stable header badge — minIncrement never changes mid-auction.
  const headerRight = useMemo(
    () => (
      <>
        <Badge
          variant="outline"
          className="hidden border-white/12 bg-black/30 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground sm:inline-flex"
        >
          +{streamData?.auction?.minIncrement} pts / raise
        </Badge>
        <Badge className="shrink-0 animate-pulse border border-primary/45 bg-primary/18 font-head-arena text-[10px] font-bold uppercase tracking-wider text-arena-cyan shadow-lg shadow-primary/20">
          <Radio className="mr-1 h-3 w-3" aria-hidden />
          Live
        </Badge>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streamData?.auction?.minIncrement]
  );

  const togglePoolFilter = useCallback((key: "available" | "unsold") => {
    setPoolFilter((prev) => (prev === key ? null : key));
  }, []);

  const scrollToSold = useCallback(() => {
    setPoolFilter(null);
    soldSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const loadingInitial =
    (auctionLoading && !auctionErr) || (auctionReady && isActive && streamData === null);

  if (loadingInitial) {
    return (
      <div className={VIEWER_SHELL}>
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
          <div
            className={cn(
              VIEWER_SURFACE,
              "relative w-full max-w-md overflow-hidden px-8 py-14 text-center"
            )}
          >
            <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-arena-magenta/10 blur-3xl" />
            <div className="relative mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 shadow-inner ring-1 ring-primary/15">
              <Radio className="h-7 w-7 animate-pulse text-arena-cyan" strokeWidth={1.5} />
            </div>
            <p className="relative font-head-arena text-base font-semibold tracking-tight text-foreground">
              Loading auction…
            </p>
            <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
              Preparing schedules, teams, and live data.
            </p>
            <div className="relative mx-auto mt-8 h-1.5 w-48 overflow-hidden rounded-full bg-black/40">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-primary via-arena-magenta to-primary" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (auctionErr || !auctionMeta) {
    return (
      <div className={cn(VIEWER_SHELL, "flex min-h-screen flex-col")}>
        <ViewerPublicHeader eyebrow="AuctionArena" title="Viewer" />
        <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
          <Card className={cn(VIEWER_SURFACE, "max-w-md overflow-hidden")}>
            <CardHeader className={cn(ARENA_CARD_HEADER, "space-y-2 border-b border-white/[0.06] px-6 py-6 text-center")}>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10">
                <AlertCircle className="h-7 w-7 text-destructive" strokeWidth={1.75} />
              </div>
              <CardTitle className="font-head-arena text-xl font-extrabold tracking-tight">
                Can&apos;t open this auction
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                {auctionErr?.message ?? "This link may be wrong or the auction was removed."}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-8 pt-6 text-center">
              <Button asChild className={cn("w-full sm:w-auto", ARENA_BTN_OUTLINE)} variant="outline">
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
      <div className={cn(VIEWER_SHELL, "flex min-h-screen flex-col")}>
        <ViewerPublicHeader eyebrow="AuctionArena" title="Live viewer" />
        <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
          <Card className={cn(VIEWER_SURFACE, "max-w-md overflow-hidden")}>
            <CardHeader className={cn(ARENA_CARD_HEADER, "space-y-2 border-b border-white/[0.06] px-6 py-6 text-center")}>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10">
                <AlertCircle className="h-7 w-7 text-destructive" strokeWidth={1.75} />
              </div>
              <CardTitle className="font-head-arena text-xl font-extrabold tracking-tight">Live feed error</CardTitle>
              <CardDescription className="text-sm leading-relaxed text-destructive">{streamData.error}</CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-8 pt-6 text-center">
              <Button asChild className={cn(ARENA_BTN_OUTLINE)} variant="outline" size="sm">
                <Link href="/">Home</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (auctionMeta.status !== "active") {
    const isDraft = auctionMeta.status === "draft";

    const startsAtMs = auctionDateToUtcMs(auctionMeta.date);
    const hasStartsAt = Number.isFinite(startsAtMs);
    const msRemaining = hasStartsAt ? startsAtMs - nowMs : 0;
    const hasCountdown = isDraft && hasStartsAt && msRemaining > 0;

    return (
      <div className={cn(VIEWER_SHELL, "flex min-h-screen flex-col")}>
        <ViewerPublicHeader eyebrow="AuctionArena" title={auctionMeta.name} />

        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10">
          <div className={cn(ARENA_MANAGE_HERO, "mb-6 px-5 py-5 sm:px-7 sm:py-6")}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-head-arena text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  {auctionMeta.status === "draft" ? "Upcoming session" : "Results archive"}
                </p>
                <h2 className="mt-1 font-head-arena text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
                  {auctionMeta.status === "draft" ? (
                    <>
                      Starts <span className={ARENA_GRADIENT_TEXT}>soon</span>
                    </>
                  ) : (
                    <>
                      Auction <span className={ARENA_GRADIENT_TEXT}>complete</span>
                    </>
                  )}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  {auctionMeta.status === "draft"
                    ? "Bookmark this page — when the host goes live, open the same link for the real-time board."
                    : "Below is the final sold list. Thanks for following along."}
                </p>
              </div>
              <Badge
                variant="outline"
                className="w-fit shrink-0 border-white/15 bg-black/25 px-4 py-2 font-head-arena text-xs font-bold uppercase tracking-wider"
              >
                {auctionMeta.status === "draft" ? "Not started" : "Completed"}
              </Badge>
            </div>
          </div>

          <Card className={cn(VIEWER_SURFACE, "w-full overflow-hidden py-0")}>
            <CardHeader className="relative border-b border-white/[0.06] bg-black/20 pb-8 pt-8 text-center">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 shadow-inner ring-1 ring-primary/15">
                <Gavel className="h-9 w-9 text-arena-cyan" strokeWidth={1.75} />
              </div>
              <CardTitle className="font-head-arena text-2xl font-extrabold tracking-tight sm:text-3xl">
                {auctionMeta.name}
              </CardTitle>
              <CardDescription className="mx-auto mt-3 max-w-lg text-sm leading-relaxed">
                {auctionMeta.status === "draft"
                  ? "Scheduled start and pool snapshot — no bidding until the host opens the room."
                  : "Official sold roster for this auction."}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-10 pt-8 sm:px-8">
              <div className="flex flex-col items-center gap-4 text-center">
                {hasStartsAt && (
                  <div className="flex w-full max-w-md flex-col items-center gap-2 rounded-2xl border border-white/[0.08] bg-black/25 px-5 py-4 shadow-inner">
                    <p className="font-head-arena text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                      Scheduled start
                    </p>
                    <p className="text-center text-lg font-semibold tracking-tight text-foreground">
                      {formatAuctionStartLocal(startsAtMs)}
                    </p>
                  </div>
                )}
                {isDraft && hasStartsAt && (
                  <div
                    className={cn(
                      "w-full max-w-md rounded-2xl border px-5 py-4 text-center shadow-inner",
                      hasCountdown
                        ? "border-primary/35 bg-primary/10"
                        : "border-white/[0.08] bg-black/20"
                    )}
                  >
                    <p className="font-head-arena text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                      {hasCountdown ? "Time until start" : "Status"}
                    </p>
                    <p
                      className={cn(
                        "mt-1 font-head-arena text-2xl font-extrabold tabular-nums tracking-tight",
                        hasCountdown ? "text-arena-cyan" : "text-muted-foreground"
                      )}
                    >
                      {hasCountdown ? formatCountdown(msRemaining) : "Starting soon"}
                    </p>
                  </div>
                )}
                {isDraft && !hasStartsAt && (
                  <Badge variant="secondary" className="border-white/10 bg-secondary/80 px-4 py-2 text-sm">
                    Start time not set — check back soon
                  </Badge>
                )}
                {allPlayers ? (
                  <div className="mt-4 grid w-full max-w-xl grid-cols-3 gap-2 sm:mt-6 sm:gap-3">
                    <div className="rounded-xl border border-available/25 bg-available/[0.08] py-3 text-center shadow-inner ring-1 ring-available/10">
                      <p className="font-head-arena text-2xl font-extrabold tabular-nums text-available sm:text-3xl">
                        {playerStats.available}
                      </p>
                      <p className="mt-1 font-head-arena text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        Available
                      </p>
                    </div>
                    <div className="rounded-xl border border-sold/25 bg-sold/[0.08] py-3 text-center shadow-inner ring-1 ring-sold/10">
                      <p className="font-head-arena text-2xl font-extrabold tabular-nums text-sold sm:text-3xl">
                        {playerStats.sold}
                      </p>
                      <p className="mt-1 font-head-arena text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        Sold
                      </p>
                    </div>
                    <div className="rounded-xl border border-unsold/25 bg-unsold/[0.08] py-3 text-center shadow-inner ring-1 ring-unsold/10">
                      <p className="font-head-arena text-2xl font-extrabold tabular-nums text-unsold sm:text-3xl">
                        {playerStats.unsold}
                      </p>
                      <p className="mt-1 font-head-arena text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        Unsold
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-10">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-white/[0.06] pb-3">
                  <h3 className="font-head-arena text-lg font-extrabold tracking-tight sm:text-xl">
                    Sold <span className={ARENA_GRADIENT_TEXT}>players</span>
                  </h3>
                  {soldPlayers.length > 0 && (
                    <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                      {soldPlayers.length} total
                    </Badge>
                  )}
                </div>
                {!allPlayers || !allTeams ? (
                  <p className="rounded-xl border border-dashed border-white/10 bg-black/15 py-8 text-center text-sm text-muted-foreground">
                    Loading results…
                  </p>
                ) : soldPlayers.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/12 bg-black/20 py-12 text-center text-sm leading-relaxed text-muted-foreground">
                    No players were sold in this auction.
                  </p>
                ) : (
                  <ScrollArea className="h-[min(380px,52vh)] sm:h-[380px]">
                    <div className={ARENA_TABLE_FRAME}>
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
                            Points
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {soldPlayers.map((p) => (
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
                    </div>
                  </ScrollArea>
                )}
              </div>
            </CardContent>
          </Card>
        </main>

        <footer className="mt-auto border-t border-white/[0.06] bg-black/20 py-8 backdrop-blur-md">
          <div className="container mx-auto max-w-7xl px-4 text-center sm:px-6">
            <p className="font-head-arena text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              AuctionArena
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Designed and developed by Kuldeep Ahir
            </p>
          </div>
        </footer>
      </div>
    );
  }

  if (!streamData) {
    return (
      <div className={cn(VIEWER_SHELL, "flex min-h-screen flex-col")}>
        <ViewerPublicHeader eyebrow="AuctionArena" title={auctionMeta.name} />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
          <div className={cn(VIEWER_SURFACE, "relative w-full max-w-sm overflow-hidden px-8 py-12 text-center")}>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,oklch(0.76_0.13_211/0.12),transparent)]" />
            <div className="relative mx-auto mb-5 h-2 w-40 overflow-hidden rounded-full bg-black/45 ring-1 ring-white/[0.06]">
              <div className="h-full w-2/5 animate-pulse rounded-full bg-gradient-to-r from-primary via-arena-magenta to-primary" />
            </div>
            <p className="relative font-head-arena text-base font-semibold text-foreground">Connecting to live feed…</p>
            <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
              Hang tight — bids and the block sync in real time.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const stateLite = streamData.state;
  const currentPlayer = streamData.currentPlayer;
  const teamsLive = streamData.teams;

  return (
    <div className={cn(VIEWER_SHELL, "flex min-h-screen flex-col")}>
      <ViewerPublicHeader
        eyebrow="Live broadcast"
        title={auctionMeta.name}
        right={headerRight}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:mb-5">
          Follow the player on the block, live high bid, and every team&apos;s purse — no refresh needed.
          <span className="mt-1 block text-xs text-muted-foreground/90 sm:hidden">
            Raises go up by <span className="font-mono font-semibold text-foreground">{streamData.auction.minIncrement}</span>{" "}
            pts at a time.
          </span>
        </p>
        <div className={cn(ARENA_WORKSPACE_SHELL, "p-3 sm:p-4 lg:p-5")}>
          <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
          <div className="lg:col-span-2">
            <Card className={cn(VIEWER_SURFACE, "overflow-hidden")}>
              <CardHeader
                className={cn(
                  ARENA_CARD_HEADER,
                  "relative border-b border-white/[0.06] px-5 py-4 sm:px-6 sm:py-5"
                )}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
                <CardTitle className="flex items-center gap-3 font-head-arena text-base tracking-tight sm:text-lg">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/12 text-arena-cyan shadow-inner ring-1 ring-primary/10">
                    <User className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <span>
                    On the <span className={ARENA_GRADIENT_TEXT}>block</span>
                  </span>
                </CardTitle>
                <CardDescription className="mt-1 text-sm leading-relaxed">
                  Name, base price, and current high bid update as the auctioneer runs the room.
                </CardDescription>
              </CardHeader>
              <CardContent className="relative overflow-hidden p-5 sm:p-8 [background:radial-gradient(ellipse_90%_60%_at_50%_-20%,oklch(0.76_0.13_211/0.07),transparent)]">
                {completionAnimation && (
                  <div
                    className={cn(
                      "absolute inset-0 z-10 flex items-center justify-center px-4 text-center backdrop-blur-[3px] pointer-events-none",
                      completionAnimation.action === "sold"
                        ? "bg-sold/25 ring-1 ring-sold/40"
                        : "bg-unsold/25 ring-1 ring-unsold/35"
                    )}
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
                    <h2 className="mb-3 break-words font-head-arena text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
                      {currentPlayer.name}
                    </h2>
                    <Badge
                      variant="outline"
                      className="border-primary/30 bg-primary/10 px-4 py-1 font-head-arena text-sm font-bold text-arena-cyan"
                    >
                      Base {currentPlayer.basePrice} pts
                    </Badge>

                    <div
                      className={cn(
                        "mt-8 rounded-2xl border p-6 transition-all duration-300 sm:p-10",
                        stateLite?.currentTeamId
                          ? "arena-glow-bid border-primary/35 bg-gradient-to-b from-primary/15 to-primary/5"
                          : "border-white/[0.08] bg-black/25 shadow-inner"
                      )}
                    >
                      <p className="mb-1 font-head-arena text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Current high bid
                      </p>
                      <p className="font-head-arena text-4xl font-extrabold tabular-nums tracking-tight text-arena-cyan sm:text-6xl lg:text-7xl">
                        {stateLite?.currentBid || currentPlayer.basePrice}
                      </p>
                      <p className="mt-4 text-lg sm:text-xl">
                        {stateLite?.currentTeamName ? (
                          <span className="font-semibold text-primary">{stateLite.currentTeamName}</span>
                        ) : (
                          <span className="text-muted-foreground">Waiting for the first bid…</span>
                        )}
                      </p>
                    </div>

                    {stateLite?.bidHistory && stateLite.bidHistory.length > 0 && (
                      <div className="mt-8">
                        <p className="mb-3 font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Latest bids
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {[...stateLite.bidHistory].reverse().slice(0, 5).map((bid, i) => (
                            <Badge
                              key={bid.timestamp ? `${bid.timestamp}-${i}` : `${bid.teamName}-${bid.amount}-${i}`}
                              variant={i === 0 ? "default" : "outline"}
                              className={cn(
                                "font-mono text-xs tabular-nums sm:text-sm",
                                i === 0 && "border-primary/35 bg-primary/20 text-arena-cyan"
                              )}
                            >
                              {bid.teamName}: {bid.amount}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/12 bg-black/25 py-14 text-center shadow-inner ring-1 ring-white/[0.02] sm:py-16">
                    <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/20 bg-primary/5 shadow-inner">
                      <User className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
                    </div>
                    <p className="font-head-arena text-lg font-bold tracking-tight text-foreground sm:text-xl">
                      Waiting for the next player
                    </p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                      The room is between picks — names and bids will appear here automatically.
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
                  ARENA_GLASS_CARD,
                  "border-white/[0.08] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-5 text-left shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-200",
                  "hover:-translate-y-0.5 hover:border-available/40 hover:shadow-xl hover:shadow-available/10",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-available/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  poolFilter === "available" &&
                    "border-available/50 bg-available/10 shadow-[0_0_32px_-8px] shadow-available/40 ring-1 ring-available/30"
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
                <p className="mt-3 font-head-arena text-4xl font-extrabold tabular-nums tracking-tight text-available">
                  {playerStats.available}
                </p>
                <p className="mt-1 font-head-arena text-xs font-bold uppercase tracking-wider text-foreground">
                  Available
                </p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">Tap to list everyone still in the pool</p>
              </button>

              <button
                type="button"
                onClick={scrollToSold}
                className={cn(
                  ARENA_GLASS_CARD,
                  "border-white/[0.08] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-5 text-left shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-200",
                  "hover:-translate-y-0.5 hover:border-sold/40 hover:shadow-xl hover:shadow-sold/10",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sold/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <Trophy className="h-5 w-5 shrink-0 text-sold opacity-90" aria-hidden />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    View list
                  </span>
                </div>
                <p className="mt-3 font-head-arena text-4xl font-extrabold tabular-nums tracking-tight text-sold">
                  {playerStats.sold}
                </p>
                <p className="mt-1 font-head-arena text-xs font-bold uppercase tracking-wider text-foreground">Sold</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">Jump to the live results table</p>
              </button>

              <button
                type="button"
                onClick={() => togglePoolFilter("unsold")}
                aria-pressed={poolFilter === "unsold"}
                className={cn(
                  ARENA_GLASS_CARD,
                  "border-white/[0.08] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-5 text-left shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-200",
                  "hover:-translate-y-0.5 hover:border-unsold/40 hover:shadow-xl hover:shadow-unsold/10",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-unsold/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  poolFilter === "unsold" &&
                    "border-unsold/50 bg-unsold/10 shadow-[0_0_32px_-8px] shadow-unsold/35 ring-1 ring-unsold/30"
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
                <p className="mt-3 font-head-arena text-4xl font-extrabold tabular-nums tracking-tight text-unsold">
                  {playerStats.unsold}
                </p>
                <p className="mt-1 font-head-arena text-xs font-bold uppercase tracking-wider text-foreground">
                  Unsold
                </p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">Tap to list players passed without a sale</p>
              </button>
            </div>

            {/* Filtered pool list (available or unsold) */}
            {poolFilter && (
              <Card
                className={cn(
                  VIEWER_SURFACE,
                  "mt-4 overflow-hidden",
                  poolFilter === "available" && "border-available/25 ring-1 ring-available/15",
                  poolFilter === "unsold" && "border-unsold/25 ring-1 ring-unsold/15"
                )}
              >
                <CardHeader className={cn(ARENA_CARD_HEADER, "relative space-y-1 border-b border-white/[0.06] py-4 sm:py-5")}>
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                  <CardTitle
                    className={cn(
                      "flex flex-wrap items-center gap-2 text-base font-head-arena sm:text-lg",
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
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {poolFilter === "available"
                      ? "Still in the pool — not yet sold or marked unsold. On the block is highlighted."
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
            <div ref={soldSectionRef} id="viewer-sold-section" className="mt-6 scroll-mt-28">
              <Card
                className={cn(
                  VIEWER_SURFACE,
                  "overflow-hidden border-sold/30 bg-gradient-to-br from-card via-card to-sold/[0.08] ring-1 ring-sold/20"
                )}
              >
                <CardHeader className={cn(ARENA_CARD_HEADER, "relative border-b border-white/[0.06] bg-sold/[0.06] pb-4 sm:pb-5")}>
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sold/35 to-transparent" />
                  <div className="flex flex-wrap items-center gap-2 gap-y-1">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sold/30 bg-sold/10">
                      <Trophy className="h-5 w-5 text-sold" strokeWidth={1.75} />
                    </span>
                    <CardTitle className="font-head-arena text-lg tracking-tight sm:text-xl">
                      Sold <span className={ARENA_GRADIENT_TEXT}>players</span>
                    </CardTitle>
                    <Badge className="bg-sold/15 text-sold hover:bg-sold/20 border-sold/30">
                      {soldPlayers.length} total
                    </Badge>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Player, winning team, and points — this table updates as sales complete.
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
                        <div className={ARENA_TABLE_FRAME}>
                          <Table>
                            <TableHeader className="bg-gradient-to-b from-white/[0.05] to-transparent [&_tr]:border-white/[0.06]">
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="w-[40%] font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Player
                                </TableHead>
                                <TableHead className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Sold to
                                </TableHead>
                                <TableHead className="text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Points
                                </TableHead>
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
            <Card className={cn(VIEWER_SURFACE, "overflow-hidden")}>
              <CardHeader
                className={cn(ARENA_CARD_HEADER, "relative border-b border-white/[0.06] px-5 py-4 sm:py-5")}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
                <CardTitle className="flex items-center gap-3 font-head-arena text-base tracking-tight">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 shadow-inner ring-1 ring-primary/10">
                    <Users className="h-4 w-4 text-arena-cyan" strokeWidth={1.75} />
                  </span>
                  Team <span className={ARENA_GRADIENT_TEXT}>purses</span>
                </CardTitle>
                <CardDescription className="mt-1 text-xs leading-relaxed sm:text-sm">
                  Select a team for their sold roster. The current high bidder glows cyan.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[min(600px,70vh)] lg:h-[600px]">
                  <div className="flex flex-col gap-3 p-4">
                    {teamsLive.map((team) => {
                      const budgetPercent = (team.remainingBudget / team.totalBudget) * 100;
                      const isLeading = stateLite?.currentTeamId === team._id;

                      return (
                        <div
                          key={team._id ?? team.name}
                          className={cn(
                            "cursor-pointer rounded-xl border border-white/[0.08] bg-black/25 p-4 shadow-inner ring-1 ring-white/[0.02] transition-all duration-200",
                            "hover:border-white/15 hover:bg-black/35",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[color-mix(in_oklab,var(--card)_92%,transparent)]",
                            isLeading && "arena-glow-bid border-primary/40 bg-primary/[0.1]",
                            selectedTeamId === team._id && "ring-2 ring-primary/45 ring-offset-2 ring-offset-[color-mix(in_oklab,var(--card)_92%,transparent)]"
                          )}
                          onClick={() => team._id && setSelectedTeamId(team._id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              team._id && setSelectedTeamId(team._id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`View sold players for ${team.name}`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="font-head-arena text-sm font-bold tracking-tight">{team.name}</span>
                            {isLeading && (
                              <Badge className="shrink-0 border border-primary/35 bg-primary/15 text-[10px] font-bold uppercase tracking-wide text-arena-cyan">
                                Leading
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Captain: {team.captainName || "—"}
                          </p>
                          <div className="mb-2 mt-2 h-2 overflow-hidden rounded-full bg-black/40">
                            <div
                              className="h-full bg-gradient-to-r from-primary to-primary-end transition-all duration-500"
                              style={{ width: `${budgetPercent}%` }}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                            <div className="tabular-nums">
                              <DollarSign className="mr-0.5 inline h-3 w-3 align-text-bottom text-muted-foreground/80" />
                              <span className="font-mono font-semibold text-arena-cyan tabular-nums">
                                {team.remainingBudget}
                              </span>
                              <span> / {team.totalBudget}</span>
                            </div>
                            <div className="tabular-nums">
                              <User className="mr-0.5 inline h-3 w-3" />
                              {team.playersCount} / {auctionMeta.maxPlayersPerTeam}
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Max bid{" "}
                            <span className="font-mono font-semibold text-arena-magenta">{team.maxBid}</span> pts
                          </p>
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            Recent bids:{" "}
                            <span className="font-mono font-medium text-foreground">
                              {recentBidCounts[team.name] ?? 0}
                            </span>
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
        </div>
      </main>

      <footer className="mt-auto border-t border-white/[0.06] bg-black/20 py-8 backdrop-blur-md">
        <div className="container mx-auto max-w-7xl px-4 text-center sm:px-6">
          <p className="font-head-arena text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            AuctionArena
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Designed and developed by Kuldeep Ahir
          </p>
        </div>
      </footer>

      <Dialog open={!!selectedTeamId} onOpenChange={(open) => !open && setSelectedTeamId(null)}>
        <DialogContent className={cn(ARENA_DIALOG_SURFACE, "max-w-2xl gap-0 overflow-hidden p-0")}>
          <DialogHeader className="border-b border-white/[0.08] px-6 py-5 text-left">
            <DialogTitle className="font-head-arena text-xl tracking-tight">
              {selectedTeamName ? (
                <span className={cn(ARENA_GRADIENT_TEXT, "block max-w-full truncate")}>{selectedTeamName}</span>
              ) : (
                "Sold players"
              )}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Everyone this team has bought so far in this auction.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(60vh,480px)] overflow-auto px-4 py-4">
            {selectedTeamSoldPlayers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 bg-black/15 py-10 text-center text-sm text-muted-foreground">
                No sold players for this team yet.
              </p>
            ) : (
              <div className={ARENA_TABLE_FRAME}>
                <Table>
                  <TableHeader className="bg-gradient-to-b from-white/[0.06] to-transparent [&_tr]:border-white/[0.06]">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Player
                      </TableHead>
                      <TableHead className="text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Points
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedTeamSoldPlayers.map((p) => (
                      <TableRow key={p._id} className="border-white/[0.05] hover:bg-sold/5">
                        <TableCell className="px-4 py-3 font-semibold">{p.name}</TableCell>
                        <TableCell className="px-4 py-3 text-right font-mono tabular-nums text-sold">
                          {typeof p.soldPrice === "number" ? p.soldPrice : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <div className="border-t border-white/[0.08] px-6 py-3">
            <Button variant="outline" className={ARENA_BTN_OUTLINE} onClick={() => setSelectedTeamId(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
