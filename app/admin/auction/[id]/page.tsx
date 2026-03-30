"use client";

import { useState, use } from "react";
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
  DollarSign 
} from "lucide-react";
import type { AuctionWithId, TeamWithStats, PlayerWithId } from "@/lib/types";

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
  const [viewerCopied, setViewerCopied] = useState(false);

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

  const handleCopyViewerLink = async () => {
    try {
      const publicBaseUrl =
        process.env.NEXT_PUBLIC_VIEWER_BASE_URL?.toString() ?? "";
      const url =
        publicBaseUrl && typeof window !== "undefined"
          ? `${publicBaseUrl}/auction/${id}`
          : `${window.location.origin}/auction/${id}`;
      await navigator.clipboard.writeText(url);
      setViewerCopied(true);
      window.setTimeout(() => setViewerCopied(false), 2000);
    } catch {
      alert("Unable to copy viewer link. You can open the viewer instead.");
    }
  };

  if (!auction) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-muted-foreground">Loading auction...</div>
      </div>
    );
  }

  const availablePlayers = players?.filter((p) => p.status === "available") || [];
  const soldPlayers = players?.filter((p) => p.status === "sold") || [];
  const unsoldPlayers = players?.filter((p) => p.status === "unsold") || [];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">{auction.name}</h1>
              <p className="text-muted-foreground">
                {new Date(auction.date).toLocaleDateString("en-US", {
                  dateStyle: "full",
                })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {auction.status === "draft" && (
              <Button onClick={handleStartAuction} className="gap-2">
                <Play className="h-4 w-4" />
                Start Auction
              </Button>
            )}
            {auction.status === "active" && (
              <>
                <Link href={`/admin/auction/${id}/live`}>
                  <Button className="gap-2">
                    <Play className="h-4 w-4" />
                    Auction Control
                  </Button>
                </Link>
                <Button variant="outline" onClick={handleCompleteAuction}>
                  Mark Complete
                </Button>
              </>
            )}
            {auction.status === "completed" && (
              <Button
                variant="outline"
                onClick={handlePrintPdf}
                disabled={printing}
                className="gap-2"
              >
                Print PDF Results
              </Button>
            )}
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
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Teams</CardDescription>
              <CardTitle className="text-3xl">{teams?.length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Players</CardDescription>
              <CardTitle className="text-3xl">{players?.length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Available</CardDescription>
              <CardTitle className="text-3xl text-available">{availablePlayers.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Sold</CardDescription>
              <CardTitle className="text-3xl text-sold">{soldPlayers.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="teams">
          <TabsList>
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
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
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
                          {auction.status === "draft" && <TableHead></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teams.map((team) => (
                          <TableRow key={team._id}>
                            <TableCell className="font-medium">{team.name}</TableCell>
                            <TableCell>{team.captainName || "-"}</TableCell>
                            <TableCell className="text-right">{team.totalBudget}</TableCell>
                            <TableCell className="text-right">{team.remainingBudget}</TableCell>
                            <TableCell className="text-right">{team.playersCount}</TableCell>
                            <TableCell className="text-right">{team.remainingSlots}</TableCell>
                            <TableCell className="text-right font-medium text-primary">
                              {team.maxBid}
                            </TableCell>
                            {auction.status === "draft" && (
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteTeam(team._id)}
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
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Player Pool</CardTitle>
                  <CardDescription>Manage players available for auction</CardDescription>
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
                          <TableHead className="text-right">Base Price</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Sold Price</TableHead>
                          {auction.status === "draft" && <TableHead></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {players.map((player) => {
                          const soldToTeam = teams?.find((t) => t._id === player.soldTo);
                          return (
                            <TableRow key={player._id}>
                              <TableCell className="font-medium">{player.name}</TableCell>
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
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeletePlayer(player._id)}
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
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
    </div>
  );
}
