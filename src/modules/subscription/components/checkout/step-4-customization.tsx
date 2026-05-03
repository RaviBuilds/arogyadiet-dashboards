"use client";

import { useMemo } from "react";
import { format, addDays } from "date-fns";
import { ChevronLeft, Info, RefreshCw } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";

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

const CYCLE_ORDER = ["Veg", "Non-Veg", "Egg", "Mixed"];

// Map preferences to their specific UI styles and our new SVGs
const PREF_STYLES: Record<string, any> = {
  Veg: {
    icon: VegSvg,
    color: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200 hover:border-green-400",
    label: "Veg",
  },
  "Non-Veg": {
    icon: MeatSvg,
    color: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200 hover:border-red-400",
    label: "Non-Veg",
  },
  Egg: {
    icon: EggSvg,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200 hover:border-amber-400",
    label: "Egg",
  },
  Mixed: {
    icon: MixedSvg,
    color: "text-purple-700",
    bg: "bg-purple-50",
    border: "border-purple-200 hover:border-purple-400",
    label: "Mixed",
  },
};


const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function MealCustomization({
  data,
  setData,
  plans,
  onNext,
  onBack,
}: any) {
  const selectedPlan = plans?.find((p: any) => p.id === data.planId);
  const baseDuration = selectedPlan?.duration_days || 30;


    //Generate the exact dayscalender
    const totalDaysGenerate = baseDuration + (data.pausedDates?.length || 0)

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

  const handleToggleMeal = (dateString: string) => {
    if (data.pausedDates?.includes(dateString)) return;
    setData((prev: any) => {
      const currentPref = prev.mealOverrides?.[dateString] || prev.foodType;
      const currentIndex = CYCLE_ORDER.indexOf(currentPref);
      const nextPref = CYCLE_ORDER[(currentIndex + 1) % CYCLE_ORDER.length];
      const newOverrides = { ...(prev.mealOverrides || {}) };

      if (nextPref === prev.foodType) {
        delete newOverrides[dateString];
      } else {
        newOverrides[dateString] = nextPref;
      }

      return { ...prev, mealOverrides: newOverrides };
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
            4
          </span>
          Meal Planner
        </h2>
        <p className="text-muted-foreground ml-10">
          Your base plan is set to{" "}
          <strong className="text-foreground">{data.foodType}</strong>. Click on
          any active date to change its meal type!
        </p>
      </div>

      <div className="ml-0 md:ml-10 space-y-8">
        <div className="flex flex-wrap items-center gap-2 md:gap-4 p-3 bg-zinc-50 rounded-lg border text-sm w-fit mx-auto md:mx-0">
          <span className="text-muted-foreground font-medium mr-2 flex items-center gap-1 hidden sm:flex">
            <RefreshCw className="h-4 w-4" /> Cycle:
          </span>
          {CYCLE_ORDER.map((pref) => {
            const Icon = PREF_STYLES[pref].icon;
            return (
              <div
                key={pref}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md",
                  PREF_STYLES[pref].bg,
                  PREF_STYLES[pref].color,
                )}
              >
                <Icon className="h-5 w-5 drop-shadow-sm" />
                <span className="font-bold text-xs md:text-sm">
                  {PREF_STYLES[pref].label}
                </span>
              </div>
            );
          })}
        </div>

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

                    const dayPrefId =
                      data.mealOverrides?.[dateStr] || data.foodType;
                    const style = PREF_STYLES[dayPrefId] || PREF_STYLES["Veg"];
                    const Icon = style.icon;

                    return (
                      <button
                        key={index}
                        disabled={isPaused} // DISABLE BUTTON IF PAUSED!
                        onClick={() => handleToggleMeal(dateStr)}
                        className={cn(
                          "flex flex-col items-center justify-center aspect-square p-1 rounded-2xl border-2 transition-all relative select-none",
                          isPaused
                            ? "bg-zinc-50 border-zinc-200 border-dashed opacity-60 cursor-not-allowed" // Paused styling
                            : cn(
                                style.bg,
                                style.border,
                                "group hover:shadow-md hover:-translate-y-0.5",
                              ), // Active styling
                        )}
                      >
                        <span
                          className={cn(
                            "text-lg md:text-xl font-extrabold mb-0.5 md:mb-1",
                            isPaused ? "text-zinc-400" : style.color,
                          )}
                        >
                          {format(date, "d")}
                        </span>

                        <div
                          className={cn(
                            "flex flex-col items-center justify-center gap-1",
                            isPaused ? "text-zinc-400" : style.color,
                          )}
                        >
                          {isPaused ? (
                            <SkipSvg className="h-6 w-6 md:h-8 md:w-8 opacity-50" />
                          ) : (
                            <>
                              <Icon className="h-6 w-6 md:h-8 md:w-8 drop-shadow-sm transition-transform group-active:scale-95" />
                              <span className="text-[9px] md:text-[11px] font-bold leading-none hidden sm:block">
                                {style.label}
                              </span>
                            </>
                          )}
                        </div>

                        {!isPaused && (
                          <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center">
                            <RefreshCw className="h-5 w-5 text-zinc-600 opacity-50" />
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

      <div className="pt-8 border-t flex justify-between items-center md:ml-10">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ChevronLeft className="h-4 w-4" /> Back to Pauses
        </Button>
        <Button
          size="lg"
          onClick={onNext}
          className="bg-primary hover:bg-primary/90 px-10 text-white font-bold shadow-md"
        >
          Review & Pay
        </Button>
      </div>
    </div>
  );
}
