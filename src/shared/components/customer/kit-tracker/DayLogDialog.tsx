"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Loader2,
  UtensilsCrossed,
  XCircle,
  Droplets,
  Footprints,
  Leaf,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

  // If the customer already filled in any of the "more details" fields on a
  // previous save, keep the section expanded so their data stays visible.
  const hasExistingDetails = Boolean(
    existingLog?.fat_consumption ||
      existingLog?.water_intake_liters != null ||
      existingLog?.buttermilk_intake ||
      existingLog?.soup_name_qty ||
      existingLog?.protein_curry ||
      existingLog?.main_dish ||
      existingLog?.veg_curry ||
      existingLog?.eggs_count != null ||
      existingLog?.salads_qty ||
      existingLog?.step_count != null
  );

  // Only Weight + Activity are shown by default — everything else (hydration,
  // food breakdown) is optional detail tucked behind this toggle so logging
  // a day doesn't require filling out 10+ fields every time.
  const [showMoreDetails, setShowMoreDetails] = useState(hasExistingDetails);

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
            fatConsumption: existingLog?.fat_consumption ?? undefined,
            waterIntakeLiters: existingLog?.water_intake_liters ?? undefined,
            buttermilkIntake: existingLog?.buttermilk_intake ?? undefined,
            soupNameQty: existingLog?.soup_name_qty ?? undefined,
            proteinCurry: existingLog?.protein_curry ?? undefined,
            mainDish: existingLog?.main_dish ?? undefined,
            vegCurry: existingLog?.veg_curry ?? undefined,
            eggsCount: existingLog?.eggs_count ?? undefined,
            saladsQty: existingLog?.salads_qty ?? undefined,
            stepCount: existingLog?.step_count ?? undefined,
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
        fatConsumption: undefined,
        waterIntakeLiters: undefined,
        buttermilkIntake: undefined,
        soupNameQty: undefined,
        proteinCurry: undefined,
        mainDish: undefined,
        vegCurry: undefined,
        eggsCount: undefined,
        saladsQty: undefined,
        stepCount: undefined,
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

  const fieldErrors = errors as Record<string, { message?: string } | undefined>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold">
            Log for {logDate}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col max-h-[calc(90vh-80px)]"
        >
        <div className="px-5 pb-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Status toggle */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Status</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={currentStatus === "FOOD_TAKEN" ? "default" : "outline"}
                className={
                  currentStatus === "FOOD_TAKEN"
                    ? "h-10 rounded-lg bg-green-600 hover:bg-green-700 text-white shadow-sm text-sm"
                    : "h-10 rounded-lg text-sm"
                }
                onClick={() => handleStatusChange("FOOD_TAKEN")}
              >
                <UtensilsCrossed className="size-4 mr-1.5" />
                Food Taken
              </Button>
              <Button
                type="button"
                variant={
                  currentStatus === "FOOD_SKIPPED" ? "default" : "outline"
                }
                className={
                  currentStatus === "FOOD_SKIPPED"
                    ? "h-10 rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm text-sm"
                    : "h-10 rounded-lg text-sm"
                }
                onClick={() => handleStatusChange("FOOD_SKIPPED")}
              >
                <XCircle className="size-4 mr-1.5" />
                Food Skipped
              </Button>
            </div>
          </div>

          {/* Essential fields — only for FOOD_TAKEN. Kept to the two things
              worth filling in every single day; everything else lives behind
              "Add more details" below so logging stays quick. */}
          {currentStatus === "FOOD_TAKEN" && (
            <div className="space-y-4 pt-2">
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-3">
                <h4 className="text-xs font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Footprints className="size-3.5" />
                  Body & Activity
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="weightKg" className="text-xs text-slate-600">
                      Weight (kg)
                    </Label>
                    <Input
                      id="weightKg"
                      type="number"
                      step="0.01"
                      placeholder="65.5"
                      className="h-9 rounded-lg text-sm"
                      {...register("weightKg", {
                        setValueAs: (v: string) =>
                          v === "" ? undefined : parseFloat(v),
                      })}
                    />
                    {fieldErrors.weightKg && (
                      <p className="text-[10px] text-destructive">
                        {fieldErrors.weightKg.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="activityMinutes" className="text-xs text-slate-600">
                      Activity (min)
                    </Label>
                    <Input
                      id="activityMinutes"
                      type="number"
                      placeholder="40"
                      className="h-9 rounded-lg text-sm"
                      {...register("activityMinutes", {
                        setValueAs: (v: string) =>
                          v === "" ? undefined : parseInt(v, 10),
                      })}
                    />
                    {fieldErrors.activityMinutes && (
                      <p className="text-[10px] text-destructive">
                        {fieldErrors.activityMinutes.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Toggle for the optional detail fields */}
              <button
                type="button"
                onClick={() => setShowMoreDetails((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                <span>Add more details (optional)</span>
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    showMoreDetails && "rotate-180",
                  )}
                />
              </button>

              {showMoreDetails && (
                <div className="space-y-4">
                  {/* Section: Activity name + steps */}
                  <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="stepCount" className="text-xs text-slate-600">
                          Step Count
                        </Label>
                        <Input
                          id="stepCount"
                          type="number"
                          placeholder="5000"
                          className="h-9 rounded-lg text-sm"
                          {...register("stepCount", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : parseInt(v, 10),
                          })}
                        />
                        {fieldErrors.stepCount && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.stepCount.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="activityName" className="text-xs text-slate-600">
                          Activity Name
                        </Label>
                        <Input
                          id="activityName"
                          type="text"
                          placeholder="Walking, Yoga"
                          className="h-9 rounded-lg text-sm"
                          maxLength={100}
                          {...register("activityName", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : v,
                          })}
                        />
                        {fieldErrors.activityName && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.activityName.message}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Section: Hydration */}
                  <div className="rounded-xl border border-cyan-100 bg-cyan-50/40 p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-cyan-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Droplets className="size-3.5" />
                      Hydration
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="waterIntakeLiters" className="text-xs text-slate-600">
                          Water (liters)
                        </Label>
                        <Input
                          id="waterIntakeLiters"
                          type="number"
                          step="0.1"
                          placeholder="3.0"
                          className="h-9 rounded-lg text-sm"
                          {...register("waterIntakeLiters", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : parseFloat(v),
                          })}
                        />
                        {fieldErrors.waterIntakeLiters && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.waterIntakeLiters.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="buttermilkIntake" className="text-xs text-slate-600">
                          Buttermilk
                        </Label>
                        <Input
                          id="buttermilkIntake"
                          type="text"
                          placeholder="1 glass"
                          className="h-9 rounded-lg text-sm"
                          maxLength={200}
                          {...register("buttermilkIntake", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : v,
                          })}
                        />
                        {fieldErrors.buttermilkIntake && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.buttermilkIntake.message}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Section: Food Intake */}
                  <div className="rounded-xl border border-green-100 bg-green-50/40 p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-green-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Leaf className="size-3.5" />
                      Food Intake
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="fatConsumption" className="text-xs text-slate-600">
                          Fat Consumption
                        </Label>
                        <Input
                          id="fatConsumption"
                          type="text"
                          placeholder="2 tbsp oil"
                          className="h-9 rounded-lg text-sm"
                          maxLength={200}
                          {...register("fatConsumption", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : v,
                          })}
                        />
                        {fieldErrors.fatConsumption && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.fatConsumption.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="mainDish" className="text-xs text-slate-600">
                          Main Dish
                        </Label>
                        <Input
                          id="mainDish"
                          type="text"
                          placeholder="Rice, Roti"
                          className="h-9 rounded-lg text-sm"
                          maxLength={200}
                          {...register("mainDish", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : v,
                          })}
                        />
                        {fieldErrors.mainDish && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.mainDish.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="proteinCurry" className="text-xs text-slate-600">
                          Protein Curry
                        </Label>
                        <Input
                          id="proteinCurry"
                          type="text"
                          placeholder="Dal, Chicken"
                          className="h-9 rounded-lg text-sm"
                          maxLength={200}
                          {...register("proteinCurry", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : v,
                          })}
                        />
                        {fieldErrors.proteinCurry && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.proteinCurry.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="vegCurry" className="text-xs text-slate-600">
                          Veg Curry
                        </Label>
                        <Input
                          id="vegCurry"
                          type="text"
                          placeholder="Palak, Bhindi"
                          className="h-9 rounded-lg text-sm"
                          maxLength={200}
                          {...register("vegCurry", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : v,
                          })}
                        />
                        {fieldErrors.vegCurry && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.vegCurry.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="soupNameQty" className="text-xs text-slate-600">
                          Soup & Qty
                        </Label>
                        <Input
                          id="soupNameQty"
                          type="text"
                          placeholder="Tomato, 1 bowl"
                          className="h-9 rounded-lg text-sm"
                          maxLength={200}
                          {...register("soupNameQty", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : v,
                          })}
                        />
                        {fieldErrors.soupNameQty && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.soupNameQty.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="eggsCount" className="text-xs text-slate-600">
                          No. of Eggs
                        </Label>
                        <Input
                          id="eggsCount"
                          type="number"
                          placeholder="2"
                          className="h-9 rounded-lg text-sm"
                          {...register("eggsCount", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : parseInt(v, 10),
                          })}
                        />
                        {fieldErrors.eggsCount && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.eggsCount.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label htmlFor="saladsQty" className="text-xs text-slate-600">
                          Salads Quantity
                        </Label>
                        <Input
                          id="saladsQty"
                          type="text"
                          placeholder="1 bowl mixed salad"
                          className="h-9 rounded-lg text-sm"
                          maxLength={200}
                          {...register("saladsQty", {
                            setValueAs: (v: string) =>
                              v === "" ? undefined : v,
                          })}
                        />
                        {fieldErrors.saladsQty && (
                          <p className="text-[10px] text-destructive">
                            {fieldErrors.saladsQty.message}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Server error */}
          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}
        </div>

          {/* Save button — sits in its own footer outside the scroll area so
              content can never scroll underneath/behind it. */}
          <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-3">
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-10 rounded-lg text-sm font-semibold shadow-sm"
            >
              {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
              Save Log
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
