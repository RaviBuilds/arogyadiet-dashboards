"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  Check,
  Moon,
  Loader2,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { saveDailyLogAction } from "@/actions/kitTrackerActions";
import { DayLogDialog } from "@/shared/components/customer/kit-tracker/DayLogDialog";

/**
 * KitQuickLog — log a missed day without leaving the dashboard.
 *
 * The whole point of surfacing blank days is that the customer fixes them, so
 * the fix has to live where the problem is stated. Each row offers the only two
 * answers that matter — meal taken, or rested — as one tap. Detail fields
 * (weight, activity, intake) stay available behind "Add details", which opens
 * the same DayLogDialog the KIT Tracker uses, so there is exactly one logging
 * form in the product.
 *
 * Rows resolve in place: a saved day collapses to a confirmation line instead
 * of yanking the customer to another page, and the server data is refreshed in
 * the background so every other number on the dashboard catches up.
 */
export type QuickLogDay = {
  date: string;
  /** Marks the row as today so it can be labelled and ordered accordingly. */
  isToday?: boolean;
};

type KitQuickLogProps = {
  subscriptionId: string;
  days: QuickLogDay[];
  /**
   * "list" — several rows inside a tinted alert card. Buttons are outlined so
   * a stack of saturated green pills doesn't fight the alert's own colour, and
   * only the leading row (the oldest gap) plus today carry full weight.
   * "single" — one row on white, where the emerald fill is the page's primary
   * action and belongs at full strength.
   */
  variant?: "list" | "single";
  className?: string;
};

/** "LOGGED" covers a save made through the detail dialog, where the chosen
 *  status isn't reported back — the background refresh resolves the truth. */
type RowResult = { status: "FOOD_TAKEN" | "FOOD_SKIPPED" | "LOGGED" };

export function KitQuickLog({
  subscriptionId,
  days,
  variant = "list",
  className,
}: KitQuickLogProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saved, setSaved] = useState<Record<string, RowResult>>({});
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogDate, setDialogDate] = useState<string | null>(null);

  async function logDay(date: string, status: "FOOD_TAKEN" | "FOOD_SKIPPED") {
    setPendingDate(date);
    setError(null);

    const result = await saveDailyLogAction(subscriptionId, date, { status });

    if (result.success) {
      setSaved((prev) => ({ ...prev, [date]: { status } }));
      // Refresh in the background so the hero, momentum and week strip all
      // re-derive from real data rather than drifting from this local state.
      startTransition(() => router.refresh());
    } else {
      setError(result.error);
    }

    setPendingDate(null);
  }

  if (days.length === 0) return null;

  const solid = variant === "single";

  return (
    <div className={cn("space-y-2", className)}>
      {days.map((day, idx) => {
        const done = saved[day.date];
        const busy = pendingDate === day.date;
        const label = day.isToday
          ? "Today"
          : format(parseISO(day.date), "EEE d MMM");
        // The oldest gap leads; middle rows recede so the stack reads as a
        // short list rather than a data-entry table.
        const leading = solid || idx === 0 || Boolean(day.isToday);

        if (done) {
          return (
            <div
              key={day.date}
              className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-sm font-semibold text-emerald-900">{label}</p>
              <p className="text-sm text-emerald-700">
                {done.status === "FOOD_TAKEN"
                  ? "logged as meal taken"
                  : done.status === "FOOD_SKIPPED"
                    ? "logged as a rest day"
                    : "logged"}
              </p>
              <button
                type="button"
                onClick={() => setDialogDate(day.date)}
                className="ml-auto shrink-0 text-xs font-semibold text-emerald-700 underline-offset-2 hover:underline"
              >
                Add details
              </button>
            </div>
          );
        }

        return (
          <div
            key={day.date}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-2.5 transition-colors sm:flex-nowrap",
              leading
                ? "border-slate-200 bg-white shadow-sm"
                : "border-slate-200/70 bg-white/60",
              day.isToday && "border-emerald-200 bg-emerald-50/50",
            )}
          >
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm",
                  leading
                    ? "font-semibold text-slate-900"
                    : "font-medium text-slate-600",
                )}
              >
                {label}
              </p>
              {solid ? (
                <p className="text-xs text-slate-500">
                  One tap is enough — details are optional.
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => logDay(day.date, "FOOD_TAKEN")}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-all duration-200 active:scale-[0.97] disabled:opacity-60",
                  solid
                    ? "bg-emerald-600 text-white shadow-sm hover:brightness-105"
                    : "border border-emerald-300 bg-white text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50",
                )}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Meal taken
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => logDay(day.date, "FOOD_SKIPPED")}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
              >
                <Moon className="h-3.5 w-3.5" />
                Rested
              </button>
              <button
                type="button"
                onClick={() => setDialogDate(day.date)}
                aria-label={`Add full details for ${label}`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-all duration-200 hover:border-slate-300 hover:text-slate-700 active:scale-[0.97]"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}

      {error ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : null}

      {dialogDate ? (
        <DayLogDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialogDate(null);
          }}
          subscriptionId={subscriptionId}
          logDate={dialogDate}
          existingLog={
            saved[dialogDate] && saved[dialogDate].status !== "LOGGED"
              ? {
                  status: saved[dialogDate].status,
                  physical_activity_minutes: null,
                  physical_activity_name: null,
                  weight_kg: null,
                }
              : null
          }
          onSaved={() => {
            const date = dialogDate;
            setSaved((prev) => ({
              ...prev,
              [date]: { status: "LOGGED" },
            }));
            setDialogDate(null);
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
    </div>
  );
}
