"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Gavel, LogOut, Menu, X, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        router.push("/login");
        return;
      }
      setLoading(false);
    } catch {
      router.push("/login");
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="arena-page min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground font-head-arena text-sm tracking-wide">
          Loading…
        </div>
      </div>
    );
  }

  const navItems = [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }];

  const liveMatch = pathname.match(/^\/admin\/auction\/([^/]+)\/live$/);
  const manageMatch = pathname.match(/^\/admin\/auction\/([^/]+)$/);
  const auctionIdFromPath = liveMatch?.[1] ?? manageMatch?.[1];

  return (
    <div className="arena-page min-h-screen flex flex-col text-foreground">
      <header className="arena-top-edge sticky top-0 z-[200] h-16 shrink-0 border-b border-border bg-[var(--arena-header-tint)] backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[1480px] items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-muted-foreground hover:text-primary"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Link href="/admin" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-arena-magenta text-base leading-none">
                🏏
              </span>
              <span className="font-head-arena text-lg font-extrabold italic tracking-tight text-foreground">
                Auction<span className="text-arena-cyan not-italic">Arena</span>
              </span>
            </Link>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <span
                    className={cn(
                      "font-head-arena flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                      isActive
                        ? "border-primary/25 bg-primary/10 text-arena-cyan"
                        : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                </Link>
              );
            })}
            {auctionIdFromPath ? (
              <>
                <Link href={`/admin/auction/${auctionIdFromPath}`}>
                  <span
                    className={cn(
                      "font-head-arena flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                      pathname === `/admin/auction/${auctionIdFromPath}` && !pathname.endsWith("/live")
                        ? "border-primary/25 bg-primary/10 text-arena-cyan"
                        : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <Gavel className="h-4 w-4" />
                    Manage
                  </span>
                </Link>
                <Link href={`/admin/auction/${auctionIdFromPath}/live`}>
                  <span
                    className={cn(
                      "font-head-arena flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                      pathname.endsWith("/live")
                        ? "border-arena-magenta/30 bg-arena-magenta/10 text-arena-magenta"
                        : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <Radio className="h-4 w-4" />
                    Live
                  </span>
                </Link>
              </>
            ) : null}
          </nav>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="gap-2 text-muted-foreground hover:text-primary"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden font-head-arena text-xs font-semibold uppercase tracking-wider sm:inline">
              Logout
            </span>
          </Button>
        </div>

        {mobileMenuOpen && (
          <nav className="border-t border-border bg-[var(--arena-header-tint)] p-4 md:hidden">
            <div className="flex flex-col gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>
                    <Button
                      variant={isActive ? "secondary" : "ghost"}
                      className="w-full justify-start gap-2 font-head-arena"
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
              {auctionIdFromPath ? (
                <>
                  <Link href={`/admin/auction/${auctionIdFromPath}`} onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" className="w-full justify-start gap-2 font-head-arena">
                      <Gavel className="h-4 w-4" />
                      Manage auction
                    </Button>
                  </Link>
                  <Link href={`/admin/auction/${auctionIdFromPath}/live`} onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" className="w-full justify-start gap-2 font-head-arena">
                      <Radio className="h-4 w-4" />
                      Live control
                    </Button>
                  </Link>
                </>
              ) : null}
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1 pb-20 md:pb-0">{children}</main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-[200] border-t border-border bg-card/92 backdrop-blur-xl md:hidden"
        aria-label="Mobile navigation"
      >
        <div className="flex justify-around px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <Link
            href="/admin"
            className={cn(
              "flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-1.5 font-head-arena text-[9px] font-bold uppercase tracking-wider",
              pathname === "/admin"
                ? "bg-primary/10 text-arena-cyan"
                : "text-muted-foreground"
            )}
          >
            <LayoutDashboard className="h-5 w-5" />
            Home
          </Link>
          {auctionIdFromPath ? (
            <>
              <Link
                href={`/admin/auction/${auctionIdFromPath}`}
                className={cn(
                  "flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-1.5 font-head-arena text-[9px] font-bold uppercase tracking-wider",
                  pathname === `/admin/auction/${auctionIdFromPath}`
                    ? "bg-primary/10 text-arena-cyan"
                    : "text-muted-foreground"
                )}
              >
                <Gavel className="h-5 w-5" />
                Manage
              </Link>
              <Link
                href={`/admin/auction/${auctionIdFromPath}/live`}
                className={cn(
                  "flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-1.5 font-head-arena text-[9px] font-bold uppercase tracking-wider",
                  pathname.endsWith("/live")
                    ? "bg-arena-magenta/12 text-arena-magenta"
                    : "text-muted-foreground"
                )}
              >
                <Radio className="h-5 w-5" />
                Live
              </Link>
            </>
          ) : (
            <span className="flex min-w-[4.5rem] flex-col items-center gap-1 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">
              <Gavel className="h-5 w-5 opacity-40" />
              Auction
            </span>
          )}
        </div>
      </nav>
    </div>
  );
}
