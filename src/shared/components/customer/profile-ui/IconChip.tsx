import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * IconChip — small circular colored icon container.
 *
 * Dashboard convention: icons are never bare, always sit inside a tone-tinted
 * circle (see MomentumStrip stat icons, empty-state icons). Reused across
 * every customer page section header (Personal Details, Medical Assessment,
 * Security, Delivery Addresses) so icons read consistently app-wide.
 */
export type IconChipTone = "green" | "coral" | "amber" | "slate";

const TONES: Record<IconChipTone, string> = {
  green: "bg-emerald-50 text-emerald-600",
  coral: "bg-primary/10 text-primary",
  amber: "bg-amber-100/80 text-amber-700",
  slate: "bg-slate-100 text-slate-500",
};

const SIZES = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-11 w-11",
} as const;

export function IconChip({
  icon: Icon,
  tone = "green",
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone?: IconChipTone;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        SIZES[size],
        TONES[tone],
        className,
      )}
    >
      <Icon className={cn(size === "lg" ? "h-5 w-5" : "h-4 w-4")} />
    </div>
  );
}
