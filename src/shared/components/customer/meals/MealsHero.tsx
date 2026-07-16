import { Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { StatusPill } from "@/shared/components/customer/profile-ui/StatusPill";

/**
 * MealsHero — the page's own emotional anchor, distinct from the Dashboard's
 * JourneyHeader (no progress ring, no leaf-vein illustration) so this reads
 * as a sibling page rather than a duplicate. Built entirely from the shared
 * IconChip/StatusPill primitives so it stays visually consistent with every
 * other customer page.
 *
 * Framing is "today's nutrition", not "your account" — the eyebrow, heading
 * and one-line subtext all speak to the daily meal moment. The day counter
 * is a completion indicator (real subscription math), not a fabricated
 * metric.
 */
export function MealsHero({
  dayCurrent,
  dayTotal,
  mealsCompleted,
}: {
  dayCurrent?: number | null;
  dayTotal?: number | null;
  mealsCompleted?: number | null;
}) {
  const showDayCounter =
    typeof dayCurrent === "number" && typeof dayTotal === "number" && dayTotal > 0;

  return (
    <section
      className={cn(
        "reveal-rise relative overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50/80 via-white to-white p-6 shadow-sm sm:p-8",
      )}
      style={{ ["--reveal-delay" as string]: "150ms" }}
    >
      <div className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full bg-emerald-100/60 blur-3xl" />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <IconChip icon={Utensils} tone="green" size="lg" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Your Daily Nutrition
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Today&apos;s Nutrition Journey
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            Every healthy meal brings you one step closer to your transformation.
          </p>
        </div>

        {showDayCounter ? (
          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-2">
            <StatusPill tone="green">
              Day {dayCurrent} of {dayTotal}
            </StatusPill>
            {typeof mealsCompleted === "number" ? (
              <StatusPill tone="coral">
                {mealsCompleted} {mealsCompleted === 1 ? "meal" : "meals"} completed
              </StatusPill>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
