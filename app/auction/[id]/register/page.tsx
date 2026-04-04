"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/brand-mark";
import type { AuctionWithId } from "@/lib/types";
import { CheckCircle2, Loader2 } from "lucide-react";

const jsonFetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : "Request failed";
    throw new Error(msg);
  }
  return data as T;
};

export default function PlayerSelfRegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: auction, error: auctionErr, isLoading } = useSWR<AuctionWithId>(
    `/api/auctions/${id}`,
    jsonFetcher
  );

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isDraft = auction?.status === "draft";

  useEffect(() => {
    setFormError(null);
  }, [name, phone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auctions/${id}/player-self-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(typeof data.error === "string" ? data.error : "Registration failed");
        return;
      }
      setSuccess(true);
      setName("");
      setPhone("");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-public-shell">
      <header className="app-glass-header">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
            <BrandMark className="h-9 w-9" iconClassName="h-5 w-5" />
            Cricket Auction
          </Link>
          {auction ? (
            <Link
              href={`/auction/${id}`}
              className="text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              Auction page
            </Link>
          ) : null}
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 pb-16">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : auctionErr || !auction ? (
          <Card className="app-surface-card max-w-md border-0">
            <CardHeader>
              <CardTitle>Auction not found</CardTitle>
              <CardDescription>Check the link you were given or contact the organizer.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/">Home</Link>
              </Button>
            </CardContent>
          </Card>
        ) : !isDraft ? (
          <Card className="app-surface-card max-w-md border-0">
            <CardHeader>
              <CardTitle>{auction.name}</CardTitle>
              <CardDescription>
                Registration is only open before the auction starts. This auction is no longer in setup
                phase.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={`/auction/${id}`}>Open auction page</Link>
              </Button>
            </CardContent>
          </Card>
        ) : success ? (
          <Card className="app-surface-card max-w-md border-0 text-center">
            <CardHeader>
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-sold/15">
                <CheckCircle2 className="h-8 w-8 text-sold" />
              </div>
              <CardTitle>You&apos;re in!</CardTitle>
              <CardDescription>
                You&apos;re on the player list for <span className="font-medium text-foreground">{auction.name}</span>.
                The organizer will run the auction from here — watch for updates.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button variant="outline" onClick={() => setSuccess(false)}>
                Register someone else
              </Button>
              <Button asChild>
                <Link href={`/auction/${id}`}>View auction</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="app-surface-card w-full max-w-md border-0">
            <CardHeader>
              <CardTitle className="text-xl tracking-tight">Player registration</CardTitle>
              <CardDescription className="text-base">
                Join <span className="font-semibold text-foreground">{auction.name}</span>. Enter your details
                below — you&apos;ll be added to the auction pool.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                {formError ? (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {formError}
                  </p>
                ) : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="reg-name">Full name</Label>
                  <Input
                    id="reg-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name as it should appear in the auction"
                    required
                    autoComplete="name"
                    maxLength={80}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="reg-phone">Phone number</Label>
                  <Input
                    id="reg-phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    required
                    autoComplete="tel"
                  />
                  <p className="text-xs text-muted-foreground">
                    Used only so the organizer can contact you if needed. Same number can&apos;t register twice.
                  </p>
                </div>
                <Button type="submit" size="lg" className="w-full shadow-lg shadow-primary/15" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Registering…
                    </>
                  ) : (
                    "Register for this auction"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
