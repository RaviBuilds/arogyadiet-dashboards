import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MomentumStrip — proof of progress ("am I moving toward my goal?").
 *
 * Rendered as a single unified band (rather than separate KPI boxes) with a
 * warm caption, so it reads as an encouraging summary of the customer's
 * journey rather than a dashboard of metrics. Reusable for any customer type
 * by passing a different set of stats and caption.
 */
export type MomentumStat = {
  icon: LucideIcon;
  value: string | number;
  label: string;
  /** Visual tone for the icon chip. */
  tone?: "green" | "coral" | "amber" | "brown";
};

const TONES: Record<NonNullable<MomentumStat["tone"]>, string> = {
  green: "bg-emerald-100/80 text-emerald-700",
  coral: "bg-primary/10 text-primary",
  amber: "bg-amber-100/80 text-amber-700",
  brown: "bg-[#5d4037]/10 text-[#5d4037]",
};

export function MomentumStrip({
  stats,
  caption,
}: {
  stats: MomentumStat[];
  caption?: string;
}) {
  return (
    // Arrives one beat after the Today card, continuing the same opening
    // cascade rather than fading in at the same instant as everything else.
    <div className="overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50/80 via-white to-white shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300 fill-mode-both">
      {/* Encouragement leads; the numbers below quietly back it up. */}
      {caption ? (
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <p className="text-sm font-medium leading-snug text-emerald-800">
            {caption}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-3 divide-x divide-emerald-900/10 border-t border-emerald-900/10">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div
              key={idx}
              className="flex flex-col items-center gap-1.5 px-2 py-4 text-center"
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  TONES[stat.tone ?? "green"],
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-lg font-semibold leading-none text-slate-900">
                {stat.value}
              </p>
              <p className="text-[11px] font-medium leading-tight text-slate-500">
                {stat.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
