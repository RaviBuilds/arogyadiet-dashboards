"use client";

import { useState, useMemo } from "react";
import { format, addDays, startOfDay, parseISO, isBefore } from "date-fns";
import { Save, Loader2, AlertCircle, Utensils, Ban } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { adminBulkUpdateMealPreferences } from "@/actions/admin-actions/adminMealActions";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function AdminMealPlannerClient({
  subscriptionId,
  dailyPrefs,
  mealCategories,
}: any) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Initialize state with current DB values
  const [mealSelections, setMealSelections] = useState<
    Record<string, string | null>
  >(
    dailyPrefs.reduce((acc: any, pref: any) => {
      acc[pref.preference_date] = pref.meal_category_id;
      return acc;
    }, {}),
  );

  // 5 PM Cutoff Logic
  const minEditableDate = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const daysToAdd = currentHour >= 17 ? 2 : 1;
    return startOfDay(addDays(now, daysToAdd));
  }, []);

  const handleMealChange = (date: string, categoryId: string) => {
    setSaveMessage(null);
    setMealSelections((prev) => ({ ...prev, [date]: categoryId }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    const updates: any[] = [];
    dailyPrefs.forEach((pref: any) => {
      const selectedCategory = mealSelections[pref.preference_date];
      if (pref.meal_category_id !== selectedCategory) {
        updates.push({
          date: pref.preference_date,
          categoryId: selectedCategory,
        });
      }
    });

    if (updates.length === 0) {
      setSaveMessage({ type: "success", text: "No changes detected." });
      setIsSaving(false);
      return;
    }

    const result = await adminBulkUpdateMealPreferences(
      subscriptionId,
      updates,
    );

    if (result.success) {
      setSaveMessage({
        type: "success",
        text: "Meal preferences successfully updated!",
      });
      router.refresh();
    } else {
      setSaveMessage({
        type: "error",
        text: "Failed to update meals. Please try again.",
      });
    }
    setIsSaving(false);
  };

  // Check if any selections differ from the original props
  const hasChanges = dailyPrefs.some(
    (pref: any) =>
      mealSelections[pref.preference_date] !== pref.meal_category_id,
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 border rounded-xl shadow-sm sticky top-[60px] z-10">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
            <Utensils className="h-5 w-5 text-primary" /> Manage Meal Selection
          </h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <AlertCircle className="h-3 w-3" /> Changes for tomorrow must be
            made before 5:00 PM today.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="w-full sm:w-auto font-bold transition-all bg-primary hover:bg-primary/90"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> Save Meals
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

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 divide-y">
          {dailyPrefs.map((pref: any) => {
            const date = parseISO(pref.preference_date);
            const isLocked = isBefore(startOfDay(date), minEditableDate);
            const isPaused = pref.is_paused;
            const isDisabled = isLocked || isPaused;

            return (
              <div
                key={pref.id}
                className={cn(
                  "p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors",
                  isPaused ? "bg-zinc-50/50" : "hover:bg-zinc-50/50",
                )}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center h-14 w-14 rounded-xl border-2",
                      isPaused
                        ? "border-dashed border-zinc-300 bg-zinc-100"
                        : isLocked
                          ? "border-zinc-200 bg-zinc-50"
                          : "border-primary/20 bg-primary/5",
                    )}
                  >
                    <span className="text-xs font-bold text-muted-foreground uppercase">
                      {format(date, "MMM")}
                    </span>
                    <span
                      className={cn(
                        "text-lg font-black leading-none",
                        isPaused || isLocked ? "text-zinc-500" : "text-primary",
                      )}
                    >
                      {format(date, "d")}
                    </span>
                  </div>
                  <div>
                    <p className="font-bold text-zinc-900">
                      {format(date, "EEEE")}
                    </p>
                    {isPaused ? (
                      <p className="text-sm font-medium text-amber-600 flex items-center gap-1 mt-0.5">
                        <Ban className="h-3 w-3" /> Delivery Paused
                      </p>
                    ) : isLocked ? (
                      <p className="text-sm font-medium text-zinc-500 flex items-center gap-1 mt-0.5">
                        <AlertCircle className="h-3 w-3" /> Locked (Past 5 PM
                        cut-off)
                      </p>
                    ) : (
                      <p className="text-sm text-green-600 font-medium mt-0.5">
                        Active Delivery
                      </p>
                    )}
                  </div>
                </div>

                <div className="w-full sm:w-64">
                  {isPaused ? (
                    <div className="h-10 w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 flex items-center px-3 text-sm text-zinc-400 font-medium cursor-not-allowed">
                      Paused
                    </div>
                  ) : (
                    <Select
                      disabled={isDisabled}
                      value={mealSelections[pref.preference_date] || ""}
                      onValueChange={(val) =>
                        handleMealChange(pref.preference_date, val)
                      }
                    >
                      <SelectTrigger
                        className={cn(
                          "h-10 font-medium",
                          isLocked && "bg-zinc-50 text-zinc-500",
                        )}
                      >
                        <SelectValue placeholder="Select Meal..." />
                      </SelectTrigger>
                      <SelectContent>
                        {mealCategories.map((cat: any) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
