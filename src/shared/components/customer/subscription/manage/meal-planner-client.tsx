"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, addDays, startOfDay, parseISO, isBefore } from "date-fns";
import { RefreshCw, Save, Loader2, AlertCircle, CalendarCheck } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  bulkUpdateMealPreferencesAction,
  bulkUpdatePausePreferencesAction,
} from "@/actions/manageMealActions";

// --- REUSED SVGS ---
const VegSvg = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M52 97 C 52 97, 12 72, 12 37 C 12 17, 32 7, 52 7 C 72 7, 92 17, 92 37 C 92 72, 52 97, 52 97 Z"
      fill="#1B5E20"
      opacity="0.2"
    />
    <path
      d="M50 95 C 50 95, 10 70, 10 35 C 10 15, 30 5, 50 5 C 70 5, 90 15, 90 35 C 90 70, 50 95, 50 95 Z"
      fill="#4CAF50"
    />
    <path
      d="M50 5 C 30 5, 10 15, 10 35 C 10 70, 50 95, 50 95 C 50 95, 60 70, 60 35 C 60 15, 50 5, 50 5 Z"
      fill="#81C784"
      opacity="0.3"
    />
    <path
      d="M50 95 L50 15 M50 75 L30 55 M50 55 L70 35 M50 35 L35 20"
      stroke="#1B5E20"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const MeatSvg = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="meatGradient" x1="20" y1="20" x2="95" y2="95">
        <stop offset="0%" stopColor="#FFA000" />
        <stop offset="55%" stopColor="#FF8F00" />
        <stop offset="100%" stopColor="#D35400" />
      </linearGradient>
      <linearGradient id="boneGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FFF3E0" />
        <stop offset="100%" stopColor="#E8C38E" />
      </linearGradient>
    </defs>
    <g stroke="#9A3B2D" strokeWidth="1.8" strokeLinejoin="round">
      <path
        d="M15 78 C8 73 6 86 13 91 C18 95 24 93 27 88 C27 95 34 98 40 94 C48 89 46 76 37 77 C34 70 24 69 21 76 C18 75 17 76 15 78 Z"
        fill="url(#boneGradient)"
      />
      <path
        d="M32 78 C42 71 49 63 58 53"
        stroke="#E4C177"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </g>
    <path
      d="M55 50 C67 15 98 12 108 38 C118 65 101 92 72 88 C48 84 37 67 45 55 C48 51 51 50 55 50 Z"
      fill="url(#meatGradient)"
      stroke="#34143E"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <path
      d="M61 27 C74 18 90 19 98 29 C88 40 70 40 58 34 C57 31 58 29 61 27 Z"
      fill="white"
      opacity="0.72"
    />
  </svg>
);
const EggSvg = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <ellipse cx="50" cy="85" rx="30" ry="8" fill="#BCAAA4" opacity="0.4" />
    <path
      d="M50 8 C 22 8 12 45 12 65 C 12 87 30 92 50 92 C 70 92 88 87 88 65 C 88 45 78 8 50 8 Z"
      fill="#FFE0B2"
    />
    <path
      d="M88 65 C 88 87 70 92 50 92 C 70 92 80 80 80 65 C 80 45 75 20 50 8 C 78 8 88 45 88 65 Z"
      fill="#FFCC80"
      opacity="0.6"
    />
  </svg>
);
const MixedSvg = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="10"
      y="20"
      width="76"
      height="60"
      rx="12"
      fill="#F3E5F5"
      stroke="#AB47BC"
      strokeWidth="4"
    />
    <line x1="48" y1="20" x2="48" y2="80" stroke="#AB47BC" strokeWidth="4" />
    <line x1="48" y1="50" x2="86" y2="50" stroke="#AB47BC" strokeWidth="4" />
    <rect x="18" y="28" width="22" height="44" rx="6" fill="#81C784" />
    <rect x="56" y="28" width="22" height="14" rx="4" fill="#FFD54F" />
    <rect x="56" y="58" width="22" height="14" rx="4" fill="#FF8A65" />
  </svg>
);
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

function getCategoryLabel(code: string, name?: string) {
  if (code === "CHICKEN") return "Non-Veg";
  if (code === "VEG") return "Veg";
  if (code === "EGG") return "Egg";
  return name || code;
}

