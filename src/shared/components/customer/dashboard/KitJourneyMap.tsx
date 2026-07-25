import { format, parseISO } from "date-fns";
import { Check, Moon, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * KitJourneyMap — the whole kit window at a glance.
 *
 * This replaces the seven-day strip, which showed exactly the same days the
 * pending-logs card was already listing. A kit is a finite, bounded thing
 * (20 or 30 days), so the honest visualisation is the entire window as one
 * compact map: what was eaten, what was rested, what is still blank, what is
 * still ahead. It answers a question nothing else on the page answers — "how
 * does my whole kit actually look?" — instead of repeating the backlog.
 *
 * Presentational only; the dashboard derives the day list and statuses.
 */
export type KitMapStatus = "taken" | "rest" | "pending" | "upcoming";

export type KitMapDay = {
  date: string;
  status: KitMapStatus;
};

const CELL: Record<
  KitMapStatus,
  { cell: string; text: string; label: string }
> = {
  taken: {
    cell: "bg-emerald-500 text-white shadow-sm",
    text: "text-white",
    label: "meal taken",
  },
  rest: {
    cell: "bg-slate-200 text-slate-600",
    text: "text-slate-600",
    label: "rest day",
  },
  pending: {
    cell: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300",
    text: "text-amber-800",
    label: "not logged",
  },
  upcoming: {
    cell: "bg-white text-slate-400 ring-1 ring-inset ring-slate-200",
    text: "text-slate-400",
    label: "still ahead",
  },
};

const LEGEND: Array<{
  status: KitMapStatus;
  label: string;
  icon: typeof Check | null;
}> = [
  { status: "taken", label: "Taken", icon: Check },
  { status: "rest", label: "Rest", icon: Moon },
  { status: "pending", label: "Not logged", icon: null },
  { status: "upcoming", label: "Ahead", icon: Minus },
];

export function KitJourneyMap({
  days,
  todayDate,
}: {
  days: KitMapDay[];
  /** yyyy-MM-dd for today, so the current cell can be anchored. */
  todayDate: string;
}) {
  if (days.length === 0) return null;

  const counts = days.reduce<Record<KitMapStatus, number>>(
    (acc, d) => {
      acc[d.status] += 1;
      return acc;
    },
    { taken: 0, rest: 0, pending: 0, upcoming: 0 },
  );

  const first = days[0];
  const last = days[days.length - 1];

  return (
    <div className="rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">
          {format(parseISO(first.date), "d MMM")} →{" "}
          {format(parseISO(last.date), "d MMM yyyy")}
          <span className="ml-2 text-slate-400">
            {days.length} day window
          </span>
        </p>

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {LEGEND.map((item) => (
            <li
              key={item.status}
              className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"
            >
              <span
                className={cn(
                  "h-3 w-3 shrink-0 rounded-[4px]",
                  CELL[item.status].cell,
                )}
              />
              {item.label}
              {counts[item.status] > 0 ? (
                <span className="tabular-nums text-slate-400">
                  {counts[item.status]}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <ol className="flex flex-wrap gap-1.5">
        {days.map((day) => {
          const isToday = day.date === todayDate;
          const style = CELL[day.status];
          const readable = format(parseISO(day.date), "EEE d MMM");
          return (
            <li key={day.date} className="shrink-0">
              <span
                title={`${readable} — ${style.label}`}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-[10px] text-xs font-semibold tabular-nums transition-transform duration-200 hover:scale-105",
                  style.cell,
                  isToday && "ring-2 ring-emerald-600 ring-offset-2",
                )}
              >
                {format(parseISO(day.date), "d")}
                <span className="sr-only">
                  {readable} — {style.label}
                  {isToday ? " (today)" : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
