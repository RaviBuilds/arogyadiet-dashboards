import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { format, isToday, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import {
  StatusPill,
  type StatusPillTone,
} from "@/shared/components/customer/profile-ui/StatusPill";
import { JourneyIllustration } from "@/shared/components/customer/meals/journey-illustrations";
import {
  getHistoryStatusVisual,
  getMealIcon,
} from "@/shared/components/customer/meals/meal-history-status";

export type AddonProductLine = { name: string; quantity: number };

/**
 * Status → treatment. Mirrors the brief's per-state mapping instead of
 * showing every status as the same plain text:
 *  - "moving" states (something is actively happening right now) get a
 *    quiet label with a gently animated icon badge — felt, not shouted.
 *  - "Assigned" gets the same quiet treatment but stays still (a delivery
 *    partner has been picked, nothing is in motion yet).
 *  - every settled/resting state (Delivered, Failed, Paused, Upcoming,
 *    Reviewing) gets a calm, static, filled badge — the journal's version
 *    of "this entry is closed."
 */
const MOVING_LABELS = new Set(["Preparing", "Out for delivery", "Reaching"]);
const QUIET_STATIC_LABELS = new Set(["Assigned"]);

type StatusTreatment = "moving" | "quiet" | "filled";

function getStatusTreatment(label: string): StatusTreatment {
  if (MOVING_LABELS.has(label)) return "moving";
  if (QUIET_STATIC_LABELS.has(label)) return "quiet";
  return "filled";
}

/** Text-tone → quiet label classes, used for the "moving"/"quiet"
 *  treatments only (filled states render via the shared StatusPill). */
const QUIET_TONE_TEXT: Record<StatusPillTone, string> = {
  green: "text-emerald-700",
  coral: "text-primary",
  amber: "text-amber-700",
  slate: "text-slate-500",
  blue: "text-blue-700",
  purple: "text-purple-700",
  red: "text-red-600",
  orange: "text-orange-700",
};
const QUIET_TONE_BADGE: Record<StatusPillTone, string> = {
  green: "bg-emerald-50 text-emerald-600",
  coral: "bg-primary/10 text-primary",
  amber: "bg-amber-50 text-amber-600",
  slate: "bg-slate-100 text-slate-400",
  blue: "bg-blue-50 text-blue-600",
  purple: "bg-purple-50 text-purple-600",
  red: "bg-red-50 text-red-500",
  orange: "bg-orange-50 text-orange-600",
};

/** The Meal History status cell — renders the right treatment for the
 *  status label being shown (see `getStatusTreatment` above). */
function StatusDisplay({
  tone,
  icon: Icon,
  label,
}: {
  tone: StatusPillTone;
  icon: LucideIcon;
  label: string;
}) {
  const treatment = getStatusTreatment(label);

  if (treatment === "filled") {
    return (
      <StatusPill tone={tone} icon={Icon}>
        {label}
      </StatusPill>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium",
        QUIET_TONE_TEXT[tone],
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          QUIET_TONE_BADGE[tone],
        )}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            treatment === "moving" && "history-status-nudge",
          )}
        />
      </span>
      {label}
    </span>
  );
}

/** Calendar-style date badge — "JUN / 26" stacked, rounded, elegant. Given
 *  its own solid white face + visible border + soft shadow (rather than a
 *  pale slate fill) so it always reads as a distinct keepsake object next
 *  to the row text, never blends into the card background. Today's entry
 *  gets a solid primary fill instead of just a ring — the one unmistakably
 *  "different" badge in the whole list, anchoring the journal to the same
 *  "Day X of Y" language the hero above establishes. */
function DateBadge({ date, today }: { date: Date; today: boolean }) {
  return (
    <div
      className={cn(
        "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl leading-none shadow-sm",
        today
          ? "bg-primary text-white shadow-primary/25"
          : "border border-slate-200 bg-white",
      )}
    >
      <span
        className={cn(
          "text-[0.6rem] font-bold uppercase tracking-wide",
          today ? "text-white/85" : "text-primary",
        )}
      >
        {format(date, "MMM")}
      </span>
      <span
        className={cn(
          "text-base font-bold",
          today ? "text-white" : "text-slate-800",
        )}
      >
        {format(date, "d")}
      </span>
    </div>
  );
}

/** Circular "Day N" badge — consistent with the journey's numbered-day
 *  language used elsewhere on the page (MealsHero's Day X of Y). Its tone
 *  follows the row's own status, so scrolling down the journal reads as
 *  visible progress (emerald for delivered days, muted slate for rest/
 *  upcoming days) instead of a flat gray counter. */
const DAY_BADGE_TONES: Record<StatusPillTone, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  coral: "border-primary/20 bg-primary/10 text-primary",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  slate: "border-slate-200 bg-slate-100 text-slate-400",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  purple: "border-purple-200 bg-purple-50 text-purple-700",
  red: "border-red-200 bg-red-50 text-red-600",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
};

