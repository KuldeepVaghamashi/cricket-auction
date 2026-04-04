"use client";

import { useState, use, useEffect } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Play,
  Users,
  User,
  UserPlus,
  Pencil,
  Link2,
  ExternalLink,
  UserCircle2,
  Trophy,
  Radio,
  ChevronRight,
  Wallet,
  Gavel,
  TrendingUp,
  Copy,
} from "lucide-react";
import type { AuctionWithId, TeamWithStats, PlayerWithId } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ARENA_GLASS_CARD,
  ARENA_CARD_HEADER,
  ARENA_BTN_CYAN,
  ARENA_BTN_MAGENTA,
  ARENA_BTN_OUTLINE,
  ARENA_MANAGE_HERO,
  ARENA_WORKSPACE_SHELL,
  ARENA_TABLE_FRAME,
  ARENA_DIALOG_SURFACE,
} from "@/components/arena/arena-classes";
import { auctionDateToUtcMs, formatAuctionStartLocal } from "@/lib/auction-date";
import { resolvePublicViewerBaseUrl } from "@/lib/public-url";
import { StatTile } from "@/components/arena/stat-tile";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function AuctionManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  
  const { data: auction, mutate: mutateAuction } = useSWR<AuctionWithId>(
    `/api/auctions/${id}`,
    fetcher
  );
  const { data: teams, mutate: mutateTeams } = useSWR<TeamWithStats[]>(
    `/api/auctions/${id}/teams`,
    fetcher
  );
  const { data: players, mutate: mutatePlayers } = useSWR<PlayerWithId[]>(
    `/api/auctions/${id}/players`,
    fetcher
  );

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [playerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [captainName, setCaptainName] = useState("");
  const [teamBudget, setTeamBudget] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerBasePrice, setPlayerBasePrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [teamPrintingId, setTeamPrintingId] = useState<string | null>(null);
  const [viewerCopied, setViewerCopied] = useState(false);
  const [registerLinkCopied, setRegisterLinkCopied] = useState(false);
  const [registerUrlPreview, setRegisterUrlPreview] = useState("");

  useEffect(() => {
    const base = resolvePublicViewerBaseUrl();
    if (base) setRegisterUrlPreview(`${base}/auction/${id}/register`);
  }, [id]);
  const [selectedTeamForSold, setSelectedTeamForSold] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [assignDialog, setAssignDialog] = useState<{
    open: boolean;
    teamId: string | null;
    teamName: string | null;
  }>({ open: false, teamId: null, teamName: null });
  const [assignPlayerId, setAssignPlayerId] = useState<string>("");
  const [editPlayerDialogOpen, setEditPlayerDialogOpen] = useState(false);
  const [editPlayerId, setEditPlayerId] = useState<string | null>(null);
  const [editPlayerName, setEditPlayerName] = useState("");
  const [editPlayerPhone, setEditPlayerPhone] = useState("");
  const [editPlayerBasePrice, setEditPlayerBasePrice] = useState("");

  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await fetch(`/api/auctions/${id}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: teamName, 
          captainName: captainName || undefined,
          totalBudget: teamBudget || undefined 
        }),
      });
      mutateTeams();
      setTeamDialogOpen(false);
      setTeamName("");
      setCaptainName("");
      setTeamBudget("");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm("Delete this team? All purchased players will be released.")) return;
    await fetch(`/api/auctions/${id}/teams/${teamId}`, { method: "DELETE" });
    mutateTeams();
    mutatePlayers();
  };

  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await fetch(`/api/auctions/${id}/players`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: playerName, 
          basePrice: playerBasePrice || undefined 
        }),
      });
      mutatePlayers();
      setPlayerDialogOpen(false);
      setPlayerName("");
      setPlayerBasePrice("");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePlayer = async (playerId: string) => {
    if (!confirm("Delete this player?")) return;
    await fetch(`/api/auctions/${id}/players/${playerId}`, { method: "DELETE" });
    mutatePlayers();
    mutateTeams();
  };

  const openEditPlayer = (player: PlayerWithId) => {
    setEditPlayerId(player._id);
    setEditPlayerName(player.name);
    setEditPlayerPhone(player.phone ?? "");
    setEditPlayerBasePrice(String(player.basePrice));
    setEditPlayerDialogOpen(true);
  };

  const handleSaveEditPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPlayerId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/auctions/${id}/players/${editPlayerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editPlayerName,
          phone: editPlayerPhone,
          basePrice: Number(editPlayerBasePrice),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        alert(typeof data?.error === "string" ? data.error : "Failed to update player");
        return;
      }
      mutatePlayers();
      setEditPlayerDialogOpen(false);
      setEditPlayerId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleStartAuction = async () => {
    if (!confirm("Start the auction? Make sure all teams and players are added.")) return;
    
    await fetch(`/api/auctions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    mutateAuction();
    router.push(`/admin/auction/${id}/live`);
  };

  const handleCompleteAuction = async () => {
    if (!confirm("Mark this auction as completed?")) return;
    
    await fetch(`/api/auctions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    mutateAuction();
  };

  const handlePrintPdf = async () => {
    setPrinting(true);
    try {
      const res = await fetch(`/api/auctions/${id}/print`, { method: "GET" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const errorText = data?.error || "Failed to generate PDF";
        const detailsText =
          data?.details && typeof data.details === "string" ? data.details : null;
        alert(detailsText ? `${errorText}\n\nDetails: ${detailsText}` : errorText);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `auction-${id}-results.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintTeamPdf = async (teamId: string, teamName: string) => {
    setTeamPrintingId(teamId);
    try {
      const res = await fetch(`/api/auctions/${id}/print?teamId=${encodeURIComponent(teamId)}`, {
        method: "GET",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const errorText = data?.error || "Failed to generate PDF";
        const detailsText =
          data?.details && typeof data.details === "string" ? data.details : null;
        alert(detailsText ? `${errorText}\n\nDetails: ${detailsText}` : errorText);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const safeName = (teamName || "team").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `auction-${id}-${safeName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } finally {
      setTeamPrintingId(null);
    }
  };

  const handleCopyViewerLink = async () => {
    try {
      const base = resolvePublicViewerBaseUrl();
      if (!base) {
        alert("Set NEXT_PUBLIC_VIEWER_BASE_URL or open admin from your public site to copy a full link.");
        return;
      }
      const url = `${base}/auction/${id}`;
      await navigator.clipboard.writeText(url);
      setViewerCopied(true);
      window.setTimeout(() => setViewerCopied(false), 2000);
    } catch {
      alert("Unable to copy viewer link. You can open the viewer instead.");
    }
  };

  const handleCopyRegisterLink = async () => {
    try {
      const base = resolvePublicViewerBaseUrl();
      if (!base) {
        alert("Set NEXT_PUBLIC_VIEWER_BASE_URL or open admin from your public site to copy a full link.");
        return;
      }
      const url = `${base}/auction/${id}/register`;
      await navigator.clipboard.writeText(url);
      setRegisterLinkCopied(true);
      window.setTimeout(() => setRegisterLinkCopied(false), 2000);
    } catch {
      alert("Unable to copy registration link.");
    }
  };

  if (!auction) {
    return (
      <div className="mx-auto max-w-[1480px] px-4 py-10 sm:px-8">
        <div
          className={cn(
            ARENA_MANAGE_HERO,
            "animate-pulse px-8 py-16 text-center font-head-arena text-sm tracking-wide text-muted-foreground"
          )}
        >
          Loading auction…
        </div>
      </div>
    );
  }

  const availablePlayers = players?.filter((p) => p.status === "available") || [];
  const soldPlayers = players?.filter((p) => p.status === "sold") || [];
  const selectedTeamSoldPlayers =
    selectedTeamForSold && players
      ? players.filter((p) => p.status === "sold" && p.soldTo === selectedTeamForSold.id)
      : [];

  const handleAssignPlayerToTeam = async () => {
    if (!assignDialog.teamId || !assignPlayerId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/auctions/${id}/teams/${assignDialog.teamId}/assign-player`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: assignPlayerId }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        alert(data?.error || "Failed to assign player");
        return;
      }
      setAssignDialog({ open: false, teamId: null, teamName: null });
      setAssignPlayerId("");
      mutateTeams();
      mutatePlayers();
    } finally {
      setLoading(false);
    }
  };

  const statusLabel =
    auction.status === "active" ? "LIVE" : auction.status === "completed" ? "COMPLETE" : "DRAFT";

  const ruleChips = [
    { icon: Wallet, label: "Team budget", value: `${auction.budget} pts` },
    { icon: Gavel, label: "Min base", value: `${auction.minBid} pts` },
    { icon: TrendingUp, label: "Bid step", value: `+${auction.minIncrement}` },
    { icon: Users, label: "Squad cap", value: `${auction.maxPlayersPerTeam} / team` },
  ] as const;

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-col gap-7">
        <div className="flex items-start gap-3 sm:gap-4">
          <Link href="/admin" className="shrink-0 pt-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full border border-white/10 bg-black/30 text-muted-foreground shadow-md backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-arena-cyan"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <section className={cn(ARENA_MANAGE_HERO, "relative min-w-0 flex-1 overflow-hidden px-5 py-6 sm:px-8 sm:py-8")}>
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/18 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-arena-magenta/12 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,rgba(255,255,255,0.02)_50%,transparent_60%)]" aria-hidden />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
              <div className="min-w-0 flex-1">
                <nav className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground" aria-label="Breadcrumb">
                  <Link href="/admin" className="font-medium transition-colors hover:text-arena-cyan">
                    Dashboard
                  </Link>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
                  <span className="truncate font-head-arena font-semibold text-foreground/90">{auction.name}</span>
                </nav>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-head-arena text-[10px] font-bold uppercase tracking-[0.2em] text-arena-cyan">
                    Control center
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 font-head-arena text-[10px] font-bold uppercase tracking-wider",
                      auction.status === "active" &&
                        "border-primary/40 bg-primary/15 text-arena-cyan shadow-[0_0_24px_-8px_color-mix(in_oklab,var(--primary)_55%,transparent)]",
                      auction.status === "draft" && "border-white/15 bg-black/35 text-muted-foreground",
                      auction.status === "completed" && "border-emerald-500/40 bg-emerald-500/12 text-emerald-300"
                    )}
                  >
                    {statusLabel}
                  </span>
                </div>
                <h1 className="mt-2 font-head-arena text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl lg:text-[2.125rem] lg:leading-[1.15]">
                  {auction.name}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {formatAuctionStartLocal(auctionDateToUtcMs(auction.date)) || "—"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {ruleChips.map(({ icon: Icon, label, value }) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/35 px-3 py-2 shadow-inner backdrop-blur-sm"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-arena-cyan">
                        <Icon className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 leading-tight">
                        <p className="font-head-arena text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                          {label}
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-foreground">{value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex w-full flex-col gap-4 lg:w-[min(100%,22rem)] lg:shrink-0">
                <div className="flex flex-wrap gap-2">
                  {auction.status === "draft" && (
                    <Button
                      onClick={handleStartAuction}
                      className={cn(
                        "h-10 min-h-10 flex-1 gap-2 px-5 font-head-arena text-[11px] font-bold uppercase tracking-wider shadow-lg shadow-primary/25 sm:flex-none",
                        ARENA_BTN_CYAN
                      )}
                    >
                      <Play className="h-4 w-4" />
                      Start auction
                    </Button>
                  )}
                  {auction.status === "active" && (
                    <>
                      <Link href={`/admin/auction/${id}/live`} className="flex-1 sm:flex-none">
                        <Button
                          className={cn(
                            "h-10 w-full min-w-[9rem] gap-2 font-head-arena text-[11px] font-bold uppercase tracking-wider",
                            ARENA_BTN_MAGENTA
                          )}
                        >
                          <Radio className="h-4 w-4" />
                          Live control
                        </Button>
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCompleteAuction}
                        className={cn(
                          "h-10 font-head-arena text-[11px] font-semibold uppercase tracking-wider",
                          ARENA_BTN_OUTLINE
                        )}
                      >
                        Mark complete
                      </Button>
                    </>
                  )}
                </div>
                <div>
                  <p className="mb-2 font-head-arena text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    Quick access
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
                    <Link
                      href={`/auction/${id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "group flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 transition-all",
                        "hover:border-primary/25 hover:bg-primary/[0.07]"
                      )}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-arena-cyan group-hover:border-primary/30">
                        <ExternalLink className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 text-left">
                        <span className="block font-head-arena text-[10px] font-bold uppercase tracking-wide text-muted-foreground group-hover:text-foreground">
                          Public viewer
                        </span>
                        <span className="text-xs font-medium text-foreground/90">Open live board</span>
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={handleCopyViewerLink}
                      disabled={viewerCopied}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-left transition-all",
                        "hover:border-primary/25 hover:bg-primary/[0.07] disabled:opacity-60"
                      )}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-muted-foreground">
                        {viewerCopied ? <Copy className="h-4 w-4 text-emerald-400" /> : <Link2 className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-head-arena text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          Share link
                        </span>
                        <span className="text-xs font-medium text-foreground/90">
                          {viewerCopied ? "Copied to clipboard" : "Copy viewer URL"}
                        </span>
                      </span>
                    </button>
                    {auction.status === "draft" && (
                      <>
                        <Link
                          href={`/auction/${id}/register`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "group flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2.5 transition-all",
                            "hover:border-primary/35 hover:bg-primary/10"
                          )}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-black/30 text-arena-cyan">
                            <UserPlus className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 text-left">
                            <span className="block font-head-arena text-[10px] font-bold uppercase tracking-wide text-arena-cyan/90">
                              Player signup
                            </span>
                            <span className="text-xs font-medium text-foreground/90">Open register page</span>
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={handleCopyRegisterLink}
                          disabled={registerLinkCopied}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2.5 text-left transition-all",
                            "hover:border-primary/35 hover:bg-primary/10 disabled:opacity-60"
                          )}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-black/30 text-arena-cyan">
                            {registerLinkCopied ? <Copy className="h-4 w-4 text-emerald-400" /> : <Link2 className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-head-arena text-[10px] font-bold uppercase tracking-wide text-arena-cyan/90">
                              Invite players
                            </span>
                            <span className="text-xs font-medium text-foreground/90">
                              {registerLinkCopied ? "Copied register link" : "Copy register URL"}
                            </span>
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-[1.35rem] border border-white/[0.06] bg-black/25 p-4 shadow-inner backdrop-blur-md sm:p-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-head-arena text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Session overview
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground/90">Live counts for this auction</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile label="Teams" value={teams?.length ?? 0} sub="In this auction" icon={Users} tone="default" />
            <StatTile
              label="Pool size"
              value={players?.length ?? 0}
              sub="Total players"
              icon={UserCircle2}
              tone="draft"
            />
            <StatTile
              label="Available"
              value={availablePlayers.length}
              sub="Ready to sell"
              icon={UserPlus}
              tone="live"
              highlight={availablePlayers.length > 0}
            />
            <StatTile
              label="Sold"
              value={soldPlayers.length}
              sub="Gone to teams"
              icon={Trophy}
              tone="complete"
            />
          </div>
        </section>

        <div className={ARENA_WORKSPACE_SHELL}>
          <Tabs defaultValue="teams" className="gap-0">
          <TabsList className="h-auto w-full gap-1.5 overflow-x-auto rounded-2xl border border-white/[0.06] bg-black/35 p-1.5 shadow-inner sm:inline-flex sm:w-auto">
            <TabsTrigger
              value="teams"
              className="gap-2 rounded-xl px-5 py-3 font-head-arena text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-all data-[state=active]:border data-[state=active]:border-primary/35 data-[state=active]:bg-gradient-to-b data-[state=active]:from-primary/20 data-[state=active]:to-primary/5 data-[state=active]:text-arena-cyan data-[state=active]:shadow-lg data-[state=active]:shadow-primary/15"
            >
              <Users className="h-4 w-4" />
              Teams ({teams?.length || 0})
            </TabsTrigger>
            <TabsTrigger
              value="players"
              className="gap-2 rounded-xl px-5 py-3 font-head-arena text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-all data-[state=active]:border data-[state=active]:border-primary/35 data-[state=active]:bg-gradient-to-b data-[state=active]:from-primary/20 data-[state=active]:to-primary/5 data-[state=active]:text-arena-cyan data-[state=active]:shadow-lg data-[state=active]:shadow-primary/15"
            >
              <User className="h-4 w-4" />
              Players ({players?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="teams" className="mt-3 focus-visible:outline-none">
            <Card
              className={cn(
                ARENA_GLASS_CARD,
                "overflow-hidden border-white/[0.08] bg-[color-mix(in_oklab,var(--arena-glass)_88%,transparent)] shadow-xl shadow-black/30"
              )}
            >
              <CardHeader className={cn(ARENA_CARD_HEADER, "flex flex-row items-center justify-between gap-4 px-6 py-5")}>
                <div>
                  <CardTitle className="font-head-arena text-lg tracking-tight">Teams</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    Budgets, slots, and pre-auction assignments
                  </CardDescription>
                </div>
                {auction.status === "draft" && (
                  <Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className={cn("gap-2 font-head-arena text-[11px] font-bold uppercase tracking-wider", ARENA_BTN_CYAN)}>
                        <Plus className="h-4 w-4" />
                        Add team
                      </Button>
                    </DialogTrigger>
                    <DialogContent className={cn(ARENA_DIALOG_SURFACE, "max-w-md")}>
                      <DialogHeader>
                        <DialogTitle className="font-head-arena text-xl">Add team</DialogTitle>
                        <DialogDescription>Creates a new buyer with budget and slot limits.</DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleAddTeam} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="teamName">Team Name</Label>
                          <Input
                            id="teamName"
                            value={teamName}
                            onChange={(e) => setTeamName(e.target.value)}
                            placeholder="e.g., Mumbai Indians"
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="captainName">Captain Name (optional)</Label>
                          <Input
                            id="captainName"
                            value={captainName}
                            onChange={(e) => setCaptainName(e.target.value)}
                            placeholder="e.g., Rohit Sharma"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="teamBudget">
                            Budget (default: {auction.budget})
                          </Label>
                          <Input
                            id="teamBudget"
                            type="number"
                            value={teamBudget}
                            onChange={(e) => setTeamBudget(e.target.value)}
                            placeholder={auction.budget.toString()}
                          />
                        </div>
                        <Button type="submit" disabled={loading} className={ARENA_BTN_CYAN}>
                          {loading ? "Adding…" : "Add team"}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent className="px-4 pb-5 pt-0 sm:px-6">
                {!teams || teams.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 bg-black/25 py-12 text-center text-sm leading-relaxed text-muted-foreground">
                    No teams yet. Add at least one team before starting the auction.
                  </p>
                ) : (
                  <div className={ARENA_TABLE_FRAME}>
                    <Table>
                      <TableHeader className="bg-gradient-to-b from-white/[0.07] to-transparent [&_tr]:border-white/[0.06]">
                        <TableRow className="border-white/[0.06] hover:bg-transparent">
                          <TableHead className="h-11 px-4 font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground first:pl-5">
                            Team
                          </TableHead>
                          <TableHead className="h-11 px-4 font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Captain
                          </TableHead>
                          <TableHead className="h-11 px-4 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Budget
                          </TableHead>
                          <TableHead className="h-11 max-w-[5.5rem] whitespace-normal px-4 text-right font-head-arena text-[10px] font-bold uppercase leading-tight tracking-wider text-muted-foreground">
                            Points left
                          </TableHead>
                          <TableHead className="h-11 px-4 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Players
                          </TableHead>
                          <TableHead className="h-11 px-4 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Slots
                          </TableHead>
                          <TableHead className="h-11 px-4 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Max bid
                          </TableHead>
                          {auction.status === "completed" && (
                            <TableHead className="h-11 px-4 pr-5 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Results
                            </TableHead>
                          )}
                          {auction.status === "draft" && (
                            <TableHead className="h-11 px-4 pr-5 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Actions
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teams.map((team) => (
                          <TableRow
                            key={team._id}
                            className="cursor-pointer border-border/40 hover:bg-primary/[0.04]"
                            onClick={() => setSelectedTeamForSold({ id: team._id, name: team.name })}
                          >
                            <TableCell className="px-4 py-3 pl-5 font-medium text-foreground">{team.name}</TableCell>
                            <TableCell className="px-4 py-3 text-muted-foreground">{team.captainName || "—"}</TableCell>
                            <TableCell className="px-4 py-3 text-right tabular-nums">{team.totalBudget}</TableCell>
                            <TableCell className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-arena-cyan">
                              {team.remainingBudget}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-right tabular-nums">{team.playersCount}</TableCell>
                            <TableCell className="px-4 py-3 text-right tabular-nums">{team.remainingSlots}</TableCell>
                            <TableCell className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-arena-magenta">
                              {team.maxBid}
                            </TableCell>
                            {auction.status === "completed" && (
                              <TableCell className="px-4 py-3 pr-5 text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={cn("h-8 text-[11px] font-semibold", ARENA_BTN_OUTLINE)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePrintTeamPdf(team._id, team.name);
                                  }}
                                  disabled={teamPrintingId === team._id}
                                >
                                  {teamPrintingId === team._id ? "Downloading…" : "Results"}
                                </Button>
                              </TableCell>
                            )}
                            {auction.status === "draft" && (
                              <TableCell className="px-4 py-3 pr-5 text-right">
                                <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className={cn("h-8 gap-1 text-[11px] font-semibold", ARENA_BTN_OUTLINE)}
                                    onClick={() =>
                                      setAssignDialog({
                                        open: true,
                                        teamId: team._id,
                                        teamName: team.name,
                                      })
                                    }
                                  >
                                    Assign
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Delete team"
                                    onClick={() => handleDeleteTeam(team._id)}
                                    className="h-8 w-8 rounded-lg border border-transparent text-muted-foreground hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="players" className="mt-3 focus-visible:outline-none">
            <Card
              className={cn(
                ARENA_GLASS_CARD,
                "overflow-hidden border-white/[0.08] bg-[color-mix(in_oklab,var(--arena-glass)_88%,transparent)] shadow-xl shadow-black/30"
              )}
            >
              <CardHeader className={cn(ARENA_CARD_HEADER, "space-y-0 px-6 py-5 pb-4")}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="font-head-arena text-lg tracking-tight">Player pool</CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      Add manually or share the register link — edit names, phone, and base price in draft
                    </CardDescription>
                  </div>
                  {auction.status === "draft" && (
                    <Dialog open={playerDialogOpen} onOpenChange={setPlayerDialogOpen}>
                      <DialogTrigger asChild>
                        <Button
                          size="sm"
                          className={cn(
                            "gap-2 self-start font-head-arena text-[11px] font-bold uppercase tracking-wider sm:self-auto",
                            ARENA_BTN_CYAN
                          )}
                        >
                          <Plus className="h-4 w-4" />
                          Add player
                        </Button>
                      </DialogTrigger>
                    <DialogContent className={cn(ARENA_DIALOG_SURFACE, "max-w-md")}>
                      <DialogHeader>
                        <DialogTitle className="font-head-arena text-xl">Add player</DialogTitle>
                        <DialogDescription>Appears in the pool immediately with your chosen base price.</DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleAddPlayer} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="playerName">Player Name</Label>
                          <Input
                            id="playerName"
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            placeholder="e.g., Virat Kohli"
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="playerBasePrice">
                            Base Price (default: {auction.minBid})
                          </Label>
                          <Input
                            id="playerBasePrice"
                            type="number"
                            value={playerBasePrice}
                            onChange={(e) => setPlayerBasePrice(e.target.value)}
                            placeholder={auction.minBid.toString()}
                          />
                        </div>
                        <Button type="submit" disabled={loading} className={ARENA_BTN_CYAN}>
                          {loading ? "Adding…" : "Add player"}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                  )}
                </div>
                {auction.status === "draft" && (
                  <div className="mt-4 flex flex-col gap-2 rounded-xl border border-primary/25 bg-gradient-to-r from-primary/[0.08] via-primary/[0.03] to-transparent p-3 shadow-inner sm:flex-row sm:items-stretch sm:gap-3 sm:p-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-black/35 text-arena-cyan shadow-sm">
                        <Link2 className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-head-arena text-[9px] font-bold uppercase tracking-[0.16em] text-arena-cyan/90">
                          Share for self-registration
                        </p>
                        <Input
                          readOnly
                          value={
                            registerUrlPreview ||
                            "Configure NEXT_PUBLIC_VIEWER_BASE_URL for a copy-ready link"
                          }
                          className="mt-1.5 h-9 border-white/10 bg-black/40 font-mono text-[11px] leading-tight"
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 sm:flex-col sm:justify-center">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-9 flex-1 gap-1.5 bg-black/40 text-[11px] font-bold uppercase tracking-wide sm:flex-none"
                        onClick={handleCopyRegisterLink}
                        disabled={registerLinkCopied}
                      >
                        {registerLinkCopied ? "Copied" : "Copy URL"}
                      </Button>
                      <Link href={`/auction/${id}/register`} target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn("h-9 w-full gap-1.5 text-[11px] font-semibold", ARENA_BTN_OUTLINE)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Preview
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent className="px-4 pb-5 pt-0 sm:px-6">
                {!players || players.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 bg-black/25 py-12 text-center text-sm leading-relaxed text-muted-foreground">
                    No players yet. Use <span className="text-foreground/90">Add player</span> or share the registration
                    link above.
                  </p>
                ) : (
                  <div className={ARENA_TABLE_FRAME}>
                    <Table>
                      <TableHeader className="bg-gradient-to-b from-white/[0.07] to-transparent [&_tr]:border-white/[0.06]">
                        <TableRow className="border-white/[0.06] hover:bg-transparent">
                          <TableHead className="h-11 px-4 pl-5 font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Player
                          </TableHead>
                          <TableHead className="h-11 px-4 font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Phone
                          </TableHead>
                          <TableHead className="h-11 px-4 font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Source
                          </TableHead>
                          <TableHead className="h-11 px-4 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Base
                          </TableHead>
                          <TableHead className="h-11 px-4 font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Status
                          </TableHead>
                          <TableHead className="h-11 px-4 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Sold
                          </TableHead>
                          {auction.status === "draft" && (
                            <TableHead className="h-11 px-4 pr-5 text-right font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Actions
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {players.map((player) => {
                          const soldToTeam = teams?.find((t) => t._id === player.soldTo);
                          return (
                            <TableRow key={player._id} className="border-white/[0.05] hover:bg-primary/[0.04]">
                              <TableCell className="px-4 py-3 pl-5 font-medium text-foreground">{player.name}</TableCell>
                              <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {player.phone ?? "—"}
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                {player.selfRegistered ? (
                                  <Badge
                                    variant="outline"
                                    className="border-primary/30 bg-primary/10 text-[10px] font-head-arena font-bold uppercase tracking-wide text-arena-cyan"
                                  >
                                    Self-reg
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Admin</span>
                                )}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right text-sm tabular-nums font-medium">
                                {player.basePrice}
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                <Badge
                                  variant={
                                    player.status === "sold"
                                      ? "default"
                                      : player.status === "unsold"
                                        ? "destructive"
                                        : "outline"
                                  }
                                  className={cn(
                                    "text-[10px] font-head-arena font-bold uppercase tracking-wide",
                                    player.status === "sold" && "bg-sold text-sold-foreground",
                                    player.status === "available" && "border-emerald-500/35 text-emerald-400/90"
                                  )}
                                >
                                  {player.status}
                                  {soldToTeam && ` · ${soldToTeam.name}`}
                                </Badge>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                                {player.soldPrice ? (
                                  <span className="font-semibold text-primary">{player.soldPrice}</span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              {auction.status === "draft" && (
                                <TableCell className="px-4 py-3 pr-5 text-right">
                                  <div className="flex justify-end gap-1">
                                    {player.status === "available" && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        onClick={() => openEditPlayer(player)}
                                        title="Edit player"
                                        className="h-8 w-8 rounded-lg border border-transparent text-muted-foreground hover:border-primary/25 hover:bg-primary/10 hover:text-arena-cyan"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      type="button"
                                      onClick={() => handleDeletePlayer(player._id)}
                                      title="Remove player"
                                      className="h-8 w-8 rounded-lg border border-transparent text-muted-foreground hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </div>

        <Dialog
          open={!!selectedTeamForSold}
          onOpenChange={(open) => {
            if (!open) setSelectedTeamForSold(null);
          }}
        >
          <DialogContent className={cn(ARENA_DIALOG_SURFACE, "max-w-2xl")}>
            <DialogHeader>
              <DialogTitle className="font-head-arena text-xl">
                {selectedTeamForSold
                  ? `Sold players — ${selectedTeamForSold.name}`
                  : "Sold players"}
              </DialogTitle>
              <DialogDescription>Players purchased by this team.</DialogDescription>
            </DialogHeader>

            {!players ? (
              <p className="text-sm text-muted-foreground">Loading players...</p>
            ) : selectedTeamSoldPlayers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sold players for this team.</p>
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player Name</TableHead>
                      <TableHead className="text-right">Sold Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedTeamSoldPlayers.map((player) => (
                      <TableRow key={player._id}>
                        <TableCell className="font-medium">{player.name}</TableCell>
                        <TableCell className="text-right">
                          {typeof player.soldPrice === "number" ? `${player.soldPrice} pts` : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={editPlayerDialogOpen}
          onOpenChange={(open) => {
            setEditPlayerDialogOpen(open);
            if (!open) setEditPlayerId(null);
          }}
        >
          <DialogContent className={cn(ARENA_DIALOG_SURFACE, "max-w-lg")}>
            <DialogHeader>
              <DialogTitle className="font-head-arena text-xl">Edit player</DialogTitle>
              <DialogDescription>
                Update pool details in draft. Clear phone to remove it from the record.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSaveEditPlayer} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="editPlayerName">Player name</Label>
                <Input
                  id="editPlayerName"
                  value={editPlayerName}
                  onChange={(e) => setEditPlayerName(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="editPlayerPhone">Phone (optional)</Label>
                <Input
                  id="editPlayerPhone"
                  type="tel"
                  inputMode="numeric"
                  value={editPlayerPhone}
                  onChange={(e) => setEditPlayerPhone(e.target.value)}
                  placeholder="10–15 digits, or leave blank"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="editPlayerBasePrice">Base price</Label>
                <Input
                  id="editPlayerBasePrice"
                  type="number"
                  min={1}
                  step={1}
                  value={editPlayerBasePrice}
                  onChange={(e) => setEditPlayerBasePrice(e.target.value)}
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={ARENA_BTN_OUTLINE}
                  onClick={() => {
                    setEditPlayerDialogOpen(false);
                    setEditPlayerId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} className={ARENA_BTN_CYAN}>
                  {loading ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={assignDialog.open}
          onOpenChange={(open) => {
            if (!open) {
              setAssignDialog({ open: false, teamId: null, teamName: null });
              setAssignPlayerId("");
            }
          }}
        >
          <DialogContent className={cn(ARENA_DIALOG_SURFACE, "max-w-lg")}>
            <DialogHeader>
              <DialogTitle className="font-head-arena text-xl">
                Assign to {assignDialog.teamName ?? "team"}
              </DialogTitle>
              <DialogDescription>Pre-assign a pool player before the auction goes live (draft only).</DialogDescription>
            </DialogHeader>

            {auction?.status !== "draft" ? (
              <p className="text-sm text-muted-foreground">
                Player assignment is disabled because the auction is not in Draft.
              </p>
            ) : availablePlayers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No available players in the pool.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="assignPlayer">Select Player</Label>
                  <select
                    id="assignPlayer"
                    className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm shadow-inner focus:border-primary/40 focus:outline-none"
                    value={assignPlayerId}
                    onChange={(e) => setAssignPlayerId(e.target.value)}
                  >
                    <option value="">Choose a player</option>
                    {availablePlayers.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name} (Base: {p.basePrice} pts)
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  onClick={handleAssignPlayerToTeam}
                  disabled={loading || !assignPlayerId || !assignDialog.teamId}
                  className={ARENA_BTN_CYAN}
                >
                  {loading ? "Assigning…" : "Confirm assign"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
