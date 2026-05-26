"use client";

import { useState, useMemo, useEffect } from "react";
import { format, addDays, startOfDay, parseISO, isBefore } from "date-fns";
import { Save, Loader2, AlertCircle, CalendarCheck } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { cn } from "@/lib/utils";
import { adminBulkUpdatePausePreferences } from "@/actions/admin-actions/adminMealActions";
import { useRouter } from "next/navigation";

// --- SVGS ---
const SkipSvg = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="42" fill="#FAFAFA" stroke="#D4D4D8" strokeWidth="5" strokeDasharray="10 8" />
    <path d="M 35 35 L 65 65 M 65 35 L 35 65" stroke="#A1A1AA" strokeWidth="8" strokeLinecap="round" />
  </svg>
);
const ActiveSvg = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="42" fill="#E8F5E9" stroke="#81C784" strokeWidth="3" />
    <path d="M 30 50 L 45 65 L 70 35" stroke="#4CAF50" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function AdminPauseClient({ subscriptionId, scheduleDays, initialPausedDates, maxPauses, initialPausesUsed }: any) {
  const router = useRouter();
  const [pausedDates, setPausedDates] = useState<string[]>(initialPausedDates);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string; } | null>(null);

  useEffect(() => {
    const syncTimer = window.setTimeout(() => {
      setPausedDates(initialPausedDates);
    }, 0);
    return () => window.clearTimeout(syncTimer);
  }, [initialPausedDates, initialPausesUsed]);

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

  const newlyPaused = pausedDates.filter((d) => !initialPausedDates.includes(d)).length;
  const newlyUnpaused = initialPausedDates.filter((d: string) => !pausedDates.includes(d)).length;
  const netPauseChange = newlyPaused - newlyUnpaused;
  const currentPausesUsed = initialPausesUsed + netPauseChange;
  const isLimitReached = currentPausesUsed >= maxPauses;

  const handleTogglePause = (dateStr: string) => {
    setSaveMessage(null);
    setPausedDates((prev) => {
      if (prev.includes(dateStr)) return prev.filter((d) => d !== dateStr);
      if (isLimitReached) return prev;
      return [...prev, dateStr];
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    const updates: any[] = [];
    scheduleDays.forEach((dateStr: string) => {
      const wasPaused = initialPausedDates.includes(dateStr);
      const isNowPaused = pausedDates.includes(dateStr);
      if (wasPaused !== isNowPaused) {
        updates.push({ date: dateStr, isPaused: isNowPaused });
      }
    });

    if (updates.length === 0) {
      setSaveMessage({ type: "success", text: "No changes detected." });
      setIsSaving(false);
      return;
    }

    const result = await adminBulkUpdatePausePreferences(subscriptionId, updates);

    if (result.success) {
      setSaveMessage({ type: "success", text: "Pause schedule successfully updated!" });
      router.refresh();
    } else {
      setSaveMessage({ type: "error", text: "Failed to update pauses. Please try again." });
    }
    setIsSaving(false);
  };

  const hasChanges = netPauseChange !== 0 || newlyPaused > 0 || newlyUnpaused > 0;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 border rounded-xl shadow-sm sticky top-[60px] z-10">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">Manage Pause Credits (Admin)</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <AlertCircle className="h-3 w-3" /> Changes for tomorrow must be made before 5:00 PM today.
          </p>
        </div>
        <Button onClick={handleSave} disabled={!hasChanges || isSaving} className="w-full sm:w-auto font-bold transition-all bg-blue-600 hover:bg-blue-700">
          {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><Save className="mr-2 h-4 w-4" /> Save Schedule</>}
        </Button>
      </div>

      {saveMessage && (
        <Alert className={saveMessage.type === "success" ? "bg-green-50 border-green-200 text-green-900" : "bg-red-50 border-red-200 text-red-900"}>
          <AlertDescription className="font-medium">{saveMessage.text}</AlertDescription>
        </Alert>
      )}

      <div className={cn("border rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors", isLimitReached ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200")}>
        <div className="flex items-center gap-3">
          {isLimitReached ? <AlertCircle className="h-6 w-6 text-amber-600" /> : <CalendarCheck className="h-6 w-6 text-blue-600" />}
          <div>
            <p className={cn("text-sm font-semibold", isLimitReached ? "text-amber-900" : "text-blue-900")}>Pause Credit Usage</p>
            <p className={cn("text-xs", isLimitReached ? "text-amber-700" : "text-blue-700")}>
              Used <strong>{currentPausesUsed}</strong> of <strong>{maxPauses}</strong> credits. {isLimitReached && " (Limit Reached)"}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-12 pb-20">
        {Object.entries(calendarMonths).map(([monthName, daysInMonth]) => {
          const firstDayOffset = daysInMonth[0].getDay();
          return (
            <div key={monthName} className="bg-white rounded-2xl border p-4 md:p-8 shadow-sm">
              <h3 className="text-xl font-bold text-center mb-6 text-zinc-800">{monthName}</h3>
              <div className="grid gap-2 md:gap-4 text-center mb-2" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                {WEEKDAYS.map((day) => <div key={day} className="text-xs md:text-sm font-bold text-zinc-400 uppercase tracking-wider">{day}</div>)}
              </div>
              <div className="grid gap-2 md:gap-4" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`empty-${i}`} className="aspect-square" />)}
                {daysInMonth.map((date, index) => {
                  const dateStr = format(date, "yyyy-MM-dd");
                  const isPaused = pausedDates.includes(dateStr);
                  const isLockedOut = isBefore(startOfDay(date), minEditableDate);
                  const isDisabled = isLockedOut || (!isPaused && isLimitReached);

                  return (
                    <button key={index} disabled={isDisabled} onClick={() => handleTogglePause(dateStr)}
                      className={cn("flex flex-col items-center justify-center aspect-square p-1 rounded-2xl border-2 transition-all relative select-none", isPaused ? "bg-zinc-50 border-zinc-300 border-dashed" : "bg-green-50/30 border-green-200", !isDisabled && !isPaused && "group hover:shadow-md hover:border-green-400 hover:-translate-y-0.5", isDisabled && "opacity-50 cursor-not-allowed grayscale")}
                    >
                      <span className={cn("text-lg md:text-xl font-extrabold mb-0.5 md:mb-1", isPaused || isDisabled ? "text-zinc-400" : "text-green-700")}>{format(date, "d")}</span>
                      <div className="flex flex-col items-center justify-center gap-1">
                        {isPaused ? <SkipSvg className="h-6 w-6 md:h-8 md:w-8" /> : <ActiveSvg className={cn("h-6 w-6 md:h-8 md:w-8", !isDisabled && "drop-shadow-sm")} />}
                      </div>
                      {isLockedOut && <div className="absolute top-1 right-1"><AlertCircle className="h-3 w-3 text-zinc-400" /></div>}
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