function DayBadge({ day, tone }: { day: number; tone: StatusPillTone }) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-full border leading-none",
        DAY_BADGE_TONES[tone],
      )}
    >
      <span className="text-[0.55rem] font-medium uppercase tracking-wide opacity-70">
        Day
      </span>
      <span className="text-xs font-bold">{day}</span>
    </div>
  );
}

/** Row accent — a thin left-edge bar colored by the row's status, visible
 *  at rest (not just on hover). This is what makes hierarchy readable in a
 *  single static glance down the page: settled/delivered days sit calm and
 *  green, active days pop in blue/orange/amber, paused days fade to slate —
 *  without needing to hover each row to discover that. */
const ACCENT_BAR_TONES: Record<StatusPillTone, string> = {
  green: "bg-emerald-400",
  coral: "bg-primary",
  amber: "bg-amber-400",
  slate: "bg-slate-300",
  blue: "bg-blue-400",
  purple: "bg-purple-400",
  red: "bg-red-400",
  orange: "bg-orange-400",
};

export type HistoryRow = {
  date: string;
  is_paused: boolean;
  meal_name: string | null;
  status: string;
  addons: AddonProductLine[];
};

/**
 * SubscriptionTimeline — "My Nutrition Journal".
 *
 * Same historyData/pagination contract as the original inline table in
 * page.tsx (identical Prev/Next Link markup + query param), rendered as a
 * premium journal instead of a CRM-style table: a calendar date badge, a
 * meal icon (muted on repeat rows so ten identical days don't shout), a
 * small animated status badge, and a circular day marker — with hover
 * elevation on desktop rows and full card-per-day on mobile.
 */
