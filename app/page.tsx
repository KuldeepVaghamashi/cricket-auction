import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Gavel, Users, DollarSign, Zap, Shield, Eye } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <div className="app-public-shell">
      <header className="app-glass-header sticky top-0 z-50">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-90">
            <BrandMark className="h-10 w-10" iconClassName="h-6 w-6" />
            <span className="text-lg font-bold tracking-tight">Cricket Auction</span>
          </Link>
          <Link href="/login">
            <Button className="shadow-lg shadow-primary/15">Admin Login</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative py-20 lg:py-32">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-20 top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
            <div className="absolute -right-16 bottom-0 h-64 w-64 rounded-full bg-arena-magenta/10 blur-3xl" />
          </div>
          <div className="container relative mx-auto px-4 text-center">
            <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-arena-magenta/15 shadow-lg ring-1 ring-primary/20">
              <Gavel className="h-12 w-12 text-primary" />
            </div>
            <h1 className="mb-6 text-balance text-4xl font-bold tracking-tight lg:text-6xl">
              Cricket Auction
              <br />
              <span className="bg-gradient-to-r from-primary via-arena-cyan to-arena-magenta bg-clip-text text-transparent">
                Made Simple
              </span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-pretty text-lg text-muted-foreground lg:text-xl">
              Run professional cricket auctions with real-time bidding, team management,
              and live viewer updates. Perfect for IPL-style fantasy leagues.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/login">
                <Button size="lg" className="gap-2 shadow-xl shadow-primary/20">
                  <Shield className="h-5 w-5" />
                  Admin Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="border-y border-border/60 bg-card/40 py-20 backdrop-blur-sm">
          <div className="container mx-auto px-4">
            <h2 className="mb-4 text-center text-3xl font-bold tracking-tight lg:text-4xl">
              Everything You Need
            </h2>
            <p className="mx-auto mb-14 max-w-xl text-center text-muted-foreground">
              One platform from setup to sold — tuned for fast live sessions.
            </p>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Users,
                  title: "Team Management",
                  desc: "Create teams with custom budgets and track remaining funds and player slots in real-time.",
                },
                {
                  icon: DollarSign,
                  title: "Smart Bidding",
                  desc: "Dynamic max bid calculation ensures teams can always fill their remaining slots at minimum price.",
                },
                {
                  icon: Zap,
                  title: "Random Player Pick",
                  desc: "Randomly select players from the pool for a fair and exciting auction experience.",
                },
                {
                  icon: Eye,
                  title: "Live Viewer Page",
                  desc: "Share a public link for participants to watch the auction in real-time with live updates.",
                },
                {
                  icon: Gavel,
                  title: "Auction Control",
                  desc: "Full control panel for auctioneers with bid management, sold/unsold actions, and reset options.",
                },
                {
                  icon: Shield,
                  title: "Bid Validation",
                  desc: "Automatic validation prevents invalid bids and ensures fair play throughout the auction.",
                },
              ].map(({ icon: Icon, title, desc }) => (
                <Card
                  key={title}
                  className={cn(
                    "group border-border/70 bg-card/80 py-0 transition-all duration-300",
                    "hover:-translate-y-1 hover:border-primary/35 hover:shadow-lg hover:shadow-primary/10"
                  )}
                >
                  <CardHeader className="pb-4 pt-6">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/15">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{title}</CardTitle>
                    <CardDescription className="text-[15px] leading-relaxed">{desc}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4">
            <h2 className="mb-14 text-center text-3xl font-bold tracking-tight lg:text-4xl">
              How It Works
            </h2>
            <div className="mx-auto grid max-w-4xl gap-10 md:grid-cols-3 md:gap-8">
              {[
                {
                  step: "1",
                  title: "Create Auction",
                  desc: "Set up your auction with budget limits, bid increments, and max players per team.",
                },
                {
                  step: "2",
                  title: "Add Teams & Players",
                  desc: "Add participating teams and build your player pool with base prices.",
                },
                {
                  step: "3",
                  title: "Start Auctioning",
                  desc: "Pick players randomly, manage bids, and let teams compete for the best players.",
                },
              ].map(({ step, title, desc }) => (
                <div key={step} className="relative text-center">
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-end text-lg font-bold text-primary-foreground shadow-lg shadow-primary/25">
                    {step}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold tracking-tight">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border/60 bg-gradient-to-b from-primary/8 via-transparent to-arena-magenta/5 py-20">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight">Ready to Start?</h2>
            <p className="mx-auto mb-10 max-w-xl text-muted-foreground">
              Log in to the admin dashboard to create your first auction and start building your dream teams.
            </p>
            <Link href="/login">
              <Button size="lg" className="shadow-xl shadow-primary/20">
                Get Started
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 bg-card/60 py-10 backdrop-blur-md">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Cricket Auction App — Built for fantasy league organizers</p>
          <p className="mt-2">Designed and developed by Kuldeep Ahir</p>
        </div>
      </footer>
    </div>
  );
}
