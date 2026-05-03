"use client";

import { useMemo } from "react";
import { format, addDays } from "date-fns";
import { ChevronLeft, Info, CalendarOff, CalendarCheck } from "lucide-react";
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

  //The logic total days = Base plan + Number of paused Days

  const totalDaysToGenerate = baseDuration + (data.pauseDates?.length || 0);

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
        newPaused.splice(index, 1); // Un-pause
      } else {
        newPaused.push(dateString); // Pause
      }
      return { ...prev, pausedDates: newPaused };
    });
  };

  const endDate = scheduleDays.length > 0 ? scheduleDays[scheduleDays.length - 1] : null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
            3
          </span>
          Manage Schedule & Pauses
        </h2>
        <p className="text-muted-foreground ml-10">
          Need a break? Select any days you want to skip. We will automatically
          extend your subscription end date so you never lose a meal!
        </p>
      </div>

      <div className="ml-0 md:ml-10 space-y-6">
        {/* Dynamic End Date Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CalendarCheck className="h-6 w-6 text-blue-600" />
            <div>
              <p className="text-sm text-blue-900 font-semibold">
                Your {baseDuration}-Meal Plan
              </p>
              <p className="text-xs text-blue-700">
                You have paused <strong>{data.pausedDates?.length || 0}</strong>{" "}
                days.
              </p>
            </div>
          </div>
          <div className="text-center sm:text-right">
            <p className="text-xs text-blue-700 font-medium">New End Date</p>
            <p className="text-lg font-extrabold text-blue-900">
              {endDate ? format(endDate, "MMMM do, yyyy") : "..."}
            </p>
          </div>
        </div>

        {/* Dynamic Calendar Generation */}
        <div className="space-y-12">
          {Object.entries(calendarMonths).map(([monthName, daysInMonth]) => {
            const firstDayOffset = daysInMonth[0].getDay();

            return (
              <div
                key={monthName}
                className="bg-white rounded-2xl border p-4 md:p-8 shadow-sm"
              >
                <h3 className="text-xl font-bold text-center mb-6 text-zinc-800">
                  {monthName}
                </h3>
                <div
                  className="grid gap-2 md:gap-4 text-center mb-2"
                  style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
                >
                  {WEEKDAYS.map((day) => (
                    <div
                      key={day}
                      className="text-xs md:text-sm font-bold text-zinc-400 uppercase tracking-wider"
                    >
                      {day}
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

                  {daysInMonth.map((date, index) => {
                    const dateStr = format(date, "yyyy-MM-dd");
                    const isPaused = data.pausedDates?.includes(dateStr);

                    return (
                      <button
                        key={index}
                        onClick={() => handleTogglePause(dateStr)}
                        className={cn(
                          "flex flex-col items-center justify-center aspect-square p-1 rounded-2xl border-2 transition-all relative select-none group hover:-translate-y-0.5",
                          isPaused
                            ? "bg-zinc-50 border-zinc-300 border-dashed"
                            : "bg-green-50/30 border-green-200 hover:shadow-md hover:border-green-400",
                        )}
                      >
                        <span
                          className={cn(
                            "text-lg md:text-xl font-extrabold mb-0.5 md:mb-1",
                            isPaused ? "text-zinc-400" : "text-green-700",
                          )}
                        >
                          {format(date, "d")}
                        </span>
                        <div className="flex flex-col items-center justify-center gap-1">
                          {isPaused ? (
                            <SkipSvg className="h-6 w-6 md:h-8 md:w-8" />
                          ) : (
                            <ActiveSvg className="h-6 w-6 md:h-8 md:w-8 drop-shadow-sm" />
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

      <div className="pt-8 border-t flex justify-between items-center md:ml-10">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <Button
          size="lg"
          onClick={onNext}
          className="bg-primary hover:bg-primary/90 px-10 text-white font-bold shadow-md"
        >
          Next: Customize Meals
        </Button>
      </div>
    </div>
  );
}
