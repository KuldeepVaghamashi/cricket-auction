"use client";

import { useState } from "react";
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
import { Plus, Trash2, Play, Eye, Settings } from "lucide-react";
import Link from "next/link";
import type { AuctionWithId } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function AdminDashboard() {
  const { data: auctions, mutate } = useSWR<AuctionWithId[]>("/api/auctions", fetcher);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    date: "",
    budget: "100",
    minIncrement: "2",
    minBid: "2",
    maxPlayersPerTeam: "11",
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
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

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this auction?")) return;

    await fetch(`/api/auctions/${id}`, { method: "DELETE" });
    mutate();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-primary text-primary-foreground">Active</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      default:
        return <Badge variant="outline">Draft</Badge>;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Auctions</h1>
          <p className="text-muted-foreground">Manage your cricket auctions</p>
        </div>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Create Auction
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Auction</DialogTitle>
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
                <Label htmlFor="date">Date & Time</Label>
                <Input
                  id="date"
                  type="datetime-local"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
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

              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create Auction"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {!auctions ? (
        <div className="text-center py-12 text-muted-foreground">Loading auctions...</div>
      ) : auctions.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <p className="text-muted-foreground mb-4">No auctions yet. Create your first auction to get started.</p>
            <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create Auction
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {auctions.map((auction) => (
            <Card key={auction._id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{auction.name}</CardTitle>
                    <CardDescription>
                      {new Date(auction.date).toLocaleDateString("en-US", {
                        dateStyle: "medium",
                      })}
                    </CardDescription>
                  </div>
                  {getStatusBadge(auction.status)}
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="grid grid-cols-2 gap-2 text-sm mb-4">
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

                <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t">
                  <Link href={`/admin/auction/${auction._id}`}>
                    <Button variant="outline" size="sm" className="gap-1">
                      <Settings className="h-3.5 w-3.5" />
                      Manage
                    </Button>
                  </Link>
                  {auction.status === "active" && (
                    <Link href={`/admin/auction/${auction._id}/live`}>
                      <Button size="sm" className="gap-1">
                        <Play className="h-3.5 w-3.5" />
                        Control
                      </Button>
                    </Link>
                  )}
                  <Link href={`/auction/${auction._id}`} target="_blank">
                    <Button variant="outline" size="sm" className="gap-1">
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(auction._id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
