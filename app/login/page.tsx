"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { loginAction, type LoginFormState } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, null as LoginFormState);

  return (
    <div className="app-public-shell">
      <header className="app-glass-header">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight transition-opacity hover:opacity-85"
          >
            <BrandMark className="h-9 w-9" iconClassName="h-5 w-5" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 pb-16">
        <Card className="app-surface-card w-full max-w-md border-0 py-0 shadow-2xl">
          <CardHeader className="space-y-4 pt-8 text-center">
            <div className="mx-auto flex justify-center">
              <BrandMark className="h-14 w-14" iconClassName="h-8 w-8" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold tracking-tight">Admin sign in</CardTitle>
              <CardDescription className="mt-2 text-base">
                Cricket Auction — secure access to your dashboard
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pb-8 pt-2">
            <form action={formAction} className="flex flex-col gap-5">
              {state?.error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {state.error}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="Enter username"
                  required
                  autoComplete="username"
                  disabled={pending}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Enter password"
                  required
                  autoComplete="current-password"
                  disabled={pending}
                />
              </div>

              <Button
                type="submit"
                className="mt-1 w-full shadow-lg shadow-primary/15"
                size="lg"
                disabled={pending}
              >
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
