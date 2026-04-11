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
import {
  Plus,
  Trash2,
  Play,
  Eye,
  Settings,
  UserPlus,
  Layers,
  Radio,
  PenLine,
  CheckCircle2,
  Wallet,
  Users,
  Gavel,
  TrendingUp,
  Link2,
  Search,
} from "lucide-react";
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

const STATUS_ORDER: Record<string, number> = { active: 0, draft: 1, completed: 2 };

type AuctionFilter = "all" | "active" | "draft" | "completed";

export default function AdminDashboard() {
  const { data: auctions, mutate } = useSWR<AuctionWithId[]>("/api/auctions", fetcher);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [createDateError, setCreateDateError] = useState("");
  const [copiedRegisterAuctionId, setCopiedRegisterAuctionId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<AuctionFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    date: "",
    budget: "100",
    minIncrement: "2",
    minBid: "2",
    maxPlayersPerTeam: "11",
    thresholdAmount: "",
    thresholdIncrement: "",
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

  const visibleAuctions = useMemo(() => {
    if (!auctions?.length) return [];
    let list = [...auctions];
    if (listFilter !== "all") {
      list = list.filter((a) => a.status === listFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((a) => a.name.toLowerCase().includes(q));
    list.sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return list;
  }, [auctions, listFilter, searchQuery]);

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
          thresholdAmount: "",
          thresholdIncrement: "",
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

  const filterPills: { id: AuctionFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: auctions?.length ?? 0 },
    { id: "active", label: "Live", count: stats.active },
    { id: "draft", label: "Draft", count: stats.draft },
    { id: "completed", label: "Done", count: stats.completed },
  ];

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-8 sm:px-8 sm:py-10">
      <section className="relative mb-10 overflow-hidden rounded-3xl border border-border/50 bg-gradient-to-br from-primary/[0.08] via-[var(--arena-glass)] to-arena-magenta/[0.07] px-5 py-8 shadow-xl shadow-black/20 sm:px-8 sm:py-10">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-arena-magenta/15 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="font-head-arena text-[10px] font-bold uppercase tracking-[0.2em] text-arena-cyan/90">
              Admin · Sessions
            </p>
            <h1 className="mt-2 font-head-arena text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
              Arena <span className={ARENA_GRADIENT_TEXT}>Command</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              Create auctions, share player registration, and jump into live control — everything you need in one
              place.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Dialog
              open={createDialogOpen}
              onOpenChange={(open) => {
                setCreateDialogOpen(open);
                if (!open) setCreateDateError("");
              }}
            >
              <DialogTrigger asChild>
                <Button
                  className={cn(
                    "font-head-arena gap-2 px-5 text-xs font-bold uppercase tracking-wider shadow-lg shadow-primary/25",
                    ARENA_BTN_CYAN
                  )}
                >
                  <Plus className="h-4 w-4" />
                  New auction
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="thresholdAmount">Threshold Bid</Label>
                    <Input
                      id="thresholdAmount"
                      type="number"
                      value={formData.thresholdAmount}
                      onChange={(e) => setFormData({ ...formData, thresholdAmount: e.target.value })}
                      min="1"
                      placeholder="e.g. 50 (optional)"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="thresholdIncrement">Increment After Threshold</Label>
                    <Input
                      id="thresholdIncrement"
                      type="number"
                      value={formData.thresholdIncrement}
                      onChange={(e) => setFormData({ ...formData, thresholdIncrement: e.target.value })}
                      min="1"
                      placeholder="e.g. 5 (optional)"
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
      </section>

      {!auctions ? (
        <div className="py-16 text-center text-muted-foreground">Loading auctions…</div>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              label="Total auctions"
              value={stats.total}
              sub="All sessions"
              icon={Layers}
              tone="default"
            />
            <StatTile
              label="Live now"
              value={stats.active}
              sub={stats.poolHint}
              highlight={stats.active > 0}
              icon={Radio}
              tone="live"
            />
            <StatTile
              label="Draft"
              value={stats.draft}
              sub="Setup in progress"
              icon={PenLine}
              tone="draft"
            />
            <StatTile
              label="Completed"
              value={stats.completed}
              sub="Archived results"
              icon={CheckCircle2}
              tone="complete"
            />
          </div>

          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {filterPills.map((pill) => {
                const active = listFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setListFilter(pill.id)}
                    className={cn(
                      "font-head-arena inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                      active
                        ? "border-primary/40 bg-primary/15 text-arena-cyan shadow-md shadow-primary/10"
                        : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-border hover:bg-secondary/50 hover:text-foreground"
                    )}
                  >
                    {pill.label}
                    <span
                      className={cn(
                        "tabular-nums",
                        active ? "text-foreground/90" : "text-muted-foreground/80"
                      )}
                    >
                      {pill.count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by auction name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 border-border/70 bg-black/20 pl-9 backdrop-blur-sm placeholder:text-muted-foreground/70"
                aria-label="Search auctions"
              />
            </div>
          </div>

          {auctions.length > 0 &&
          visibleAuctions.length === 0 &&
          (listFilter !== "all" || searchQuery.trim()) ? (
            <p className="mb-6 rounded-2xl border border-border/60 bg-secondary/20 px-4 py-6 text-center text-sm text-muted-foreground">
              No auctions match your filters.{" "}
              <button
                type="button"
                className="font-medium text-arena-cyan underline-offset-4 hover:underline"
                onClick={() => {
                  setListFilter("all");
                  setSearchQuery("");
                }}
              >
                Clear filters
              </button>
            </p>
          ) : null}

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
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visibleAuctions.map((auction) => {
                const isLive = auction.status === "active";
                const isDraft = auction.status === "draft";
                return (
                  <Card
                    key={auction._id}
                    className={cn(
                      ARENA_GLASS_CARD,
                      "group flex flex-col gap-0 overflow-hidden py-0 transition-[box-shadow,border-color] duration-300",
                      isLive &&
                        "border-primary/35 shadow-[0_0_40px_-12px_color-mix(in_oklab,var(--primary)_45%,transparent)]",
                      isDraft && "border-dashed border-border/80",
                      auction.status === "completed" && "opacity-[0.97]"
                    )}
                  >
                    <CardHeader
                      className={cn(
                        "relative gap-0 border-b border-border/50 bg-black/15 pb-4 pt-5",
                        isLive && "bg-gradient-to-r from-primary/10 via-transparent to-transparent"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 pr-10">
                        <div className="min-w-0">
                          <CardTitle className="font-head-arena text-lg font-bold leading-snug tracking-tight">
                            {auction.name}
                          </CardTitle>
                          <CardDescription className="mt-1.5 text-xs sm:text-sm">
                            {new Date(auction.date).toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </CardDescription>
                        </div>
                        {getStatusBadge(auction.status)}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete auction"
                        onClick={() => handleDelete(auction._id)}
                        className="absolute right-2 top-3 h-8 w-8 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-4 pb-5 pt-4">
                      <div className="grid grid-cols-2 gap-2.5 text-sm">
                        <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-black/20 px-3 py-2">
                          <Wallet className="h-4 w-4 shrink-0 text-arena-cyan/80" strokeWidth={1.75} />
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Budget</p>
                            <p className="font-semibold tabular-nums">{auction.budget} pts</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-black/20 px-3 py-2">
                          <Users className="h-4 w-4 shrink-0 text-arena-cyan/80" strokeWidth={1.75} />
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Roster cap</p>
                            <p className="font-semibold tabular-nums">{auction.maxPlayersPerTeam}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-black/20 px-3 py-2">
                          <Gavel className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Min bid</p>
                            <p className="font-semibold tabular-nums">{auction.minBid} pts</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-black/20 px-3 py-2">
                          <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Step</p>
                            <p className="font-semibold tabular-nums">+{auction.minIncrement}</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-auto flex flex-col gap-2 border-t border-border/50 pt-4">
                        {isLive ? (
                          <Link href={`/admin/auction/${auction._id}/live`} className="w-full">
                            <Button
                              size="sm"
                              className={cn(
                                "h-9 w-full gap-2 font-head-arena text-[11px] font-bold uppercase tracking-wider",
                                ARENA_BTN_CYAN
                              )}
                            >
                              <Play className="h-4 w-4" />
                              Live control
                            </Button>
                          </Link>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/admin/auction/${auction._id}`} className="min-w-0 flex-1 sm:flex-none">
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-9 w-full gap-1.5 font-head-arena text-[11px] font-semibold uppercase tracking-wider sm:w-auto",
                                ARENA_BTN_OUTLINE
                              )}
                            >
                              <Settings className="h-3.5 w-3.5" />
                              Manage
                            </Button>
                          </Link>
                          <Link href={`/auction/${auction._id}`} target="_blank" className="min-w-0 flex-1 sm:flex-none">
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-9 w-full gap-1.5 font-head-arena text-[11px] font-semibold uppercase tracking-wider sm:w-auto",
                                ARENA_BTN_OUTLINE
                              )}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Viewer
                            </Button>
                          </Link>
                        </div>
                        {isDraft ? (
                          <div className="flex flex-wrap gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] p-2">
                            <Link href={`/auction/${auction._id}/register`} target="_blank" rel="noopener noreferrer">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-8 gap-1.5 bg-secondary/80 text-[11px] font-semibold"
                              >
                                <UserPlus className="h-3.5 w-3.5" />
                                Open register
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5 text-[11px] font-medium text-arena-cyan hover:bg-primary/10 hover:text-arena-cyan"
                              disabled={copiedRegisterAuctionId === auction._id}
                              onClick={() => copyPlayerRegisterLink(auction._id)}
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              {copiedRegisterAuctionId === auction._id ? "Link copied" : "Copy register link"}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
