import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Gavel, Users, DollarSign, Zap, Shield, Eye } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gavel className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">Cricket Auction</span>
          </div>
          <Link href="/login">
            <Button>Admin Login</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="py-20 lg:py-32">
          <div className="container mx-auto px-4 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-6">
              <Gavel className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-4xl lg:text-6xl font-bold mb-6 text-balance">
              Cricket Auction
              <br />
              <span className="text-primary">Made Simple</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8 text-pretty">
              Run professional cricket auctions with real-time bidding, team management,
              and live viewer updates. Perfect for IPL-style fantasy leagues.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/login">
                <Button size="lg" className="gap-2">
                  <Shield className="h-5 w-5" />
                  Admin Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 bg-card">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-center mb-12">
              Everything You Need
            </h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <Users className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Team Management</CardTitle>
                  <CardDescription>
                    Create teams with custom budgets and track remaining funds and player slots in real-time.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <DollarSign className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Smart Bidding</CardTitle>
                  <CardDescription>
                    Dynamic max bid calculation ensures teams can always fill their remaining slots at minimum price.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Zap className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Random Player Pick</CardTitle>
                  <CardDescription>
                    Randomly select players from the pool for a fair and exciting auction experience.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Eye className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Live Viewer Page</CardTitle>
                  <CardDescription>
                    Share a public link for participants to watch the auction in real-time with live updates.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Gavel className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Auction Control</CardTitle>
                  <CardDescription>
                    Full control panel for auctioneers with bid management, sold/unsold actions, and reset options.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Shield className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Bid Validation</CardTitle>
                  <CardDescription>
                    Automatic validation prevents invalid bids and ensures fair play throughout the auction.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-center mb-12">
              How It Works
            </h2>
            <div className="grid gap-8 md:grid-cols-3 max-w-4xl mx-auto">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground font-bold text-xl mb-4">
                  1
                </div>
                <h3 className="font-semibold mb-2">Create Auction</h3>
                <p className="text-muted-foreground text-sm">
                  Set up your auction with budget limits, bid increments, and max players per team.
                </p>
              </div>
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground font-bold text-xl mb-4">
                  2
                </div>
                <h3 className="font-semibold mb-2">Add Teams & Players</h3>
                <p className="text-muted-foreground text-sm">
                  Add participating teams and build your player pool with base prices.
                </p>
              </div>
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground font-bold text-xl mb-4">
                  3
                </div>
                <h3 className="font-semibold mb-2">Start Auctioning</h3>
                <p className="text-muted-foreground text-sm">
                  Pick players randomly, manage bids, and let teams compete for the best players.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-primary/5">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to Start?</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Log in to the admin dashboard to create your first auction and start
              building your dream teams.
            </p>
            <Link href="/login">
              <Button size="lg">Get Started</Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 bg-card">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Cricket Auction App - Built for fantasy league organizers</p>
          <p className="mt-2">Designed and developed by Kuldeep Ahir</p>
        </div>
      </footer>
    </div>
  );
}
