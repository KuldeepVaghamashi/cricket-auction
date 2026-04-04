"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, Play, Eye, Settings, UserPlus } from "lucide-react";
import Link from "next/link";
import type { AuctionWithId } from "@/lib/types";
import { datetimeLocalValueToIsoUtc } from "@/lib/auction-date";
import { StatTile } from "@/components/arena/stat-tile";
import {
  ARENA_GLASS_CARD,
  ARENA_GRADIENT_TEXT,
  ARENA_BTN_CYAN,
  ARENA_BTN_OUTLINE,
} from "@/components/arena/arena-classes";
import { cn } from "@/lib/utils";
import { resolvePublicViewerBaseUrl } from "@/lib/public-url";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function AdminDashboard() {
  const { data: auctions, mutate } = useSWR<AuctionWithId[]>("/api/auctions", fetcher);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [createDateError, setCreateDateError] = useState("");
  const [copiedRegisterAuctionId, setCopiedRegisterAuctionId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    date: "",
    budget: "100",
    minIncrement: "2",
    minBid: "2",
    maxPlayersPerTeam: "11",
  });

  const stats = useMemo(() => {
    if (!auctions?.length) {
      return { total: 0, active: 0, completed: 0, draft: 0, poolHint: "—" };
    }
    const active = auctions.filter((a) => a.status === "active").length;
    const completed = auctions.filter((a) => a.status === "completed").length;
    const draft = auctions.filter((a) => a.status === "draft").length;
    const poolHint =
      active > 0
        ? `${active} live session${active > 1 ? "s" : ""}`
        : completed > 0
          ? `${completed} wrapped`
          : "Ready to start";
    return { total: auctions.length, active, completed, draft, poolHint };
  }, [auctions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      setCreateDateError("");
      const dateIso = datetimeLocalValueToIsoUtc(formData.date);
      if (!dateIso) {
        setCreateDateError("Choose a valid date and time for the auction start.");
        setLoading(false);
        return;
      }
      const res = await fetch("/api/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, date: dateIso }),
      });

      if (res.ok) {
        mutate();
        setCreateDialogOpen(false);
        setFormData({
          name: "",
          date: "",
          budget: "100",
          minIncrement: "2",
          minBid: "2",
          maxPlayersPerTeam: "11",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const copyPlayerRegisterLink = async (auctionId: string) => {
    try {
      const base = resolvePublicViewerBaseUrl();
      if (!base) {
        alert("Set NEXT_PUBLIC_VIEWER_BASE_URL or open admin from your public site to copy a full link.");
        return;
      }
      await navigator.clipboard.writeText(`${base}/auction/${auctionId}/register`);
      setCopiedRegisterAuctionId(auctionId);
      window.setTimeout(() => setCopiedRegisterAuctionId(null), 2000);
    } catch {
      alert("Unable to copy link.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this auction?")) return;

    await fetch(`/api/auctions/${id}`, { method: "DELETE" });
    mutate();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge className="border border-primary/35 bg-primary/12 font-head-arena text-[10px] font-bold uppercase tracking-wider text-arena-cyan">
            Active
          </Badge>
        );
      case "completed":
        return (
          <Badge
            variant="secondary"
            className="border-border/80 bg-secondary/40 font-head-arena text-[10px] font-bold uppercase tracking-wider"
          >
            Completed
          </Badge>
        );
      default:
        return (
          <Badge
            variant="outline"
            className="border-border font-head-arena text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
          >
            Draft
          </Badge>
        );
    }
  };

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-8 sm:px-8 sm:py-10">
      <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-head-arena text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-[2.625rem] lg:leading-tight">
            Arena <span className={ARENA_GRADIENT_TEXT}>Command</span>
          </h1>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground sm:text-[15px]">
            Orchestrate cricket league auctions with real-time control and a clear read on every session.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              setCreateDialogOpen(open);
              if (!open) setCreateDateError("");
            }}
          >
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "font-head-arena gap-2 text-xs font-bold uppercase tracking-wider",
                  ARENA_BTN_OUTLINE
                )}
              >
                <Plus className="h-4 w-4" />
                Create Auction
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border bg-card">
              <DialogHeader>
                <DialogTitle className="font-head-arena">Create New Auction</DialogTitle>
                <DialogDescription>
                  Set up a new cricket auction with your custom settings.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">Auction Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., IPL 2024 Mega Auction"
                    required
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="date">Auction start (your local time)</Label>
                  <Input
                    id="date"
                    type="datetime-local"
                    value={formData.date}
                    onChange={(e) => {
                      setCreateDateError("");
                      setFormData({ ...formData, date: e.target.value });
                    }}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Viewers see the same instant on their device, in their timezone.
                  </p>
                  {createDateError ? (
                    <p className="text-sm text-destructive">{createDateError}</p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="budget">Budget per Team</Label>
                    <Input
                      id="budget"
                      type="number"
                      value={formData.budget}
                      onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                      min="1"
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="maxPlayers">Max Players/Team</Label>
                    <Input
                      id="maxPlayers"
                      type="number"
                      value={formData.maxPlayersPerTeam}
                      onChange={(e) => setFormData({ ...formData, maxPlayersPerTeam: e.target.value })}
                      min="1"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="minBid">Min Base Price</Label>
                    <Input
                      id="minBid"
                      type="number"
                      value={formData.minBid}
                      onChange={(e) => setFormData({ ...formData, minBid: e.target.value })}
                      min="1"
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="minIncrement">Bid Increment</Label>
                    <Input
                      id="minIncrement"
                      type="number"
                      value={formData.minIncrement}
                      onChange={(e) => setFormData({ ...formData, minIncrement: e.target.value })}
                      min="1"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className={ARENA_BTN_CYAN}
                >
                  {loading ? "Creating..." : "Create Auction"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!auctions ? (
        <div className="py-16 text-center text-muted-foreground">Loading auctions…</div>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Total auctions" value={stats.total} sub="All sessions" />
            <StatTile
              label="Live now"
              value={stats.active}
              sub={stats.poolHint}
              highlight={stats.active > 0}
            />
            <StatTile label="Draft" value={stats.draft} sub="Setup in progress" />
            <StatTile label="Completed" value={stats.completed} sub="Archived results" />
          </div>

          {auctions.length === 0 ? (
            <Card className={cn(ARENA_GLASS_CARD, "py-12 text-center")}>
              <CardContent>
                <p className="mb-4 text-muted-foreground">
                  No auctions yet. Create your first auction to get started.
                </p>
                <Button
                  onClick={() => setCreateDialogOpen(true)}
                  className={cn("font-head-arena gap-2", ARENA_BTN_CYAN)}
                >
                  <Plus className="h-4 w-4" />
                  Create Auction
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {auctions.map((auction) => (
                <Card key={auction._id} className={cn(ARENA_GLASS_CARD, "flex flex-col gap-0 py-0")}>
                  <CardHeader className="gap-3 border-b border-border/60 pb-4 pt-6">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="font-head-arena text-lg font-bold">{auction.name}</CardTitle>
                        <CardDescription className="mt-1">
                          {new Date(auction.date).toLocaleDateString("en-US", {
                            dateStyle: "medium",
                          })}
                        </CardDescription>
                      </div>
                      {getStatusBadge(auction.status)}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col pb-6 pt-4">
                    <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Budget:</span>{" "}
                        <span className="font-medium">{auction.budget} pts</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Max Players:</span>{" "}
                        <span className="font-medium">{auction.maxPlayersPerTeam}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Min Bid:</span>{" "}
                        <span className="font-medium">{auction.minBid} pts</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Increment:</span>{" "}
                        <span className="font-medium">+{auction.minIncrement}</span>
                      </div>
                    </div>

                    <div className="mt-auto flex flex-wrap gap-2 border-t border-border/60 pt-4">
                      <Link href={`/admin/auction/${auction._id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn("gap-1", ARENA_BTN_OUTLINE)}
                        >
                          <Settings className="h-3.5 w-3.5" />
                          Manage
                        </Button>
                      </Link>
                      {auction.status === "draft" && (
                        <>
                          <Link href={`/auction/${auction._id}/register`} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className={cn("gap-1", ARENA_BTN_OUTLINE)}>
                              <UserPlus className="h-3.5 w-3.5" />
                              Register
                            </Button>
                          </Link>
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn("gap-1", ARENA_BTN_OUTLINE)}
                            disabled={copiedRegisterAuctionId === auction._id}
                            onClick={() => copyPlayerRegisterLink(auction._id)}
                          >
                            {copiedRegisterAuctionId === auction._id ? "Copied" : "Copy register link"}
                          </Button>
                        </>
                      )}
                      {auction.status === "active" && (
                        <Link href={`/admin/auction/${auction._id}/live`}>
                          <Button
                            size="sm"
                            className={cn("gap-1", ARENA_BTN_CYAN)}
                          >
                            <Play className="h-3.5 w-3.5" />
                            Control
                          </Button>
                        </Link>
                      )}
                      <Link href={`/auction/${auction._id}`} target="_blank">
                        <Button variant="outline" size="sm" className={cn("gap-1", ARENA_BTN_OUTLINE)}>
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(auction._id)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
