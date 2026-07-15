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
 * UpcomingDeliveries — a calm weekly schedule rather than a wall of repeated
 * cards. Repetition is reduced by only surfacing the delivery address when it
 * changes from the previous day, so the eye follows the rhythm of the week.
 */
export function UpcomingDeliveries({ items }: { items: DeliveryItem[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white/90 p-8 text-center text-sm text-slate-500 shadow-sm">
        No upcoming deliveries scheduled yet.
      </div>
    );
  }

  const addressKeyOf = (item: DeliveryItem) =>
    item.isPaused ? null : `${item.addressTag ?? ""}|${item.addressLine ?? ""}`;

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white/90 shadow-sm">
      <ul className="divide-y divide-slate-100">
        {items.map((item, idx) => {
          const date = parseISO(item.date);
          const theme = MEAL_THEMES[item.mealCode || "VEG"] || MEAL_THEMES.VEG;
          const showToday = isToday(date);
          const showTomorrow = isTomorrow(date);

          // Only render the address when it differs from the most recent
          // scheduled (non-paused) day — pure backward scan, no shared state.
          const addressKey = addressKeyOf(item);
          let prevKey: string | null = null;
          for (let j = idx - 1; j >= 0; j--) {
            const k = addressKeyOf(items[j]);
            if (k !== null) {
              prevKey = k;
              break;
            }
          }
          const addressChanged =
            addressKey !== null && addressKey !== prevKey;

          return (
            <li
              key={idx}
              className={cn(
                "flex items-center gap-4 px-4 py-3.5 transition-colors sm:px-5",
                item.isPaused ? "bg-slate-50/60" : "hover:bg-emerald-50/40",
              )}
            >
              {/* Date tile */}
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-center leading-none",
                  item.isPaused
                    ? "border-slate-200 bg-white text-slate-400"
                    : "border-emerald-100 bg-emerald-50 text-emerald-700",
                )}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide">
                  {format(date, "EEE")}
                </span>
                <span className="text-lg font-semibold">
                  {format(date, "dd")}
                </span>
              </div>

              {/* Meal + temporal context */}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {item.isPaused ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400">
                      <Moon className="h-3.5 w-3.5" />
                      Rest day
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                        theme.bg,
                        theme.text,
                        theme.border,
                      )}
                    >
                      <span
                        className={cn("h-1.5 w-1.5 rounded-full", theme.accent)}
                      />
                      {theme.label}
                    </span>
                  )}

                  {!item.isPaused && showToday && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      Today
                    </span>
                  )}
                  {!item.isPaused && showTomorrow && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                      Tomorrow
                    </span>
                  )}
                </div>

                {/* Address only when it changes */}
                {addressChanged ? (
                  <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                    <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                    <span className="truncate">
                      <span className="font-medium text-slate-600">
                        {item.addressTag || "Delivery"}
                      </span>
                      {item.addressLine ? ` · ${item.addressLine}` : ""}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">
                    {item.isPaused ? "No meal will be prepared" : "Same address"}
                  </p>
                )}
              </div>

              <span className="shrink-0 text-xs font-medium text-slate-400">
                {format(date, "MMM")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