export function SubscriptionTimeline({
  historyData,
  currentPage,
  pageSize,
  totalPages,
}: {
  historyData: HistoryRow[];
  currentPage: number;
  pageSize: number;
  totalPages: number;
}) {
  if (historyData.length === 0) {
    return <EmptyHistoryState />;
  }

  return (
    <div className="space-y-5">
      {/* Desktop: a stack of individually-rounded row cards (not a flat
          divided table) so each day breathes with real whitespace between
          entries, the way the premium cards elsewhere on the page do. */}
      <div className="hidden md:block">
        <div className="mb-2 grid grid-cols-[3.75rem_1fr_1.3fr_1fr_auto] items-center gap-4 px-6 text-xs font-medium text-slate-400 tracking-wide">
          <div>Date</div>
          <div />
          <div>Meal</div>
          <div>Status</div>
          <div className="text-right">Day</div>
        </div>

        <div className="flex flex-col gap-3">
          {historyData.map((row, idx) => {
            const absoluteDayNumber = (currentPage - 1) * pageSize + idx + 1;
            const dateObj = parseISO(row.date);
            const today = isToday(dateObj);
            const visual = getHistoryStatusVisual(
              row.status,
              row.is_paused,
              row.date,
            );
            // Repeat-meal de-emphasis: when today's meal matches the row
            // directly above it (the common case — same plan every day),
            // collapse the long dish name into a short "Same as before"
            // note instead of repeating identical text ten rows running —
            // this is what actually breaks the monotony, not just a color
            // change on the same repeated words.
            const prevMealName = idx > 0 ? historyData[idx - 1]?.meal_name : null;
            const isRepeatMeal =
              !row.is_paused && row.meal_name && row.meal_name === prevMealName;
            const MealIcon = getMealIcon(row.meal_name);

            return (
              <div
                key={idx}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)] motion-reduce:hover:translate-y-0",
                  today
                    ? "border-primary/25 bg-primary/[0.035] shadow-sm"
                    : "border-slate-100 bg-white hover:border-slate-200",
                )}
              >
                {/* Status accent bar — visible at rest, not only on hover,
                    so hierarchy reads in a single static glance down the
                    page. */}
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-1",
                    ACCENT_BAR_TONES[visual.tone],
                  )}
                />

                <div className="grid grid-cols-[3.75rem_1fr_1.3fr_1fr_auto] items-center gap-4 py-4 pl-6 pr-6">
                  <DateBadge date={dateObj} today={today} />

                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      {format(dateObj, "EEEE")}
                      {today && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-primary">
                          Today
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {format(dateObj, "MMM d, yyyy")}
                    </p>
                  </div>

                  <div>
                    {row.is_paused ? (
                      <span className="inline-flex items-center gap-1.5 text-sm italic text-slate-400">
                        <PauseCircle className="h-3.5 w-3.5" /> Rest day
                      </span>
                    ) : isRepeatMeal ? (
                      <span className="inline-flex items-center gap-2 text-sm italic text-slate-400">
                        <MealIcon className="h-4 w-4 shrink-0 text-slate-300" />
                        Same as before
                      </span>
                    ) : (
                      <div>
                        <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                          <MealIcon className="h-4 w-4 shrink-0 text-primary" />
                          {row.meal_name || "Meal"}
                        </span>
                        {row.addons.length > 0 && (
                          <div className="mt-0.5 space-y-0.5 pl-6 text-xs text-slate-400">
                            {row.addons.map((a, i) => (
                              <div key={`${a.name}-${i}`}>
                                + {a.name} (x{a.quantity})
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <StatusDisplay tone={visual.tone} icon={visual.icon} label={visual.label} />
                  </div>

                  <div className="flex justify-end">
                    <DayBadge day={absoluteDayNumber} tone={visual.tone} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile cards — one card per day, no squeezed columns. */}
      <div className="flex flex-col gap-3 md:hidden">
        {historyData.map((row, idx) => {
          const absoluteDayNumber = (currentPage - 1) * pageSize + idx + 1;
          const dateObj = parseISO(row.date);
          const today = isToday(dateObj);
          const visual = getHistoryStatusVisual(
            row.status,
            row.is_paused,
            row.date,
          );
          const prevMealName = idx > 0 ? historyData[idx - 1]?.meal_name : null;
          const isRepeatMeal =
            !row.is_paused && row.meal_name && row.meal_name === prevMealName;
          const MealIcon = getMealIcon(row.meal_name);

          return (
            <div
              key={idx}
              className={cn(
                "relative overflow-hidden rounded-2xl border p-4 pl-5 transition-colors duration-200 active:bg-slate-100/70",
                today
                  ? "border-primary/20 bg-primary/[0.04]"
                  : "border-slate-100 bg-white",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  ACCENT_BAR_TONES[visual.tone],
                )}
              />

              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <DateBadge date={dateObj} today={today} />
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      {format(dateObj, "EEE, MMM d")}
                      {today && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-primary">
                          Today
                        </span>
                      )}
                    </p>
                    {row.is_paused ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                        <PauseCircle className="h-3 w-3" /> Rest day
                      </span>
                    ) : isRepeatMeal ? (
                      <span className="inline-flex items-center gap-1.5 text-xs italic text-slate-400">
                        <MealIcon className="h-3.5 w-3.5 text-slate-300" />
                        Same as before
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        <MealIcon className="h-3.5 w-3.5 text-primary" />
                        {row.meal_name || "Meal"}
                      </span>
                    )}
                  </div>
                </div>
                <DayBadge day={absoluteDayNumber} tone={visual.tone} />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200/70 pt-3">
                <StatusDisplay tone={visual.tone} icon={visual.icon} label={visual.label} />
              </div>

              {!row.is_paused && !isRepeatMeal && row.addons.length > 0 && (
                <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                  {row.addons.map((a, i) => (
                    <div key={`${a.name}-${i}`}>
                      + {a.name} (x{a.quantity})
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination controls (own card, matching the row language above). */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/50 px-4 sm:px-6 py-3.5">
          <Link
            href={`/meals?page=${currentPage - 1}`}
            aria-disabled={currentPage <= 1}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-primary/30 hover:text-primary hover:shadow motion-reduce:hover:translate-y-0 sm:px-4",
              currentPage <= 1 && "pointer-events-none opacity-40",
            )}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Previous</span>
          </Link>

          <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm sm:text-sm">
            Page {currentPage} of {totalPages}
          </span>

          <Link
            href={`/meals?page=${currentPage + 1}`}
            aria-disabled={currentPage >= totalPages}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-primary/30 hover:text-primary hover:shadow motion-reduce:hover:translate-y-0 sm:px-4",
              currentPage >= totalPages && "pointer-events-none opacity-40",
            )}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * EmptyHistoryState — premium empty state for a brand-new journey with no
 * history rows yet. Same rounded-card language as the populated journal,
 * reusing the app's own hand-built "empty" scene from journey-illustrations
 * (the resting-leaf illustration already used on Today's Meal Journey)
 * rather than a generic icon, plus a CTA into the plans page.
 */
function EmptyHistoryState() {
  return (
    <div className="overflow-hidden rounded-3xl border border-dashed border-slate-200 bg-white shadow-sm">
      <div className="mx-auto h-40 w-full max-w-xs sm:h-48">
        <JourneyIllustration id="empty" tone="green" />
      </div>
      <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-800">
            Your nutrition journey begins with today&apos;s first meal.
          </p>
          <p className="text-sm text-slate-500">
            Once your meals start arriving, they&apos;ll show up here as your
            personal journal.
          </p>
        </div>
        <Button asChild size="sm" className="mt-1">
          <Link href="/subscription">Browse Meal Plans</Link>
        </Button>
      </div>
    </div>
  );
}
