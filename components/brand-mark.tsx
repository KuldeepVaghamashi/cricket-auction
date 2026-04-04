import { Gavel } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared logo tile — matches landing, login, and viewer headers. */
export function BrandMark({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-arena-magenta/20 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
        className
      )}
      aria-hidden
    >
      <Gavel className={cn("text-primary", iconClassName)} />
    </span>
  );
}
