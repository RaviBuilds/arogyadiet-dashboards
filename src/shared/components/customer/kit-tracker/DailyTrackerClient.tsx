"use client";

import { useState, useCallback } from "react";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  getDay,
  eachDayOfInterval,
  eachMonthOfInterval,
  isBefore,
  startOfDay,
} from "date-fns";
import {
  CheckCircle2,
  XCircle,
  Dumbbell,
  Scale,
  CalendarCheck,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DayLogDialog } from "./DayLogDialog";

interface DailyLog {
  status: "FOOD_TAKEN" | "FOOD_SKIPPED";
  physical_activity_minutes: number | null;
  physical_activity_name: string | null;
  weight_kg: number | null;
  fat_consumption?: string | null;
  water_intake_liters?: number | null;
  buttermilk_intake?: string | null;
  soup_name_qty?: string | null;
  protein_curry?: string | null;
  main_dish?: string | null;
  veg_curry?: string | null;
  eggs_count?: number | null;
  salads_qty?: string | null;
  step_count?: number | null;
}

interface DailyTrackerClientProps {
  subscriptionId: string;
  receivedDate: string;
  trackerEndDate: string;
  totalSkippedDays: number;
  dailyLogsByDate: Record<string, DailyLog>;
  todayServerDate: string;
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function DailyTrackerClient({
  subscriptionId,
  receivedDate,
  trackerEndDate,
  totalSkippedDays,
  dailyLogsByDate,
  todayServerDate,
}: DailyTrackerClientProps) {
  const [dailyLogs, setDailyLogs] =
    useState<Record<string, DailyLog>>(dailyLogsByDate);
  const [currentTotalSkippedDays, setCurrentTotalSkippedDays] =
    useState(totalSkippedDays);
  const [currentTrackerEndDate, setCurrentTrackerEndDate] =
    useState(trackerEndDate);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const receivedDateObj = parseISO(receivedDate);
  const trackerEndDateObj = parseISO(currentTrackerEndDate);

  // Compute months spanned by the tracker range
  const months = eachMonthOfInterval({
    start: startOfMonth(receivedDateObj),
    end: startOfMonth(trackerEndDateObj),
  });

  const handleDialogSaved = useCallback(
    (newTotalSkipped: number, newEndDate: string) => {
      setCurrentTotalSkippedDays(newTotalSkipped);
      setCurrentTrackerEndDate(newEndDate);

      // Close dialog and mark the log as needing refresh
      // We'll update the dailyLogs map optimistically when we know what was saved
      // For now, we use router revalidation pattern — but since we want no page reload,
      // we mark the selected date's log to reflect the change. The dialog closing
      // means we need to re-derive from action. Let's store a placeholder that forces re-render.
      if (selectedDate) {
        // We can't know the exact log from the action return, so we'll refetch
        // by triggering a re-render. The simplest approach: set a placeholder
        // that reflects "something was logged" — the page will reload on next nav.
        // Better: we derive from the skipped count change.
        const previousLog = dailyLogs[selectedDate];
        const previousSkipped = currentTotalSkippedDays;

        if (newTotalSkipped > previousSkipped) {
          // A skip was added
          setDailyLogs((prev) => ({
            ...prev,
            [selectedDate]: {
              status: "FOOD_SKIPPED",
              physical_activity_minutes: null,
              physical_activity_name: null,
              weight_kg: null,
            },
          }));
        } else if (newTotalSkipped < previousSkipped) {
          // A skip was removed (changed to taken)
          setDailyLogs((prev) => ({
            ...prev,
            [selectedDate]: {
              status: "FOOD_TAKEN",
              physical_activity_minutes:
                previousLog?.physical_activity_minutes ?? null,
              physical_activity_name:
                previousLog?.physical_activity_name ?? null,
              weight_kg: previousLog?.weight_kg ?? null,
            },
          }));
        } else {
          // Same skip count — either a taken→taken update or first-time taken log
          // We know it's FOOD_TAKEN since skip count didn't change
          setDailyLogs((prev) => ({
            ...prev,
            [selectedDate]: {
              status: previousLog?.status === "FOOD_SKIPPED" ? "FOOD_SKIPPED" : "FOOD_TAKEN",
              physical_activity_minutes:
                previousLog?.physical_activity_minutes ?? null,
              physical_activity_name:
                previousLog?.physical_activity_name ?? null,
              weight_kg: previousLog?.weight_kg ?? null,
            },
          }));
        }
      }

      setSelectedDate(null);
    },
    [selectedDate, dailyLogs, currentTotalSkippedDays]
  );

  function isDateEditable(dateStr: string): boolean {
    return dateStr >= receivedDate && dateStr <= todayServerDate;
  }

  function handleDayClick(dateStr: string) {
    if (isDateEditable(dateStr)) {
      setSelectedDate(dateStr);
    }
  }

  const today = startOfDay(parseISO(todayServerDate));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 max-w-4xl">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 border border-slate-200 rounded-xl shadow-sm sticky top-[60px] z-10">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
            KIT Tracker
          </h2>
          <p className="text-sm text-slate-500 flex items-center gap-1 mt-1">
            <CalendarCheck className="h-3 w-3" /> Tap on a day to log whether
            you took or skipped your KIT meal.
          </p>
        </div>
      </div>

      {/* Skip / End Date Banner */}
      <div
        className={cn(
          "rounded-xl border p-5 flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors duration-200",
          currentTotalSkippedDays > 0
            ? "bg-amber-50 border-amber-200"
            : "bg-blue-50 border-blue-200",
        )}
      >
        <div className="flex items-center gap-3">
          {currentTotalSkippedDays > 0 ? (
            <SkipForward className="h-6 w-6 text-amber-600" />
          ) : (
            <CalendarCheck className="h-6 w-6 text-blue-600" />
          )}
          <div>
            <p
              className={cn(
                "text-sm font-semibold",
                currentTotalSkippedDays > 0
                  ? "text-amber-900"
                  : "text-blue-900",
              )}
            >
              Skipped Days
            </p>
            <p
              className={cn(
                "text-xs",
                currentTotalSkippedDays > 0
                  ? "text-amber-700"
                  : "text-blue-700",
              )}
            >
              <strong>{currentTotalSkippedDays}</strong> day
              {currentTotalSkippedDays === 1 ? "" : "s"} skipped so far
            </p>
          </div>
        </div>
        <div className="text-center sm:text-right">
          <p
            className={cn(
              "text-xs font-medium",
              currentTotalSkippedDays > 0
                ? "text-amber-700"
                : "text-blue-700",
            )}
          >
            Tracker End Date
          </p>
          <p
            className={cn(
              "text-lg font-extrabold",
              currentTotalSkippedDays > 0
                ? "text-amber-900"
                : "text-blue-900",
            )}
          >
            {format(parseISO(currentTrackerEndDate), "MMMM do, yyyy")}
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-slate-50/50 rounded-xl border border-slate-200 text-sm w-fit mx-auto md:mx-0">
        <span className="text-slate-500 font-medium mr-2 hidden sm:inline">
          Legend:
        </span>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-green-50 text-green-700 border-green-200">
          <CheckCircle2 className="h-5 w-5 drop-shadow-sm" />
          <span className="font-semibold text-xs md:text-sm">Food Taken</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
          <XCircle className="h-5 w-5 drop-shadow-sm" />
          <span className="font-semibold text-xs md:text-sm">
            Food Skipped
          </span>
        </div>
      </div>

      {/* Calendar Render */}
      <div className="space-y-12 pb-20">
        {months.map((monthStart) => {
          const monthEnd = endOfMonth(monthStart);

          const allDaysInMonth = eachDayOfInterval({
            start: monthStart,
            end: monthEnd,
          });

          const trackerDaysInMonth = allDaysInMonth.filter((day) => {
            const dayStr = format(day, "yyyy-MM-dd");
            return dayStr >= receivedDate && dayStr <= currentTrackerEndDate;
          });

          if (trackerDaysInMonth.length === 0) return null;

          const firstDayOffset = getDay(trackerDaysInMonth[0]);

          return (
            <div
              key={format(monthStart, "yyyy-MM")}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8"
            >
              <h3 className="text-lg font-semibold text-slate-900 tracking-tight text-center mb-6">
                {format(monthStart, "MMMM yyyy")}
              </h3>

              <div
                className="grid gap-2 md:gap-4 text-center mb-2"
                style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
              >
                {WEEKDAY_LABELS.map((label) => (
                  <div
                    key={label}
                    className="text-xs font-medium text-slate-500 uppercase tracking-wider"
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div
                className="grid gap-2 md:gap-4"
                style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
              >
                {Array.from({ length: firstDayOffset }).map((_, i) => (
                  <div key={`empty-${i}`} className="aspect-square" />
                ))}

                {trackerDaysInMonth.map((day) => {
                  const dayStr = format(day, "yyyy-MM-dd");
                  const log = dailyLogs[dayStr];
                  const editable = isDateEditable(dayStr);
                  const isFuture = isBefore(today, startOfDay(day));
                  const isInPast = isBefore(startOfDay(day), today);
                  const isLockedOut = !editable;

                  let style = {
                    bg: "bg-slate-50",
                    border: "border-slate-200",
                    color: "text-slate-400",
                  };
                  let Icon = CalendarCheck;
                  let displayLabel = "";

                  if (log?.status === "FOOD_TAKEN") {
                    style = {
                      bg: "bg-green-50",
                      border: "border-green-200 hover:border-green-400",
                      color: "text-green-700",
                    };
                    Icon = CheckCircle2;
                    displayLabel = "Taken";
                  } else if (log?.status === "FOOD_SKIPPED") {
                    style = {
                      bg: "bg-amber-50",
                      border: "border-amber-200 hover:border-amber-400",
                      color: "text-amber-700",
                    };
                    Icon = XCircle;
                    displayLabel = "Skipped";
                  } else if (isFuture) {
                    style = {
                      bg: "bg-slate-50",
                      border: "border-slate-200",
                      color: "text-slate-400",
                    };
                    Icon = CalendarCheck;
                    displayLabel = "";
                  } else {
                    style = {
                      bg: "bg-white",
                      border: "border-slate-200 hover:border-primary/40",
                      color: "text-slate-600",
                    };
                    Icon = Sparkles;
                    displayLabel = "Log";
                  }

                  return (
                    <button
                      key={dayStr}
                      type="button"
                      disabled={isLockedOut}
                      onClick={() => handleDayClick(dayStr)}
                      className={cn(
                        "flex flex-col items-center justify-center aspect-square p-1 rounded-xl border transition-all duration-200 relative select-none",
                        isLockedOut
                          ? "bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed grayscale"
                          : cn(
                              style.bg,
                              style.border,
                              "group hover:shadow-md hover:-translate-y-0.5 cursor-pointer",
                            ),
                      )}
                    >
                      <span
                        className={cn(
                          "text-lg md:text-xl font-extrabold mb-0.5 md:mb-1",
                          isLockedOut ? "text-slate-400" : style.color,
                        )}
                      >
                        {format(day, "d")}
                      </span>

                      <div
                        className={cn(
                          "flex flex-col items-center justify-center gap-1",
                          isLockedOut ? "text-slate-400" : style.color,
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-6 w-6 md:h-8 md:w-8 drop-shadow-sm transition-transform group-active:scale-95",
                            isInPast && !log ? "opacity-60" : "",
                          )}
                        />
                        {displayLabel && (
                          <span className="text-[9px] md:text-[11px] font-bold leading-none text-center">
                            {displayLabel}
                          </span>
                        )}

                        {/* Activity and weight badges */}
                        {log?.status === "FOOD_TAKEN" &&
                          (log.physical_activity_minutes != null ||
                            log.weight_kg != null) && (
                            <div className="flex flex-col items-center gap-0.5 mt-0.5">
                              {log.physical_activity_minutes != null && (
                                <span className="flex items-center gap-0.5 text-[9px] font-semibold bg-white/70 rounded-full px-1.5 py-0.5">
                                  <Dumbbell className="size-2.5" />
                                  {log.physical_activity_minutes}m
                                </span>
                              )}
                              {log.weight_kg != null && (
                                <span className="flex items-center gap-0.5 text-[9px] font-semibold bg-white/70 rounded-full px-1.5 py-0.5">
                                  <Scale className="size-2.5" />
                                  {log.weight_kg}kg
                                </span>
                              )}
                            </div>
                          )}
                      </div>

                      {!isLockedOut && (
                        <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Day Log Dialog */}
      <DayLogDialog
        open={selectedDate !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null);
        }}
        subscriptionId={subscriptionId}
        logDate={selectedDate ?? ""}
        existingLog={selectedDate ? dailyLogs[selectedDate] ?? null : null}
        onSaved={handleDialogSaved}
      />
    </div>
  );
}
