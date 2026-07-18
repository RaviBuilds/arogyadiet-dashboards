import type { LucideIcon } from "lucide-react";
import { CalendarDays, PauseCircle, Sparkles, Utensils } from "lucide-react";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";

type StatItem = {
  icon: LucideIcon;
  label: string;
  value: string;
};

/**
 * MealHistoryHeader — the section header for "My Nutrition Journal".
 *
 * Replaces the plain `<h2>Meal History</h2>` with the same emotional voice
 * as MealsHero above it: an icon chip, a warm one-line title + subtitle,
 * and a small row of summary stats.
 *
 * Every stat here is derived from fields the page already fetches for the
 * Journey header (`starts_on`/`effective_end_on`/`total_days` → day X of Y,
 * and `pause_credits_used`/`pause_credits_total`) — nothing invented, and
 * any stat whose inputs are missing is simply omitted rather than shown as
 * a fake zero.
 */
export function MealHistoryHeader({
  dayCurrent,
  dayTotal,
  pauseCreditsUsed,
  pauseCreditsTotal,
}: {
  dayCurrent?: number | null;
  dayTotal?: number | null;
  pauseCreditsUsed?: number | null;
  pauseCreditsTotal?: number | null;
}) {
  const showJourney =
    typeof dayCurrent === "number" &&
    typeof dayTotal === "number" &&
    dayTotal > 0;
  const progress = showJourney
    ? Math.max(0, Math.min(100, Math.round((dayCurrent! / dayTotal!) * 100)))
    : null;
  const showPauses =
    typeof pauseCreditsUsed === "number" &&
    typeof pauseCreditsTotal === "number" &&
    pauseCreditsTotal > 0;

  const stats: StatItem[] = [];
  if (showJourney) {
    stats.push({
      icon: CalendarDays,
      label: "Journey Day",
      value: `${dayCurrent} of ${dayTotal}`,
    });
  }
  if (progress !== null) {
    stats.push({ icon: Sparkles, label: "Completion", value: `${progress}%` });
  }
  if (showPauses) {
    stats.push({
      icon: PauseCircle,
      label: "Rest Days Used",
      value: `${pauseCreditsUsed} of ${pauseCreditsTotal}`,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <IconChip icon={Utensils} tone="coral" size="lg" />
        <div>
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight sm:text-xl">
            Meal History
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-slate-500">
            Every healthy meal builds a stronger tomorrow.
          </p>
        </div>
      </div>

      {stats.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 shadow-sm"
            >
              <stat.icon className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs font-medium text-slate-500">
                {stat.label}
              </span>
              <span className="text-xs font-semibold text-slate-900">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
