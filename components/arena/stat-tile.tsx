"use client";

import { memo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ARENA_GLASS_CARD } from "./arena-classes";

export type StatTileProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  highlight?: boolean;
  icon?: LucideIcon;
  /** Accent strip + icon tint for quick scanning */
  tone?: "default" | "live" | "draft" | "complete";
};

function StatTileInner({ label, value, sub, className, highlight, icon: Icon, tone = "default" }: StatTileProps) {
  return (
    <div
      className={cn(
        ARENA_GLASS_CARD,
        "relative overflow-hidden p-5 transition-[transform,box-shadow,border-color] duration-300 sm:p-6",
        "hover:border-primary/25 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5",
        highlight && "border-primary/30 shadow-lg shadow-primary/15",
        tone === "live" && "border-l-[3px] border-l-primary pl-[calc(1.25rem-3px)] sm:pl-[calc(1.5rem-3px)]",
        tone === "draft" && "border-l-[3px] border-l-muted-foreground/35 pl-[calc(1.25rem-3px)] sm:pl-[calc(1.5rem-3px)]",
        tone === "complete" &&
          "border-l-[3px] border-l-emerald-500/55 pl-[calc(1.25rem-3px)] sm:pl-[calc(1.5rem-3px)]",
        className
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl opacity-40",
          tone === "live" && "bg-primary/30",
          tone === "draft" && "bg-muted-foreground/20",
          tone === "complete" && "bg-emerald-500/25",
          tone === "default" && "bg-primary/15"
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-head-arena text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {label}
          </p>
          <div className="mt-2 font-head-arena text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">
            {value}
          </div>
          {sub ? <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{sub}</p> : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-black/20",
              tone === "live" && "border-primary/25 text-arena-cyan",
              tone === "draft" && "text-muted-foreground",
              tone === "complete" && "border-emerald-500/30 text-emerald-400/90",
              tone === "default" && "text-arena-cyan/80"
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

export const StatTile = memo(StatTileInner);
