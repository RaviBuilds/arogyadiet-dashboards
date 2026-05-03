"use client";

import { useMemo } from "react";
import { format, addDays } from "date-fns";
import { ChevronLeft, CalendarCheck, AlertCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";

const SkipSvg = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="50"
      cy="50"
      r="42"
      fill="#FAFAFA"
      stroke="#D4D4D8"
      strokeWidth="5"
      strokeDasharray="10 8"
    />
    <path
      d="M 35 35 L 65 65 M 65 35 L 35 65"
      stroke="#A1A1AA"
      strokeWidth="8"
      strokeLinecap="round"
    />
  </svg>
);

const ActiveSvg = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="50"
      cy="50"
      r="42"
      fill="#E8F5E9"
      stroke="#81C784"
      strokeWidth="3"
    />
    <path
      d="M 30 50 L 45 65 L 70 35"
      stroke="#4CAF50"
      strokeWidth="8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function PauseSelection({ data, setData, plans, onNext, onBack }: any) {
  const selectedPlan = plans?.find((p: any) => p.id === data.planId);
  const baseDuration = selectedPlan?.duration_days || 30;

  const maxPauses = selectedPlan?.pause_credits;
  const pausesUsed = data.pausedDates?.length || 0;
  const isLimitReached = pausesUsed >= maxPauses;

  const totalDaysToGenerate = baseDuration + pausesUsed;

  const scheduleDays = useMemo(() => {
    if (!data.startDate) return [];
    return Array.from({ length: totalDaysToGenerate }).map((_, i) =>
      addDays(new Date(data.startDate), i),
    );
  }, [data.startDate, totalDaysToGenerate]);

  const calendarMonths = useMemo(() => {
    const months: Record<string, Date[]> = {};
    scheduleDays.forEach((date) => {
      const monthKey = format(date, "MMMM yyyy");
      if (!months[monthKey]) months[monthKey] = [];
      months[monthKey].push(date);
    });
    return months;
  }, [scheduleDays]);

  const handleTogglePause = (dateString: string) => {
    setData((prev: any) => {
      const newPaused = [...(prev.pausedDates || [])];
      const index = newPaused.indexOf(dateString);

      if (index > -1) {
        newPaused.splice(index, 1);
      } else {
        if (newPaused.length >= maxPauses) return prev;
        newPaused.push(dateString);
      }
      return { ...prev, pausedDates: newPaused };
    });
  };

  const endDate =
    scheduleDays.length > 0 ? scheduleDays[scheduleDays.length - 1] : null;

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-right-4 max-w-4xl mx-auto overflow-hidden">
      <div className="space-y-2">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">
            3
          </span>
          Manage Schedule & Pauses
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground ml-8 sm:ml-10 break-words">
          Need a break? Select any days you want to skip. We will automatically
          extend your subscription end date so you never lose a meal!
        </p>
      </div>

      <div className="ml-0 md:ml-10 space-y-6">
        <div
          className={cn(
            "border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors",
            isLimitReached
              ? "bg-amber-50 border-amber-200"
              : "bg-blue-50 border-blue-200",
          )}
        >
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {isLimitReached ? (
              <AlertCircle className="h-6 w-6 text-amber-600 shrink-0" />
            ) : (
              <CalendarCheck className="h-6 w-6 text-blue-600 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-semibold truncate",
                  isLimitReached ? "text-amber-900" : "text-blue-900",
                )}
              >
                Your {baseDuration}-Meal Plan
              </p>
              <p
                className={cn(
                  "text-xs leading-tight break-words",
                  isLimitReached ? "text-amber-700" : "text-blue-700",
                )}
              >
                Used <strong>{pausesUsed}</strong> of{" "}
                <strong>{maxPauses}</strong> credits.
                {isLimitReached && " (Limit Reached)"}
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right w-full sm:w-auto border-t sm:border-0 border-blue-200/50 pt-2 sm:pt-0">
            <p
              className={cn(
                "text-xs font-medium",
                isLimitReached ? "text-amber-700" : "text-blue-700",
              )}
            >
              New End Date
            </p>
            <p
              className={cn(
                "text-lg font-extrabold truncate",
                isLimitReached ? "text-amber-900" : "text-blue-900",
              )}
            >
              {endDate ? format(endDate, "MMM do, yyyy") : "..."}
            </p>
          </div>
        </div>

        <div className="space-y-8 sm:space-y-12">
          {Object.entries(calendarMonths).map(([monthName, daysInMonth]) => {
            const firstDayOffset = daysInMonth[0].getDay();

            return (
              <div
                key={monthName}
                className="bg-white rounded-xl sm:rounded-2xl border p-3 sm:p-8 shadow-sm overflow-hidden"
              >
                <h3 className="text-lg sm:text-xl font-bold text-center mb-4 sm:mb-6 text-zinc-800">
                  {monthName}
                </h3>
                <div
                  className="grid gap-1 sm:gap-4 text-center mb-2"
                  style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
                >
                  {WEEKDAYS.map((day) => (
                    <div
                      key={day}
                      className="text-[10px] sm:text-sm font-bold text-zinc-400 uppercase tracking-wider"
                    >
                      {day}
                    </div>
                  ))}
                </div>
                <div
                  className="grid gap-1 sm:gap-4"
                  style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
                >
                  {Array.from({ length: firstDayOffset }).map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square" />
                  ))}

                  {daysInMonth.map((date, index) => {
                    const dateStr = format(date, "yyyy-MM-dd");
                    const isPaused = data.pausedDates?.includes(dateStr);
                    const isDisabled = !isPaused && isLimitReached;

                    return (
                      <button
                        key={index}
                        disabled={isDisabled}
                        onClick={() => handleTogglePause(dateStr)}
                        className={cn(
                          "flex flex-col items-center justify-center aspect-square p-0.5 sm:p-1 rounded-xl sm:rounded-2xl border sm:border-2 transition-all relative select-none",
                          isPaused
                            ? "bg-zinc-50 border-zinc-300 border-dashed"
                            : "bg-green-50/30 border-green-200",
                          !isDisabled &&
                            !isPaused &&
                            "group hover:shadow-md hover:border-green-400 hover:-translate-y-0.5",
                          isDisabled &&
                            "opacity-40 cursor-not-allowed grayscale",
                        )}
                      >
                        <span
                          className={cn(
                            "text-sm sm:text-xl font-extrabold mb-0.5",
                            isPaused || isDisabled
                              ? "text-zinc-400"
                              : "text-green-700",
                          )}
                        >
                          {format(date, "d")}
                        </span>
                        <div className="flex flex-col items-center justify-center gap-1">
                          {isPaused ? (
                            <SkipSvg className="h-4 w-4 sm:h-8 sm:w-8" />
                          ) : (
                            <ActiveSvg
                              className={cn(
                                "h-4 w-4 sm:h-8 sm:w-8",
                                !isDisabled && "drop-shadow-sm",
                              )}
                            />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Button Layout Fixed */}
      <div className="pt-6 sm:pt-8 border-t flex flex-col-reverse sm:flex-row justify-between items-center gap-4 md:ml-10 mt-8">
        <Button
          variant="ghost"
          onClick={onBack}
          className="w-full sm:w-auto gap-2"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" /> Back
        </Button>
        <Button
          size="lg"
          onClick={onNext}
          className="w-full sm:w-auto bg-primary hover:bg-primary/90 px-10 text-white font-bold shadow-md"
        >
          Next: Customize Meals
        </Button>
      </div>
    </div>
  );
}
