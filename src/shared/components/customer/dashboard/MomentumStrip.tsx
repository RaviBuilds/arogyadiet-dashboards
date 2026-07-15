import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MomentumStrip — proof of progress ("am I moving toward my goal?").
 *
 * Presented as a single warm companion card with softly divided segments
 * rather than separate KPI boxes, so the dashboard feels encouraging instead
 * of analytical. Reusable for any customer type by passing a different set of
 * stats and heading.
 */
export type MomentumStat = {
  icon: LucideIcon;
  value: string | number;
  label: string;
  /** Visual tone for the icon chip. */
  tone?: "green" | "coral" | "amber" | "brown";
};

const TONES: Record<NonNullable<MomentumStat["tone"]>, string> = {
  green: "bg-emerald-100 text-emerald-600",
  coral: "bg-primary/10 text-primary",
  amber: "bg-amber-100 text-amber-600",
  brown: "bg-[#5d4037]/10 text-[#5d4037]",
};

export function MomentumStrip({
  stats,
  heading = "Your progress so far",
  caption,
}: {
  stats: MomentumStat[];
  heading?: string;
  /** Optional warm, human sentence shown beneath the stats. */
  caption?: string;
}) {
  return (
    <div className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50/70 via-white to-white p-5 shadow-sm sm:p-6">
      <p className="text-sm font-semibold text-slate-700">{heading}</p>

      <div className="mt-4 grid grid-cols-3 divide-x divide-slate-200/70">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div
              key={idx}
              className="flex flex-col items-center gap-2 px-2 text-center"
            >
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full",
                  TONES[stat.tone ?? "green"],
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-2xl font-semibold leading-none text-slate-900">
                {stat.value}
              </p>
              <p className="text-[11px] font-medium leading-tight text-slate-500 sm:text-xs">
                {stat.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
