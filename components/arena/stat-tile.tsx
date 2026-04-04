"use client";

import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ARENA_GLASS_CARD } from "./arena-classes";

export type StatTileProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  highlight?: boolean;
};

function StatTileInner({ label, value, sub, className, highlight }: StatTileProps) {
  return (
    <div
      className={cn(
        ARENA_GLASS_CARD,
        "p-6 transition-[transform,border-color] duration-200 will-change-transform",
        "hover:border-primary/20 hover:-translate-y-0.5",
        highlight && "border-primary/25 shadow-lg shadow-primary/10",
        className
      )}
    >
      <p className="font-head-arena text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 font-head-arena text-3xl font-extrabold tracking-tight sm:text-4xl">
        {value}
      </div>
      {sub ? <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export const StatTile = memo(StatTileInner);
