import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/shared/components/customer/profile-ui/StatusPill";
import { getHistoryStatusVisual } from "@/shared/components/customer/meals/meal-history-status";

export type AddonProductLine = { name: string; quantity: number };

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
 * page.tsx (identical Prev/Next Link markup), split into two renders from
 * one dataset: a cleaned-up desktop table, and mobile timeline cards (a
 * connecting rail + day dot) so small screens read as a journal rather than
 * squeezed table columns.
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
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {/* Desktop table */}
      <div className="hidden md:block">
        <div className="grid grid-cols-4 bg-slate-50/50 border-b border-slate-100 px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">
          <div>Date</div>
          <div>Meal/Action</div>
          <div>Status</div>
          <div className="text-right">Day #</div>
        </div>

        <div className="divide-y divide-slate-100">
          {historyData.map((row, idx) => {
            const absoluteDayNumber = (currentPage - 1) * pageSize + idx + 1;
            const dateObj = parseISO(row.date);
            const visual = getHistoryStatusVisual(
              row.status,
              row.is_paused,
              row.date,
            );

            return (
              <div
                key={idx}
                className="px-6 py-5 grid grid-cols-4 items-center hover:bg-slate-50 transition-colors duration-200"
              >
                <div className="font-medium text-slate-900">
                  {format(dateObj, "MMM do, yyyy")}
                </div>

                <div>
                  {row.is_paused ? (
                    <span className="text-sm italic text-slate-400">
                      Rest day
                    </span>
                  ) : (
                    <div>
                      <span className="text-sm font-medium text-slate-700">
                        {row.meal_name || "Meal"}
                      </span>
                      {row.addons.length > 0 && (
                        <div className="text-xs text-slate-500 mt-0.5 space-y-0.5">
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
                  <StatusPill tone={visual.tone} icon={visual.icon}>
                    {visual.label}
                  </StatusPill>
                </div>

                <div className="text-right font-mono text-sm text-slate-400">
                  {absoluteDayNumber}
                </div>
              </div>
            );
          })}

          {historyData.length === 0 && (
            <div className="p-10 text-center text-sm text-slate-500">
              No history found.
            </div>
          )}
        </div>
      </div>

      {/* Mobile timeline cards */}
      <div className="md:hidden divide-y divide-slate-100">
        {historyData.map((row, idx) => {
          const absoluteDayNumber = (currentPage - 1) * pageSize + idx + 1;
          const dateObj = parseISO(row.date);
          const visual = getHistoryStatusVisual(
            row.status,
            row.is_paused,
            row.date,
          );
          const isLast = idx === historyData.length - 1;

          return (
            <div key={idx} className="flex gap-3 px-4 py-4">
              {/* Connecting rail */}
              <div className="flex flex-col items-center pt-1">
                <span
                  className={cn(
                    "flex h-2.5 w-2.5 shrink-0 rounded-full",
                    row.is_paused
                      ? "bg-slate-300"
                      : visual.tone === "green"
                        ? "bg-emerald-500"
                        : visual.tone === "red"
                          ? "bg-red-500"
                          : visual.tone === "amber"
                            ? "bg-amber-500"
                            : visual.tone === "orange"
                              ? "bg-orange-500"
                              : visual.tone === "purple"
                                ? "bg-purple-500"
                                : visual.tone === "blue"
                                  ? "bg-blue-500"
                                  : "bg-slate-300",
                  )}
                />
                {!isLast ? (
                  <span className="mt-1 w-px flex-1 bg-slate-200" />
                ) : null}
              </div>

              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {format(dateObj, "EEE, MMM do")}
                  </p>
                  <span className="shrink-0 font-mono text-xs text-slate-400">
                    Day {absoluteDayNumber}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  {row.is_paused ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <PauseCircle className="h-3 w-3" /> Rest day
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-slate-600">
                      {row.meal_name || "Meal"}
                    </span>
                  )}
                  <StatusPill tone={visual.tone} icon={visual.icon}>
                    {visual.label}
                  </StatusPill>
                </div>

                {!row.is_paused && row.addons.length > 0 && (
                  <div className="mt-1.5 text-xs text-slate-500 space-y-0.5">
                    {row.addons.map((a, i) => (
                      <div key={`${a.name}-${i}`}>
                        + {a.name} (x{a.quantity})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {historyData.length === 0 && (
          <div className="p-10 text-center text-sm text-slate-500">
            No history found.
          </div>
        )}
      </div>

      {/* Pagination controls (unchanged behaviour) */}
      {totalPages > 1 && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link
            href={`/meals?page=${currentPage - 1}`}
            aria-disabled={currentPage <= 1}
            className={cn(
              "inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50",
              currentPage <= 1 && "pointer-events-none opacity-50",
            )}
          >
            <ChevronLeft className="h-4 w-4 mr-2" /> Previous
          </Link>

          <span className="text-sm font-medium text-slate-500">
            Page {currentPage} of {totalPages}
          </span>

          <Link
            href={`/meals?page=${currentPage + 1}`}
            aria-disabled={currentPage >= totalPages}
            className={cn(
              "inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50",
              currentPage >= totalPages && "pointer-events-none opacity-50",
            )}
          >
            Next <ChevronRight className="h-4 w-4 ml-2" />
          </Link>
        </div>
      )}
    </div>
  );
}
