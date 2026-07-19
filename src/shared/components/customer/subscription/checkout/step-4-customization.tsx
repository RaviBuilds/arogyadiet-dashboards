"use client";

import { useMemo } from "react";
import { format, addDays } from "date-fns";
import { AlertCircle, CalendarCheck, RefreshCw, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { OnboardingSummaryBar } from "./onboarding/OnboardingSummaryBar";

// --- CUSTOM REALISTIC SVG ILLUSTRATIONS ---

const VegSvg = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Background drop shadow for depth */}
    <path
      d="M52 97 C 52 97, 12 72, 12 37 C 12 17, 32 7, 52 7 C 72 7, 92 17, 92 37 C 92 72, 52 97, 52 97 Z"
      fill="#1B5E20"
      opacity="0.2"
    />
    {/* Main leaf */}
    <path
      d="M50 95 C 50 95, 10 70, 10 35 C 10 15, 30 5, 50 5 C 70 5, 90 15, 90 35 C 90 70, 50 95, 50 95 Z"
      fill="#4CAF50"
    />
    {/* Inner highlight */}
    <path
      d="M50 5 C 30 5, 10 15, 10 35 C 10 70, 50 95, 50 95 C 50 95, 60 70, 60 35 C 60 15, 50 5, 50 5 Z"
      fill="#81C784"
      opacity="0.3"
    />
    {/* Stem and veins */}
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

      <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#DCECF7" />
        <stop offset="100%" stopColor="#8DA9C4" />
      </linearGradient>
    </defs>

    {/* Bone */}
    <g stroke="#9A3B2D" strokeWidth="1.8" strokeLinejoin="round">
      <path
        d="
          M15 78
          C8 73 6 86 13 91
          C18 95 24 93 27 88
          C27 95 34 98 40 94
          C48 89 46 76 37 77
          C34 70 24 69 21 76
          C18 75 17 76 15 78
          Z
        "
        fill="url(#boneGradient)"
      />

      <path
        d="M32 78 C42 71 49 63 58 53"
        stroke="#E4C177"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </g>

    {/* Ring */}
    <ellipse
      cx="60"
      cy="52"
      rx="5"
      ry="6"
      fill="url(#ringGradient)"
      stroke="#4F5D73"
      strokeWidth="1.5"
    />

    {/* Meat body */}
    <g>
      <path
        d="
          M55 50
          C67 15 98 12 108 38
          C118 65 101 92 72 88
          C48 84 37 67 45 55
          C48 51 51 50 55 50
          Z
        "
        fill="url(#meatGradient)"
        stroke="#34143E"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* bottom shade */}
      <path
        d="
          M50 64
          C66 58 88 61 103 72
          C93 87 70 91 53 80
          C48 76 47 70 50 64
          Z
        "
        fill="#C84C00"
        opacity="0.45"
      />

      {/* large glossy highlight */}
      <path
        d="
          M61 27
          C74 18 90 19 98 29
          C88 40 70 40 58 34
          C57 31 58 29 61 27
          Z
        "
        fill="white"
        opacity="0.72"
      />

      <path
        d="
          M67 24
          C77 20 88 21 94 27
          C88 33 77 33 69 29
          C67 28 66 26 67 24
          Z
        "
        fill="#FFE08A"
        opacity="0.65"
      />

      {/* shine line */}
      <path
        d="M48 46 C57 35 69 31 80 31"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.85"
      />
    </g>

    {/* texture dots */}
    <g fill="none" stroke="#E36A15" strokeWidth="1.2" opacity="0.85">
      <circle cx="63" cy="36" r="1.8" />
      <circle cx="75" cy="33" r="1.6" />
      <circle cx="86" cy="38" r="1.6" />
      <circle cx="58" cy="48" r="1.6" />
      <circle cx="70" cy="47" r="1.6" />
      <circle cx="83" cy="48" r="1.6" />
      <circle cx="94" cy="44" r="1.6" />
      <circle cx="55" cy="60" r="1.6" />
      <circle cx="66" cy="60" r="1.6" />
      <circle cx="79" cy="61" r="1.6" />
      <circle cx="91" cy="60" r="1.6" />
      <circle cx="61" cy="72" r="1.6" />
      <circle cx="74" cy="74" r="1.6" />
      <circle cx="88" cy="72" r="1.6" />
    </g>
  </svg>
);