const PREF_STYLES: Record<string, any> = {
  VEG: {
    icon: VegSvg,
    color: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200 hover:border-green-400",
    label: "Veg",
  },
  CHICKEN: {
    icon: MeatSvg,
    color: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200 hover:border-red-400",
    label: "Non-Veg",
  },
  EGG: {
    icon: EggSvg,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200 hover:border-amber-400",
    label: "Egg",
  },
  MIXED: {
    icon: MixedSvg,
    color: "text-purple-700",
    bg: "bg-purple-50",
    border: "border-purple-200 hover:border-purple-400",
    label: "Mixed",
  },
};

const PAUSE_STYLE = {
  icon: SkipSvg,
  color: "text-zinc-500",
  bg: "bg-zinc-50",
  border: "border-zinc-200 border-dashed hover:border-zinc-400",
  label: "Pause",
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getNextMealPreference(
  currentState: string,
  mealCycle: string[],
  baseFood: string,
  limitReached: boolean,
): string {
  if (currentState === "PAUSE") {
    return baseFood;
  }
  if (limitReached) {
    const idx = mealCycle.indexOf(currentState);
    const safeIdx = idx === -1 ? 0 : idx;
    return mealCycle[(safeIdx + 1) % mealCycle.length];
  }
  const fullCycle = [...mealCycle, "PAUSE"];
  const idx = fullCycle.indexOf(currentState);
  const safeIdx = idx === -1 ? 0 : idx;
  return fullCycle[(safeIdx + 1) % fullCycle.length];
}

export function MealPlannerClient({
  subscriptionId,
  baseFoodType,
  scheduleDays,
  initialOverrides,
  initialPausedDates,
  mealCategories,
  maxPauses,
  totalPausesUsed = 0,
}: any) {
  const router = useRouter();
  const [overrides, setOverrides] =
    useState<Record<string, string>>(initialOverrides);
  const [pausedDates, setPausedDates] = useState<string[]>(initialPausedDates);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const PREFERRED_ORDER = ["VEG", "EGG", "CHICKEN"];
  const sortedCodes = [...mealCategories]
    .map((c: any) => c.code)
    .sort((a, b) => {
      const idxA = PREFERRED_ORDER.indexOf(a);
      const idxB = PREFERRED_ORDER.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  const hiddenPausedCount = useMemo(
    () => Math.max(0, totalPausesUsed - initialPausedDates.length),
    [totalPausesUsed, initialPausedDates.length],
  );
  const pausesUsed = hiddenPausedCount + pausedDates.length;
  const isLimitReached = pausesUsed >= (maxPauses || 0);

  const mealCycleOptions = useMemo(
    () => (sortedCodes.length > 0 ? sortedCodes : [baseFoodType]),
    [sortedCodes, baseFoodType],
  );

  const cycleOptionsForLegend = useMemo(
    () =>
      isLimitReached ? mealCycleOptions : [...mealCycleOptions, "PAUSE"],
    [mealCycleOptions, isLimitReached],
  );

  const categoryIdByCode = useMemo(() => {
    const map: Record<string, string> = {};
    mealCategories?.forEach((c: any) => {
      map[c.code] = c.id;
    });
    return map;
  }, [mealCategories]);

  useEffect(() => {
    const syncTimer = window.setTimeout(() => {
      setOverrides(initialOverrides);
      setPausedDates(initialPausedDates);
    }, 0);

    return () => window.clearTimeout(syncTimer);
  }, [initialOverrides, initialPausedDates]);

  // --- 5 PM CUT-OFF LOGIC ---
  const minEditableDate = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const daysToAdd = currentHour >= 17 ? 2 : 1;
    return startOfDay(addDays(now, daysToAdd));
  }, []);

  const calendarMonths = useMemo(() => {
    const months: Record<string, Date[]> = {};
    scheduleDays.forEach((dateStr: string) => {
      const date = parseISO(dateStr);
      const monthKey = format(date, "MMMM yyyy");
      if (!months[monthKey]) months[monthKey] = [];
      months[monthKey].push(date);
    });
    return months;
  }, [scheduleDays]);

  const handleToggleMeal = (dateString: string) => {
    const date = parseISO(dateString);
    if (isBefore(startOfDay(date), minEditableDate)) return;

    setSaveMessage(null);

    const currentState = pausedDates.includes(dateString)
      ? "PAUSE"
      : overrides[dateString] || baseFoodType;

    const nextPref = getNextMealPreference(
      currentState,
      mealCycleOptions,
      baseFoodType,
      isLimitReached,
    );

    const newPausedDates = [...pausedDates];
    const newOverrides = { ...overrides };

    if (nextPref === "PAUSE") {
      if (!newPausedDates.includes(dateString)) {
        newPausedDates.push(dateString);
      }
      delete newOverrides[dateString];
    } else if (nextPref === baseFoodType) {
      const pauseIndex = newPausedDates.indexOf(dateString);
      if (pauseIndex > -1) newPausedDates.splice(pauseIndex, 1);
      delete newOverrides[dateString];
    } else {
      const pauseIndex = newPausedDates.indexOf(dateString);
      if (pauseIndex > -1) newPausedDates.splice(pauseIndex, 1);
      newOverrides[dateString] = nextPref;
    }

    setPausedDates(newPausedDates);
    setOverrides(newOverrides);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    const mealUpdates: { date: string; categoryId: string | null }[] = [];
    const pauseUpdates: { date: string; isPaused: boolean }[] = [];

    scheduleDays.forEach((dateStr: string) => {
      const wasPaused = initialPausedDates.includes(dateStr);
      const isNowPaused = pausedDates.includes(dateStr);
      const initialMeal = wasPaused
        ? null
        : initialOverrides[dateStr] || baseFoodType;
      const currentMeal = isNowPaused
        ? null
        : overrides[dateStr] || baseFoodType;

      if (wasPaused !== isNowPaused) {
        pauseUpdates.push({ date: dateStr, isPaused: isNowPaused });
      }

      if (!isNowPaused && initialMeal !== currentMeal) {
        mealUpdates.push({
          date: dateStr,
          categoryId: categoryIdByCode[currentMeal!] || null,
        });
      }
    });

    if (mealUpdates.length === 0 && pauseUpdates.length === 0) {
      setSaveMessage({ type: "success", text: "No changes detected." });
      setIsSaving(false);
      return;
    }

    if (pauseUpdates.length > 0) {
      const pauseResult = await bulkUpdatePausePreferencesAction(
        subscriptionId,
        pauseUpdates,
      );
      if (!pauseResult.success) {
        setSaveMessage({
          type: "error",
          text:
            pauseResult.error ||
            "Failed to update schedule. Please try again.",
        });
        setIsSaving(false);
        return;
      }
    }

    if (mealUpdates.length > 0) {
      const mealResult = await bulkUpdateMealPreferencesAction(
        subscriptionId,
        mealUpdates,
      );
      if (!mealResult.success) {
        setSaveMessage({
          type: "error",
          text: "Failed to update meals. Please try again.",
        });
        setIsSaving(false);
        return;
      }
    }

    setSaveMessage({
      type: "success",
      text: "Meal planner successfully updated!",
    });
    router.refresh();
    setIsSaving(false);
  };

  const hasChanges = scheduleDays.some((dateStr: string) => {
    const wasPaused = initialPausedDates.includes(dateStr);
    const isNowPaused = pausedDates.includes(dateStr);
    const initialMeal = wasPaused
      ? null
      : initialOverrides[dateStr] || baseFoodType;
    const currentMeal = isNowPaused
      ? null
      : overrides[dateStr] || baseFoodType;
    return wasPaused !== isNowPaused || initialMeal !== currentMeal;
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      {/* Top Banner & Save Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 border rounded-xl shadow-sm sticky top-[60px] z-10">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">
            Manage Meal Planner
          </h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <AlertCircle className="h-3 w-3" /> Changes for tomorrow must be
            made before 5:00 PM today.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="w-full sm:w-auto font-bold transition-all"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> Save Changes
            </>
          )}
        </Button>
      </div>

      {saveMessage && (
        <Alert
          className={
            saveMessage.type === "success"
              ? "bg-green-50 border-green-200 text-green-900"
              : "bg-red-50 border-red-200 text-red-900"
          }
        >
          <AlertDescription className="font-medium">
            {saveMessage.text}
          </AlertDescription>
        </Alert>
      )}

      {/* Pause Credit Banner */}
      <div
        className={cn(
          "border rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors",
          isLimitReached
            ? "bg-amber-50 border-amber-200"
            : "bg-blue-50 border-blue-200",
        )}
      >
        <div className="flex items-center gap-3">
          {isLimitReached ? (
            <AlertCircle className="h-6 w-6 text-amber-600" />
          ) : (
            <CalendarCheck className="h-6 w-6 text-blue-600" />
          )}
          <div>
            <p
              className={cn(
                "text-sm font-semibold",
                isLimitReached ? "text-amber-900" : "text-blue-900",
              )}
            >
              Pause Credit Usage
            </p>
            <p
              className={cn(
                "text-xs",
                isLimitReached ? "text-amber-700" : "text-blue-700",
              )}
            >
              You have used <strong>{pausesUsed}</strong> of{" "}
              <strong>{maxPauses}</strong> available credits.
              {isLimitReached && " (Limit Reached)"}
            </p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 md:gap-4 p-3 bg-zinc-50 rounded-lg border text-sm w-fit">
        <span className="text-muted-foreground font-medium mr-2 flex items-center gap-1 hidden sm:flex">
          <RefreshCw className="h-4 w-4" /> Click date to cycle:
        </span>
        {cycleOptionsForLegend.map((option) => {
          if (option === "PAUSE") {
            const Icon = PAUSE_STYLE.icon;
            return (
              <div
                key="PAUSE"
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md",
                  PAUSE_STYLE.bg,
                  PAUSE_STYLE.color,
                )}
              >
                <Icon className="h-4 w-4 drop-shadow-sm" />
                <span className="font-bold text-xs md:text-sm">
                  {PAUSE_STYLE.label}
                </span>
              </div>
            );
          }

          const category = mealCategories.find((c: any) => c.code === option);
          const style = PREF_STYLES[option] || PREF_STYLES.VEG;
          const Icon = style.icon;
          const label = getCategoryLabel(option, category?.name);

          return (
            <div
              key={option}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md",
                style.bg,
                style.color,
              )}
            >
              <Icon className="h-4 w-4 drop-shadow-sm" />
              <span className="font-bold text-xs md:text-sm">{label}</span>
            </div>
          );
        })}
      </div>

      {/* Calendar Render */}
      <div className="space-y-12 pb-20">
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
                  const isPaused = pausedDates.includes(dateStr);
                  const isLockedOut = isBefore(
                    startOfDay(date),
                    minEditableDate,
                  );
                  const isDisabled = isLockedOut;

                  const dayPrefCode = overrides[dateStr] || baseFoodType;
                  const style = isPaused
                    ? PAUSE_STYLE
                    : PREF_STYLES[dayPrefCode] || PREF_STYLES.VEG;
                  const Icon = style.icon;
                  const dayLabel = isPaused
                    ? PAUSE_STYLE.label
                    : getCategoryLabel(
                        dayPrefCode,
                        mealCategories.find((c: any) => c.code === dayPrefCode)
                          ?.name,
                      );

                  return (
                    <button
                      key={index}
                      disabled={isDisabled}
                      onClick={() => handleToggleMeal(dateStr)}
                      className={cn(
                        "flex flex-col items-center justify-center aspect-square p-1 rounded-2xl border-2 transition-all relative select-none",
                        isLockedOut
                          ? "bg-zinc-100 border-zinc-200 opacity-60 cursor-not-allowed grayscale"
                          : cn(
                              style.bg,
                              style.border,
                              "group hover:shadow-md hover:-translate-y-0.5",
                            ),
                      )}
                    >
                      <span
                        className={cn(
                          "text-lg md:text-xl font-extrabold mb-0.5 md:mb-1",
                          isLockedOut ? "text-zinc-400" : style.color,
                        )}
                      >
                        {format(date, "d")}
                      </span>

                      <div
                        className={cn(
                          "flex flex-col items-center justify-center gap-1",
                          isLockedOut ? "text-zinc-400" : style.color,
                        )}
                      >
                        <Icon className="h-6 w-6 md:h-8 md:w-8 drop-shadow-sm transition-transform group-active:scale-95" />
                        <span className="text-[9px] md:text-[11px] font-bold leading-none hidden sm:block">
                          {dayLabel}
                        </span>
                      </div>

                      {!isLockedOut && (
                        <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center">
                          <RefreshCw className="h-5 w-5 text-zinc-600 opacity-50" />
                        </div>
                      )}

                      {isLockedOut && (
                        <div className="absolute top-1 right-1">
                          <AlertCircle className="h-3 w-3 text-zinc-400" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
