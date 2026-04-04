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
  DollarSign,
  UserPlus,
  Pencil,
} from "lucide-react";
import type { AuctionWithId, TeamWithStats, PlayerWithId } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ARENA_GLASS_CARD,
  ARENA_CARD_HEADER,
  ARENA_GRADIENT_TEXT,
  ARENA_BTN_CYAN,
  ARENA_BTN_MAGENTA,
  ARENA_BTN_OUTLINE,
} from "@/components/arena/arena-classes";
import { auctionDateToUtcMs, formatAuctionStartLocal } from "@/lib/auction-date";
import { resolvePublicViewerBaseUrl } from "@/lib/public-url";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const TEAM_BUDGET_COLOR_CLASS = "text-primary";

function getTeamColorClass(_teamId: string | null | undefined) {
  // Single consistent shade requested by admin UI.
  return TEAM_BUDGET_COLOR_CLASS;
}

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
      <div className="mx-auto max-w-[1480px] px-4 py-8 sm:px-8">
        <div className="text-center text-muted-foreground">Loading auction…</div>
      </div>
    );
  }

  const availablePlayers = players?.filter((p) => p.status === "available") || [];
  const soldPlayers = players?.filter((p) => p.status === "sold") || [];
  const unsoldPlayers = players?.filter((p) => p.status === "unsold") || [];
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

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-8 sm:px-8">
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="font-head-arena text-2xl font-extrabold tracking-tight sm:text-3xl">
                {auction.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatAuctionStartLocal(auctionDateToUtcMs(auction.date)) || "—"}
              </p>
              <p className="mt-2 font-head-arena text-xs uppercase tracking-[0.12em] text-arena-magenta/90">
                Manage · Teams & players
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {auction.status === "draft" && (
              <Button
                onClick={handleStartAuction}
                className={cn("font-head-arena gap-2 text-xs font-bold uppercase tracking-wider", ARENA_BTN_CYAN)}
              >
                <Play className="h-4 w-4" />
                Start Auction
              </Button>
            )}
            {auction.status === "active" && (
              <>
                <Link href={`/admin/auction/${id}/live`}>
                  <Button className={cn("font-head-arena gap-2 text-xs font-bold uppercase tracking-wider", ARENA_BTN_MAGENTA)}>
                    <Play className="h-4 w-4" />
                    Auction Control
                  </Button>
                </Link>
                <Button variant="outline" onClick={handleCompleteAuction} className={ARENA_BTN_OUTLINE}>
                  Mark Complete
                </Button>
              </>
            )}
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
            {auction.status === "draft" && (
              <>
                <Link href={`/auction/${id}/register`} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" className={cn("gap-2", ARENA_BTN_OUTLINE)}>
                    <UserPlus className="h-4 w-4" />
                    Open Register Page
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  onClick={handleCopyRegisterLink}
                  className={cn("gap-2", ARENA_BTN_OUTLINE)}
                  disabled={registerLinkCopied}
                >
                  {registerLinkCopied ? "Copied" : "Copy Player Register Link"}
                </Button>
              </>
            )}
          </div>
        </div>

        <p className="-mt-4 text-sm text-muted-foreground">
          Status:{" "}
          <span className={cn(ARENA_GRADIENT_TEXT, "font-head-arena font-semibold")}>
            {auction.status === "active" ? "LIVE" : auction.status === "completed" ? "COMPLETE" : "DRAFT"}
          </span>
        </p>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className={cn(ARENA_GLASS_CARD, "gap-2 py-4")}>
            <CardHeader className="px-6 pb-0 pt-0">
              <CardDescription className="font-head-arena text-[10px] font-semibold uppercase tracking-[0.12em]">
                Teams
              </CardDescription>
              <CardTitle className="font-head-arena text-3xl font-extrabold">{teams?.length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card className={cn(ARENA_GLASS_CARD, "gap-2 py-4")}>
            <CardHeader className="px-6 pb-0 pt-0">
              <CardDescription className="font-head-arena text-[10px] font-semibold uppercase tracking-[0.12em]">
                Total Players
              </CardDescription>
              <CardTitle className="font-head-arena text-3xl font-extrabold">{players?.length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card className={cn(ARENA_GLASS_CARD, "gap-2 py-4")}>
            <CardHeader className="px-6 pb-0 pt-0">
              <CardDescription className="font-head-arena text-[10px] font-semibold uppercase tracking-[0.12em]">
                Available
              </CardDescription>
              <CardTitle className="font-head-arena text-3xl font-extrabold text-available">
                {availablePlayers.length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className={cn(ARENA_GLASS_CARD, "gap-2 py-4")}>
            <CardHeader className="px-6 pb-0 pt-0">
              <CardDescription className="font-head-arena text-[10px] font-semibold uppercase tracking-[0.12em]">
                Sold
              </CardDescription>
              <CardTitle className="font-head-arena text-3xl font-extrabold text-sold">{soldPlayers.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="teams">
          <TabsList className="h-auto w-full gap-1 overflow-x-auto rounded-xl border border-border/60 bg-secondary/40 p-1 sm:w-auto">
            <TabsTrigger value="teams" className="gap-2">
              <Users className="h-4 w-4" />
              Teams ({teams?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="players" className="gap-2">
              <User className="h-4 w-4" />
              Players ({players?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="teams" className="mt-4">
            <Card className={ARENA_GLASS_CARD}>
              <CardHeader className={cn(ARENA_CARD_HEADER, "flex flex-row items-center justify-between")}>
                <div>
                  <CardTitle>Teams</CardTitle>
                  <CardDescription>Manage participating teams</CardDescription>
                </div>
                {auction.status === "draft" && (
                  <Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="gap-2">
                        <Plus className="h-4 w-4" />
                        Add Team
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Team</DialogTitle>
                        <DialogDescription>
                          Add a new team to this auction.
                        </DialogDescription>
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
                        <Button type="submit" disabled={loading}>
                          {loading ? "Adding..." : "Add Team"}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent>
                {!teams || teams.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No teams added yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Team Name</TableHead>
                          <TableHead>Captain</TableHead>
                          <TableHead className="text-right">Budget</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right">Players</TableHead>
                          <TableHead className="text-right">Slots Left</TableHead>
                          <TableHead className="text-right">Max Bid</TableHead>
                          {auction.status === "completed" && <TableHead className="text-right">PDF</TableHead>}
                          {auction.status === "draft" && <TableHead></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teams.map((team) => (
                          <TableRow
                            key={team._id}
                            className="cursor-pointer"
                            onClick={() => setSelectedTeamForSold({ id: team._id, name: team.name })}
                          >
                            <TableCell className="font-medium">{team.name}</TableCell>
                            <TableCell>{team.captainName || "-"}</TableCell>
                            <TableCell className="text-right">{team.totalBudget}</TableCell>
                            <TableCell className={`text-right font-medium ${getTeamColorClass(team._id)}`}>
                              {team.remainingBudget}
                            </TableCell>
                            <TableCell className="text-right">{team.playersCount}</TableCell>
                            <TableCell className="text-right">{team.remainingSlots}</TableCell>
                            <TableCell className="text-right font-medium text-primary">
                              {team.maxBid}
                            </TableCell>
                            {auction.status === "completed" && (
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePrintTeamPdf(team._id, team.name);
                                  }}
                                  disabled={teamPrintingId === team._id}
                                >
                                  {teamPrintingId === team._id ? "Downloading..." : "Download PDF"}
                                </Button>
                              </TableCell>
                            )}
                            {auction.status === "draft" && (
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mr-2"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAssignDialog({
                                      open: true,
                                      teamId: team._id,
                                      teamName: team.name,
                                    });
                                  }}
                                >
                                  Assign Player
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteTeam(team._id);
                                  }}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
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

          <TabsContent value="players" className="mt-4">
            <Card className={ARENA_GLASS_CARD}>
              <CardHeader className={cn(ARENA_CARD_HEADER, "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between")}>
                <div>
                  <CardTitle>Player Pool</CardTitle>
                  <CardDescription>Manage players available for auction</CardDescription>
                  {auction.status === "draft" && (
                    <div className="mt-4 rounded-xl border border-primary/25 bg-primary/8 p-4">
                      <p className="font-head-arena text-[10px] font-bold uppercase tracking-wider text-primary">
                        Player self-registration
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Share the link below so players can add themselves (name + phone). Only works while this
                        auction is in draft.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          readOnly
                          value={registerUrlPreview || "Resolving public link…"}
                          className="font-mono text-xs sm:min-w-0 sm:flex-1"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="shrink-0"
                          onClick={handleCopyRegisterLink}
                          disabled={registerLinkCopied}
                        >
                          {registerLinkCopied ? "Copied" : "Copy link"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                {auction.status === "draft" && (
                  <Dialog open={playerDialogOpen} onOpenChange={setPlayerDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="gap-2">
                        <Plus className="h-4 w-4" />
                        Add Player
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Player</DialogTitle>
                        <DialogDescription>
                          Add a new player to the auction pool.
                        </DialogDescription>
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
                        <Button type="submit" disabled={loading}>
                          {loading ? "Adding..." : "Add Player"}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent>
                {!players || players.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No players added yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Player Name</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead className="text-right">Base Price</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Sold Price</TableHead>
                          {auction.status === "draft" && (
                            <TableHead className="text-right">Actions</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {players.map((player) => {
                          const soldToTeam = teams?.find((t) => t._id === player.soldTo);
                          return (
                            <TableRow key={player._id}>
                              <TableCell className="font-medium">{player.name}</TableCell>
                              <TableCell className="font-mono text-sm text-muted-foreground">
                                {player.phone ?? "—"}
                              </TableCell>
                              <TableCell>
                                {player.selfRegistered ? (
                                  <Badge variant="outline" className="text-[10px] uppercase">
                                    Self-reg
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Admin</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">{player.basePrice}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    player.status === "sold"
                                      ? "default"
                                      : player.status === "unsold"
                                      ? "destructive"
                                      : "outline"
                                  }
                                  className={
                                    player.status === "sold"
                                      ? "bg-sold text-sold-foreground"
                                      : ""
                                  }
                                >
                                  {player.status}
                                  {soldToTeam && ` - ${soldToTeam.name}`}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {player.soldPrice ? (
                                  <span className="font-medium text-primary">
                                    {player.soldPrice}
                                  </span>
                                ) : (
                                  "-"
                                )}
                              </TableCell>
                              {auction.status === "draft" && (
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    {player.status === "available" && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        onClick={() => openEditPlayer(player)}
                                        title="Edit player"
                                        className="text-muted-foreground hover:text-primary"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      type="button"
                                      onClick={() => handleDeletePlayer(player._id)}
                                      className="text-destructive hover:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4" />
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

        <Dialog
          open={!!selectedTeamForSold}
          onOpenChange={(open) => {
            if (!open) setSelectedTeamForSold(null);
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedTeamForSold
                  ? `Sold Players - ${selectedTeamForSold.name}`
                  : "Sold Players"}
              </DialogTitle>
              <DialogDescription>
                Team-wise sold player list.
              </DialogDescription>
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
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit player</DialogTitle>
              <DialogDescription>
                Change name, phone, or base price while the auction is in draft. Leave phone blank to remove it.
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
                  onClick={() => {
                    setEditPlayerDialogOpen(false);
                    setEditPlayerId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving…" : "Save"}
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
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                Assign player to {assignDialog.teamName ?? "team"}
              </DialogTitle>
              <DialogDescription>
                This works only before the auction starts (Draft).
              </DialogDescription>
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
                    className="h-10 rounded-md border bg-background px-3 text-sm"
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
                >
                  {loading ? "Assigning..." : "Assign to Team"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