const EggSvg = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Shadow/Backing for depth */}
    <ellipse cx="50" cy="85" rx="30" ry="8" fill="#BCAAA4" opacity="0.4" />
    {/* Whole egg shape (farm brown/tan style) */}
    <path
      d="M50 8 C 22 8 12 45 12 65 C 12 87 30 92 50 92 C 70 92 88 87 88 65 C 88 45 78 8 50 8 Z"
      fill="#FFE0B2"
    />
    {/* Core shadow gradient effect */}
    <path
      d="M88 65 C 88 87 70 92 50 92 C 70 92 80 80 80 65 C 80 45 75 20 50 8 C 78 8 88 45 88 65 Z"
      fill="#FFCC80"
      opacity="0.6"
    />
    {/* 3D Specular Highlight */}
    <path
      d="M32 28 C 22 40 20 55 22 65"
      stroke="#FFFFFF"
      strokeWidth="5"
      strokeLinecap="round"
      fill="none"
      opacity="0.8"
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
    {/* Bento Box Shadow */}
    <rect
      x="12"
      y="22"
      width="76"
      height="60"
      rx="12"
      fill="#D1C4E9"
      opacity="0.5"
    />
    {/* Box Base */}
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
    {/* Compartment Dividers */}
    <line x1="48" y1="20" x2="48" y2="80" stroke="#AB47BC" strokeWidth="4" />
    <line x1="48" y1="50" x2="86" y2="50" stroke="#AB47BC" strokeWidth="4" />
    {/* Food items representing the mix! */}
    {/* Left Side: Veg (Green) */}
    <rect x="18" y="28" width="22" height="44" rx="6" fill="#81C784" />
    {/* Top Right: Egg/Side (Yellow) */}
    <rect x="56" y="28" width="22" height="14" rx="4" fill="#FFD54F" />
    {/* Bottom Right: Meat/Main (Red) */}
    <rect x="56" y="58" width="22" height="14" rx="4" fill="#FF8A65" />
  </svg>
);

const SkipSvg = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="42" fill="#FAFAFA" stroke="#D4D4D8" strokeWidth="5" strokeDasharray="10 8" />
    <path d="M 35 35 L 65 65 M 65 35 L 35 65" stroke="#A1A1AA" strokeWidth="8" strokeLinecap="round" />
  </svg>);


// --- END ILLUSTRATIONS ---

function getCategoryLabel(code: string, name?: string) {
  if (code === "CHICKEN") return "Non-Veg";
  if (code === "VEG") return "Veg";
  if (code === "EGG") return "Egg";
  return name || code;
}

