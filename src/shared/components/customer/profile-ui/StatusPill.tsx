import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * StatusPill — the repeated pill/chip pattern from the dashboard
 * (rounded-full border + tinted bg/text), formalized with a tone map so it
 * can be reused for "Primary" address badges, PIN security status, and the
 * medical-history confirmation success state.
 */
export type StatusPillTone =
  | "green"
  | "coral"
  | "amber"
  | "slate"
  | "blue"
  | "purple"
  | "red"
  | "orange";

const TONES: Record<StatusPillTone, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  coral: "border-primary/20 bg-primary/10 text-primary",
  amber: "border-amber-200 bg-amber-100/80 text-amber-700",
  slate: "border-slate-200 bg-slate-100 text-slate-600",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  purple: "border-purple-200 bg-purple-50 text-purple-700",
  red: "border-red-200 bg-red-50 text-red-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
};

export function StatusPill({
  icon: Icon,
  tone = "green",
  children,
  className,
}: {
  icon?: LucideIcon;
  tone?: StatusPillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </span>
  );
}
