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