const CODE_STYLES: Record<string, any> = {
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

export function MealCustomization({
  data,
  setData,
  plans,
  onNext,
  onBack,
  mealCategories,
  holidaysByDate = {},
}: any) {
  const selectedPlan = plans?.find((p: any) => p.id === data.planId);
  const baseDuration = selectedPlan?.duration_days || 30;
  const maxPauses = selectedPlan?.pause_credits || 0;
  const pausesUsed = data.pausedDates?.length || 0;
  const isLimitReached = pausesUsed >= maxPauses;

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
  const cycleOptions = [...sortedCodes, "PAUSE"];

  //Generate the exact dayscalender
  const totalDaysGenerate = baseDuration + (data.pausedDates?.length || 0);

  const scheduleDays = useMemo(() => {
    if (!data.startDate) return [];
    return Array.from({ length: totalDaysGenerate }).map((_, i) =>
      addDays(new Date(data.startDate), i),
    );
  }, [data.startDate, totalDaysGenerate]);

  const calendarMonths = useMemo(() => {
    const months: Record<string, Date[]> = {};
    scheduleDays.forEach((date) => {
      const monthKey = format(date, "MMMM yyyy");
      if (!months[monthKey]) months[monthKey] = [];
      months[monthKey].push(date);
    });
    return months;
  }, [scheduleDays]);

  const endDate =
    scheduleDays.length > 0 ? scheduleDays[scheduleDays.length - 1] : null;

  const baseFoodTypeLabel = getCategoryLabel(
    data.foodType,
    mealCategories.find((c: any) => c.code === data.foodType)?.name,
  );

  const handleToggleMeal = (dateString: string) => {
    setData((prev: any) => {
      const currentState = prev.pausedDates?.includes(dateString)
        ? "PAUSE"
        : prev.mealOverrides?.[dateString] || prev.foodType;

      const currentIndex = cycleOptions.indexOf(currentState);
      const nextPref =
        cycleOptions[(currentIndex + 1) % cycleOptions.length];

      const newPausedDates = [...(prev.pausedDates || [])];
      const newOverrides = { ...(prev.mealOverrides || {}) };

      if (nextPref === "PAUSE") {
        if (!newPausedDates.includes(dateString)) {
          newPausedDates.push(dateString);
        }
        delete newOverrides[dateString];
      } else if (nextPref === prev.foodType) {
        const pauseIndex = newPausedDates.indexOf(dateString);
        if (pauseIndex > -1) newPausedDates.splice(pauseIndex, 1);
        delete newOverrides[dateString];
      } else {
        const pauseIndex = newPausedDates.indexOf(dateString);
        if (pauseIndex > -1) newPausedDates.splice(pauseIndex, 1);
        newOverrides[dateString] = nextPref;
      }

      if (nextPref === "PAUSE" && newPausedDates.length > maxPauses) {
        return prev;
      }

      return {
        ...prev,
        pausedDates: newPausedDates,
        mealOverrides: newOverrides,
      };
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-2.5">
          <IconChip icon={Utensils} tone="green" />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-emerald-700/90">
            Your Meal Planner
          </span>
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          Fine-tune each day
        </h2>
        <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-500">
          Your base plan is set to{" "}
          <strong className="font-semibold text-slate-900">
            {baseFoodTypeLabel}
          </strong>
          . Tap any date to cycle its meal type or pause that day.
        </p>
      </div>

      <div className="space-y-8">
        <div
          className={cn(
            "rounded-3xl border p-5 flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors duration-200",
            isLimitReached
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50/60 border-emerald-100",
          )}
        >
          <div className="flex items-center gap-3">
            {isLimitReached ? (
              <AlertCircle className="h-6 w-6 text-amber-600" />
            ) : (
              <CalendarCheck className="h-6 w-6 text-emerald-600" />
            )}
            <div>
              <p
                className={cn(
                  "text-sm font-semibold",
                  isLimitReached ? "text-amber-900" : "text-emerald-900",
                )}
              >
                Your {baseDuration}-Meal Plan
              </p>
              <p
                className={cn(
                  "text-xs",
                  isLimitReached ? "text-amber-700" : "text-emerald-700",
                )}
              >
                You have used <strong>{pausesUsed}</strong> of{" "}
                <strong>{maxPauses}</strong> pause credits.
                {isLimitReached && " (Limit Reached)"}
              </p>
            </div>
          </div>
          <div className="text-center sm:text-right">
            <p
              className={cn(
                "text-xs font-medium",
                isLimitReached ? "text-amber-700" : "text-emerald-700",
              )}
            >
              New End Date
            </p>
            <p
              className={cn(
                "text-lg font-extrabold",
                isLimitReached ? "text-amber-900" : "text-emerald-900",
              )}
            >
              {endDate ? format(endDate, "MMMM do, yyyy") : "..."}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-3xl border border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <RefreshCw className="h-3.5 w-3.5" /> Tap to cycle
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {cycleOptions.map((option) => {
              if (option === "PAUSE") {
                const Icon = PAUSE_STYLE.icon;
                return (
                  <div
                    key="PAUSE"
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border bg-white px-3 py-1.5",
                      PAUSE_STYLE.color,
                      "border-zinc-200",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs font-semibold sm:text-sm">
                      {PAUSE_STYLE.label}
                    </span>
                  </div>
                );
              }

              const category = mealCategories.find(
                (c: any) => c.code === option,
              );
              const style = CODE_STYLES[option] || CODE_STYLES.VEG;
              const Icon = style.icon;
              const label = getCategoryLabel(option, category?.name);
              const isBasePreference = option === data.foodType;

              return (
                <div
                  key={option}
                  className={cn(
                    "flex items-center gap-2 rounded-full border bg-white px-3.5 py-1.5",
                    style.color,
                    style.border.split(" ")[0],
                    isBasePreference && "ring-1 ring-inset ring-current/20",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-semibold sm:text-sm">{label}</span>
                  {isBasePreference && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-current opacity-30" />
                      <span className="text-[0.6rem] font-semibold uppercase tracking-wider opacity-70">
                        Base
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white shadow-sm">
          {Object.entries(calendarMonths).map(
            ([monthName, daysInMonth], monthIndex) => {
              const firstDayOffset = daysInMonth[0].getDay();

              return (
                <div key={monthName}>
                  {monthIndex > 0 && (
                    <div
                      aria-hidden="true"
                      className="mx-5 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent sm:mx-6"
                    />
                  )}
                  <div className="p-5 sm:p-6">
                    <h3 className="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-400">
                      {monthName}
                    </h3>
                    <div
                      className="grid gap-1.5 text-center mb-2 sm:gap-2.5"
                      style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
                    >
                      {WEEKDAYS.map((day) => (
                        <div
                          key={day}
                          className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400"
                        >
                          {day}
                        </div>
                      ))}
                    </div>
                    <div
                      className="grid gap-1.5 sm:gap-2.5"
                      style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
                    >
                      {Array.from({ length: firstDayOffset }).map((_, i) => (
                        <div key={`empty-${i}`} className="aspect-square" />
                      ))}

                      {daysInMonth.map((date, index) => {
                        const dateStr = format(date, "yyyy-MM-dd");
                        const isPaused = data.pausedDates?.includes(dateStr);
                        const isFirstDay =
                          scheduleDays.length > 0 &&
                          dateStr === format(scheduleDays[0], "yyyy-MM-dd");

                        const dayPrefCode =
                          data.mealOverrides?.[dateStr] || data.foodType;
                        // A day only "stands out" once the customer has
                        // actually changed it from the base plan — the
                        // default schedule (every day = base preference)
                        // stays visually quiet so 22 identical cells don't
                        // compete for attention. This is the fix for the
                        // calendar reading as pure noise.
                        const isModified =
                          isPaused || Boolean(data.mealOverrides?.[dateStr]);
                        const style = isPaused
                          ? PAUSE_STYLE
                          : CODE_STYLES[dayPrefCode] || CODE_STYLES.VEG;
                        const Icon = style.icon;
                        const dayLabel = isPaused
                          ? PAUSE_STYLE.label
                          : getCategoryLabel(
                              dayPrefCode,
                              mealCategories.find(
                                (c: any) => c.code === dayPrefCode,
                              )?.name,
                            );

                        return (
                          <button
                            key={index}
                            onClick={() => handleToggleMeal(dateStr)}
                            className={cn(
                              "group relative flex aspect-square select-none flex-col items-center justify-center rounded-2xl border p-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                              isModified ? style.bg : "bg-white",
                              isModified
                                ? style.border
                                : "border-slate-100 hover:border-slate-200",
                            )}
                          >
                            {isFirstDay && (
                              <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-white shadow-sm">
                                Start
                              </span>
                            )}

                            {holidaysByDate[dateStr] && (
                              <span className="text-[9px] md:text-[10px] font-bold leading-tight text-center line-clamp-2 max-w-full px-0.5 mb-0.5 text-zinc-700">
                                {holidaysByDate[dateStr]}
                              </span>
                            )}
                            <span
                              className={cn(
                                "text-base font-bold sm:text-lg",
                                isModified ? style.color : "text-slate-700",
                              )}
                            >
                              {format(date, "d")}
                            </span>

                            <div
                              className={cn(
                                "flex flex-col items-center justify-center gap-0.5",
                                isModified ? style.color : "text-slate-400",
                              )}
                            >
                              <Icon
                                className={cn(
                                  "drop-shadow-sm transition-transform group-active:scale-95",
                                  isModified
                                    ? "h-5 w-5 sm:h-6 sm:w-6"
                                    : "h-4 w-4 sm:h-5 sm:w-5 opacity-60",
                                )}
                              />
                              {isModified && (
                                <span className="hidden text-[9px] font-bold leading-none sm:block sm:text-[10px]">
                                  {dayLabel}
                                </span>
                              )}
                            </div>

                            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/5 opacity-0 transition-opacity group-hover:opacity-100">
                              <RefreshCw className="h-4 w-4 text-zinc-600 opacity-30" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            },
          )}
        </div>
      </div>

      <OnboardingSummaryBar
        items={[
          { label: "Base Preference", value: baseFoodTypeLabel },
          { label: "Pause Credits", value: `${pausesUsed} / ${maxPauses} used` },
          endDate
            ? { label: "New End Date", value: format(endDate, "MMM d, yyyy") }
            : null,
        ].filter((item): item is NonNullable<typeof item> => item !== null)}
        continueLabel="Review and Pay"
        disabled={!data.startDate || !data.addressId}
        onContinue={onNext}
        backLabel="Back to Plans"
        onBack={onBack}
      />
    </div>
  );
}
