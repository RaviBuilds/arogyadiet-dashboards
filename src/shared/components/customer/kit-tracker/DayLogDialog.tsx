"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UtensilsCrossed, XCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  dailyLogSchema,
  type DailyLogInput,
} from "@/validations/kitTrackerSchema";
import { saveDailyLogAction } from "@/actions/kitTrackerActions";

interface DayLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string;
  logDate: string;
  existingLog: {
    status: string;
    physical_activity_minutes: number | null;
    physical_activity_name: string | null;
    weight_kg: number | null;
  } | null;
  onSaved: (totalSkippedDays: number, trackerEndDate: string) => void;
}

export function DayLogDialog({
  open,
  onOpenChange,
  subscriptionId,
  logDate,
  existingLog,
  onSaved,
}: DayLogDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const defaultStatus =
    (existingLog?.status as "FOOD_TAKEN" | "FOOD_SKIPPED") || "FOOD_TAKEN";

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm({
    resolver: zodResolver(dailyLogSchema),
    defaultValues:
      defaultStatus === "FOOD_TAKEN"
        ? {
            status: "FOOD_TAKEN" as const,
            activityMinutes: existingLog?.physical_activity_minutes ?? undefined,
            activityName: existingLog?.physical_activity_name ?? undefined,
            weightKg: existingLog?.weight_kg ?? undefined,
          }
        : { status: "FOOD_SKIPPED" as const },
  });

  const currentStatus = watch("status");

  function handleStatusChange(newStatus: "FOOD_TAKEN" | "FOOD_SKIPPED") {
    if (newStatus === currentStatus) return;
    setServerError(null);

    if (newStatus === "FOOD_TAKEN") {
      reset({
        status: "FOOD_TAKEN",
        activityMinutes: undefined,
        activityName: undefined,
        weightKg: undefined,
      });
    } else {
      reset({ status: "FOOD_SKIPPED" });
    }
  }

  async function onSubmit(data: Record<string, unknown>) {
    setSubmitting(true);
    setServerError(null);

    const result = await saveDailyLogAction(
      subscriptionId,
      logDate,
      data as DailyLogInput
    );

    if (result.success) {
      onSaved(result.totalSkippedDays, result.trackerEndDate);
      onOpenChange(false);
    } else {
      setServerError(result.error);
    }

    setSubmitting(false);
  }

  // Type-safe error access for discriminated union fields
  const fieldErrors = errors as Record<string, { message?: string } | undefined>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-lg">Log for {logDate}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-6 space-y-5">
          {/* Status toggle buttons */}
          <div className="space-y-2.5">
            <Label className="text-sm font-medium">Status</Label>
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant={currentStatus === "FOOD_TAKEN" ? "default" : "outline"}
                className={
                  currentStatus === "FOOD_TAKEN"
                    ? "h-11 rounded-lg bg-green-600 hover:bg-green-700 text-white shadow-sm"
                    : "h-11 rounded-lg"
                }
                onClick={() => handleStatusChange("FOOD_TAKEN")}
              >
                <UtensilsCrossed className="size-4 mr-2" />
                Food Taken
              </Button>
              <Button
                type="button"
                variant={
                  currentStatus === "FOOD_SKIPPED" ? "default" : "outline"
                }
                className={
                  currentStatus === "FOOD_SKIPPED"
                    ? "h-11 rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                    : "h-11 rounded-lg"
                }
                onClick={() => handleStatusChange("FOOD_SKIPPED")}
              >
                <XCircle className="size-4 mr-2" />
                Food Skipped
              </Button>
            </div>
          </div>

          {/* Optional fields — only mounted when FOOD_TAKEN */}
          {currentStatus === "FOOD_TAKEN" && (
            <div className="space-y-4 pt-1 border-t">
              <p className="text-xs text-muted-foreground pt-3">Optional details</p>

              {/* Physical Activity Minutes */}
              <div className="space-y-1.5">
                <Label htmlFor="activityMinutes" className="text-sm">
                  Activity Minutes
                </Label>
                <Input
                  id="activityMinutes"
                  type="number"
                  placeholder="0–1440"
                  className="h-10 rounded-lg"
                  {...register("activityMinutes", {
                    setValueAs: (v: string) =>
                      v === "" ? undefined : parseInt(v, 10),
                  })}
                />
                {fieldErrors.activityMinutes && (
                  <p className="text-xs text-destructive">
                    {fieldErrors.activityMinutes.message}
                  </p>
                )}
              </div>

              {/* Physical Activity Name */}
              <div className="space-y-1.5">
                <Label htmlFor="activityName" className="text-sm">
                  Activity Name
                </Label>
                <Input
                  id="activityName"
                  type="text"
                  placeholder="e.g. Walking, Yoga"
                  className="h-10 rounded-lg"
                  maxLength={100}
                  {...register("activityName", {
                    setValueAs: (v: string) =>
                      v === "" ? undefined : v,
                  })}
                />
                {fieldErrors.activityName && (
                  <p className="text-xs text-destructive">
                    {fieldErrors.activityName.message}
                  </p>
                )}
              </div>

              {/* Weight Kg */}
              <div className="space-y-1.5">
                <Label htmlFor="weightKg" className="text-sm">
                  Weight (kg)
                </Label>
                <Input
                  id="weightKg"
                  type="number"
                  step="0.01"
                  placeholder="0–500"
                  className="h-10 rounded-lg"
                  {...register("weightKg", {
                    setValueAs: (v: string) =>
                      v === "" ? undefined : parseFloat(v),
                  })}
                />
                {fieldErrors.weightKg && (
                  <p className="text-xs text-destructive">
                    {fieldErrors.weightKg.message}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Server error */}
          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}

          {/* Footer with full-width save button */}
          <div className="pt-2">
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-lg text-base font-semibold shadow-sm"
            >
              {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
