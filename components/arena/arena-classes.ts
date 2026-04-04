/**
 * Shared glass panel styles for admin dashboard.
 * Blur is scoped to individual cards only (not full viewport) for performance.
 * Colors come from app/globals.css (--arena-*, --primary, etc.).
 */
export const ARENA_GLASS_CARD =
  "border border-[var(--arena-border)] bg-[var(--arena-glass)] backdrop-blur-md shadow-none rounded-2xl";

export const ARENA_CARD_HEADER = "border-b border-border/50 bg-black/25";

export const ARENA_GRADIENT_TEXT =
  "bg-gradient-to-r from-primary to-arena-magenta bg-clip-text text-transparent";

/** Primary CTA — cyan gradient aligned with global --primary */
export const ARENA_BTN_CYAN =
  "font-head-arena bg-gradient-to-br from-primary to-primary-end text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-95";

/** Magenta accent CTA — live / secondary emphasis */
export const ARENA_BTN_MAGENTA =
  "font-head-arena bg-gradient-to-br from-arena-magenta to-arena-magenta-end text-white shadow-lg shadow-arena-magenta/20 hover:opacity-95";

/** Subtle outline control on arena panels */
export const ARENA_BTN_OUTLINE =
  "border-border/80 bg-secondary/35 hover:bg-secondary/55";

/** Manage auction hero — inner highlight + soft outer depth */
export const ARENA_MANAGE_HERO =
  "rounded-3xl border border-white/[0.08] bg-gradient-to-br from-primary/[0.09] via-[var(--arena-glass)] to-arena-magenta/[0.07] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.75),inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-white/[0.04]";

/** Unified workspace around tabs + tables */
export const ARENA_WORKSPACE_SHELL =
  "rounded-[1.35rem] border border-white/[0.07] bg-[color-mix(in_oklab,var(--arena-glass)_85%,transparent)] p-2 shadow-[0_28px_90px_-32px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:p-3";

/** Table / list frame */
export const ARENA_TABLE_FRAME =
  "overflow-hidden rounded-xl border border-white/[0.06] bg-black/[0.22] shadow-inner";

/** Modal polish */
export const ARENA_DIALOG_SURFACE =
  "border-white/10 bg-[color-mix(in_oklab,var(--card)_92%,transparent)] shadow-2xl shadow-black/50 backdrop-blur-xl";
