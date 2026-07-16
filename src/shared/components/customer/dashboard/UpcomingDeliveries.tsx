import { format, parseISO, isToday, isTomorrow } from "date-fns";
import { MapPin, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEAL_THEMES } from "./meal-theme";

/**
 * A single day in the upcoming delivery schedule, pre-flattened by the page so
 * this component stays presentational and reusable.
 */
export type DeliveryItem = {
  date: string;
  isPaused: boolean;
  mealCode: string | null;
  addressTag: string | null;
  addressLine: string | null;
};

/**
 * UpcomingDeliveries — a full-width week view in the spirit of Apple Fitness /
 * Google Fit: seven evenly-distributed day columns that use the entire card.
 *
 * Each day is self-labelled with its meal (colour dot + name) so the week is
 * scannable in two seconds without guessing. Today is emphasised (filled date +
 * soft tint), Tomorrow is secondary, and later days gently lighten. A small pin
 * folds in only on days whose delivery address differs from the usual one, so
 * nothing repeats and the whole schedule stays a single compact band.
 */
export function UpcomingDeliveries({ items }: { items: DeliveryItem[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 text-center text-sm text-slate-500 shadow-sm">
        No upcoming deliveries scheduled yet.
      </div>
    );
  }

  // Show a clean seven-day week to match the "Next 7 days" framing.
  const week = items.slice(0, 7);

  const addressKeyOf = (item: DeliveryItem) =>
    item.isPaused ? null : `${item.addressTag ?? ""}|${item.addressLine ?? ""}`;

  // The usual address = the first scheduled day's; only deviations are flagged.
  const baseKey = (() => {
    for (const it of week) {
      const k = addressKeyOf(it);
      if (k !== null) return k;
    }
    return null;
  })();

  return (
    <div className="rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-sm sm:p-4">
      <ol className="flex items-stretch">
        {week.map((item, idx) => {
          const date = parseISO(item.date);
          const theme = MEAL_THEMES[item.mealCode || "VEG"] || MEAL_THEMES.VEG;
          const today = isToday(date);
          const tomorrow = isTomorrow(date);
          const emphasized = today || tomorrow;
          const addressChanged =
            !item.isPaused && addressKeyOf(item) !== baseKey;

          // Later days gently recede (never below readable).
          const opacity = emphasized
            ? 1
            : Math.max(0.62, 1 - (idx - 1) * 0.06);

          return (
            <li
              key={idx}
              className={cn(
                "flex flex-1 flex-col items-center gap-2 rounded-2xl px-0.5 py-1.5",
                // Today anchors the eye with a soft wash; Tomorrow gets a
                // lighter secondary wash. Later days carry no wash, so weight
                // falls away naturally without any change in row height.
                today && "bg-emerald-50",
                tomorrow && "bg-amber-50/60",
              )}
              style={{ opacity }}
            >
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide transition-all",
                  today
                    ? "text-emerald-700"
                    : tomorrow
                      ? "text-amber-700"
                      : "text-slate-400",
                )}
              >
                {format(date, "EEE")}
              </span>

              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-all",
                  today
                    ? "bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-100"
                    : tomorrow
                      ? "text-slate-800 ring-1 ring-inset ring-amber-300"
                      : "text-slate-700",
                )}
              >
                {format(date, "d")}
              </span>

              {/* Meal indicator + self-label */}
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  item.isPaused ? "bg-slate-300" : theme.accent,
                )}
              />
              <span
                className={cn(
                  "flex max-w-full items-center gap-0.5 text-[10px] font-medium leading-none transition-all",
                  item.isPaused
                    ? "text-slate-400"
                    : today
                      ? "font-semibold text-emerald-800"
                      : theme.text,
                )}
              >
                {item.isPaused ? (
                  <>
                    <Moon className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">Rest</span>
                  </>
                ) : (
                  <>
                    <span className="truncate">{theme.label}</span>
                    {addressChanged ? (
                      <MapPin className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
                    ) : null}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
