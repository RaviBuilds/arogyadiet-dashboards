"use client";

// src/shared/components/customer/health-logs/HealthLogForm.tsx
//
// Client form for the My Health Logs page. Lets an accommodation customer
// log daily water intake and physical activity, upserted per day per stay.
//
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Loader2, Droplets, Footprints, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  customerHealthLogSchema,
  type CustomerHealthLogInput,
} from "@/validations/accommodationSchema";
import { submitCustomerHealthLogAction } from "@/actions/healthLogActions";
import type { CustomerHealthLog } from "@/types/accommodation";

type DurationUnit = "minutes" | "hours";

interface HealthLogFormProps {
  /** Whether the customer currently has an ACTIVE stay (Req 9.6). */
  hasActiveStay: boolean;
  /** Today's date in IST (YYYY-MM-DD), used to detect create vs update. */
  todayIST: string;
  /** Previously entered logs for the active stay, in any order. */
  initialLogs: CustomerHealthLog[];
}

/** Form-level shape before duration-unit conversion to minutes. */
type FormValues = {
  waterIntakeLiters: number | undefined;
  activityName: string | undefined;
  activityDuration: number | undefined;
  durationUnit: DurationUnit;
};

export function HealthLogForm({
  hasActiveStay,
  todayIST,
  initialLogs,
}: HealthLogFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [logs, setLogs] = useState<CustomerHealthLog[]>(initialLogs);

  const todaysLog = useMemo(
    () => logs.find((log) => log.logDate === todayIST) ?? null,
    [logs, todayIST]
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      waterIntakeLiters: todaysLog?.waterIntakeLiters ?? undefined,
      activityName: todaysLog?.activityName ?? undefined,
      activityDuration: todaysLog?.activityDurationMinutes ?? undefined,
      durationUnit: "minutes",
    },
  });

  /** Maps a schema/server field name to the corresponding RHF form field. */
  function toFormField(field: string): keyof FormValues | null {
    if (field === "waterIntakeLiters") return "waterIntakeLiters";
    if (field === "activityName") return "activityName";
    if (field === "activityDurationMinutes") return "activityDuration";
    return null;
  }

  const durationUnit = watch("durationUnit");

  const sortedLogs = useMemo(
    () =>
      [...logs].sort((a, b) => (a.logDate < b.logDate ? 1 : a.logDate > b.logDate ? -1 : 0)),
    [logs]
  );

  async function onSubmit(values: FormValues) {
    setServerError(null);
    clearErrors();

    // Convert hours -> minutes before validation/submission — the schema
    // and the database always store activity duration in minutes.
    const activityDurationMinutes =
      values.activityDuration === undefined || values.activityDuration === null
        ? undefined
        : values.durationUnit === "hours"
        ? Math.round(values.activityDuration * 60)
        : values.activityDuration;

    const payload: CustomerHealthLogInput = {
      waterIntakeLiters: values.waterIntakeLiters as number,
      activityName: values.activityName || undefined,
      activityDurationMinutes,
    };

    const parsed = customerHealthLogSchema.safeParse(payload);
    if (!parsed.success) {
      // [Req 9.4] Show inline errors on the offending fields and preserve
      // entered data — RHF keeps field values as-is since we don't reset().
      for (const issue of parsed.error.issues) {
        const formField = toFormField(issue.path.join("."));
        if (formField) {
          setError(formField, { type: "validation", message: issue.message });
        }
      }
      const firstIssue = parsed.error.issues[0];
      setServerError(firstIssue?.message ?? "Please check the entered values.");
      return;
    }

    setSubmitting(true);
    const wasUpdate = !!todaysLog;

    const result = await submitCustomerHealthLogAction(parsed.data);

    if (!("error" in result)) {
      // Optimistically update the local logs list so the list view and the
      // "update vs create" detection reflect the just-saved entry.
      setLogs((prev) => {
        const withoutToday = prev.filter((log) => log.logDate !== todayIST);
        return [
          ...withoutToday,
          {
            id: todaysLog?.id ?? `${todayIST}-optimistic`,
            stayEntryId: todaysLog?.stayEntryId ?? "",
            logDate: todayIST,
            waterIntakeLiters: parsed.data.waterIntakeLiters,
            activityName: parsed.data.activityName ?? null,
            activityDurationMinutes: parsed.data.activityDurationMinutes ?? null,
            createdAt: todaysLog?.createdAt ?? new Date().toISOString(),
          },
        ];
      });

      toast.success(
        wasUpdate
          ? "Today's health log was updated."
          : "Health log saved for today."
      );
    } else {
      setServerError(result.error);
      toast.error(result.error);
      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          const formField = toFormField(field);
          if (formField) {
            setError(formField, { type: "server", message });
          }
        }
      }
    }

    setSubmitting(false);
  }

  if (!hasActiveStay) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <Droplets className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">
            Logging available during active stays only.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Log today&apos;s health data</CardTitle>
          <CardDescription>
            {todaysLog
              ? "You already logged today — submitting will update your entry."
              : "Track your water intake and physical activity for today."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="waterIntakeLiters">Water intake (liters)</Label>
              <Input
                id="waterIntakeLiters"
                type="number"
                step="0.1"
                min={0.1}
                max={15.0}
                placeholder="e.g. 2.5"
                className="min-h-11"
                {...register("waterIntakeLiters", {
                  setValueAs: (v: string) => (v === "" ? undefined : parseFloat(v)),
                })}
              />
              {errors.waterIntakeLiters && (
                <p className="text-xs text-destructive">
                  {errors.waterIntakeLiters.message as string}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="activityName">Physical activity name</Label>
              <Input
                id="activityName"
                type="text"
                maxLength={100}
                placeholder="e.g. Walking, Yoga"
                className="min-h-11"
                {...register("activityName", {
                  setValueAs: (v: string) => (v === "" ? undefined : v),
                })}
              />
              {errors.activityName && (
                <p className="text-xs text-destructive">
                  {errors.activityName.message as string}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="activityDuration">Activity duration</Label>
              <div className="flex gap-2">
                <Input
                  id="activityDuration"
                  type="number"
                  min={1}
                  className="min-h-11 flex-1"
                  placeholder="e.g. 30"
                  {...register("activityDuration", {
                    setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
                  })}
                />
                <Select
                  value={durationUnit}
                  onValueChange={(value: DurationUnit) => setValue("durationUnit", value)}
                >
                  <SelectTrigger className="min-h-11 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {errors.activityDuration && (
                <p className="text-xs text-destructive">
                  {errors.activityDuration.message as string}
                </p>
              )}
            </div>

            {serverError && (
              <p className="text-sm text-destructive">{serverError}</p>
            )}

            <Button type="submit" disabled={submitting} className="min-h-11 w-full sm:w-auto">
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {todaysLog ? "Update log" : "Save log"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Previous entries</CardTitle>
          <CardDescription>
            Your logged entries for this stay, most recent first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No entries logged yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {sortedLogs.map((log) => (
                <li key={log.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <CalendarDays className="size-3.5 text-muted-foreground" />
                    {format(parseISO(log.logDate), "dd MMM yyyy")}
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Droplets className="size-3.5" />
                      {log.waterIntakeLiters} L
                    </span>
                    {log.activityName && (
                      <span className="flex items-center gap-1">
                        <Footprints className="size-3.5" />
                        {log.activityName}
                        {log.activityDurationMinutes
                          ? ` — ${log.activityDurationMinutes} min`
                          : ""}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
