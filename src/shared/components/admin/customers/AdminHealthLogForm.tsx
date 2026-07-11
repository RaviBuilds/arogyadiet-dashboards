"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, HeartPulse, Activity } from "lucide-react";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import {
  adminHealthLogSchema,
} from "@/validations/accommodationSchema";
import {
  submitAdminHealthLogAction,
  getCustomerHealthLogsAction,
  getAdminHealthLogsAction,
} from "@/actions/healthLogActions";
import type { CustomerHealthLogRow, AdminHealthLogRow } from "@/repositories/healthLogRepository";
import type { z } from "zod";

/**
 * The schema's numeric fields use `z.coerce.number()`, whose *input* type is
 * `unknown`/`string` while the *output* type (post-parse) is `number`.
 * react-hook-form + zodResolver need both: TFieldValues (what the raw form
 * state holds, matching the input Field props render) and TTransformedValues
 * (what `handleSubmit`'s callback receives after successful validation).
 */
type AdminHealthLogFormValues = z.input<typeof adminHealthLogSchema>;
type AdminHealthLogOutput = z.output<typeof adminHealthLogSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminHealthLogFormProps {
  stayId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns today's date as YYYY-MM-DD in local timezone */
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Format a date string for display */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Admin Health Log Form
 *
 * Provides a form for admin to record daily health metrics (weight, BP, sugar, notes)
 * and displays customer-entered health logs (water intake, activity) in a read-only table.
 *
 * Requirements: 13.5, 13.6
 */
export function AdminHealthLogForm({ stayId }: AdminHealthLogFormProps) {
  const [isPending, startTransition] = useTransition();
  const [customerLogs, setCustomerLogs] = useState<CustomerHealthLogRow[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminHealthLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  const form = useForm<AdminHealthLogFormValues, unknown, AdminHealthLogOutput>({
    resolver: zodResolver(adminHealthLogSchema),
    defaultValues: {
      logDate: getTodayDateString(),
      weightKg: undefined,
      bpSystolic: undefined,
      bpDiastolic: undefined,
      sugarLevelMgdl: undefined,
      notes: "",
    },
    mode: "onChange",
  });

  // Fetch both customer and admin health logs on mount
  const fetchLogs = async () => {
    setLoadingLogs(true);
    const [customerResult, adminResult] = await Promise.all([
      getCustomerHealthLogsAction(stayId),
      getAdminHealthLogsAction(stayId),
    ]);
    if ("success" in customerResult && customerResult.success) {
      setCustomerLogs(customerResult.data);
    }
    if ("success" in adminResult && adminResult.success) {
      setAdminLogs(adminResult.data);
    }
    setLoadingLogs(false);
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayId]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await submitAdminHealthLogAction(stayId, values);

      if ("success" in result && result.success) {
        toast.success("Health log recorded successfully.");
        form.reset({
          logDate: getTodayDateString(),
          weightKg: undefined,
          bpSystolic: undefined,
          bpDiastolic: undefined,
          sugarLevelMgdl: undefined,
          notes: "",
        });
        // Refresh admin logs to show the newly saved entry
        fetchLogs();
      } else if ("error" in result) {
        toast.error(result.error);
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, message]) => {
            form.setError(field as keyof AdminHealthLogFormValues, { message });
          });
        }
      }
    });
  });

  return (
    <div className="space-y-6">
      {/* ─── Admin Health Log Entry Form ─── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4 text-primary" />
            Record Health Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4">
              {/* Date */}
              <FormField
                control={form.control}
                name="logDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Weight & Sugar Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="weightKg"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weight (kg)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={30}
                          max={300}
                          step={0.1}
                          placeholder="e.g. 72.5"
                          value={(field.value as number | string | undefined) ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value)
                            )
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sugarLevelMgdl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sugar Level (mg/dL)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={30}
                          max={600}
                          placeholder="e.g. 110"
                          value={(field.value as number | string | undefined) ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value)
                            )
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Blood Pressure Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="bpSystolic"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>BP Systolic (mmHg)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={60}
                          max={250}
                          placeholder="e.g. 120"
                          value={(field.value as number | string | undefined) ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value)
                            )
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bpDiastolic"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>BP Diastolic (mmHg)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={40}
                          max={150}
                          placeholder="e.g. 80"
                          value={(field.value as number | string | undefined) ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value)
                            )
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Notes */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Optional notes about the checkup..."
                        maxLength={500}
                        rows={3}
                        {...field}
                        value={field.value ?? ""}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Submit */}
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={isPending} className="gap-2">
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save Health Log"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* ─── Admin Health Logs (Previously Entered) ─── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4 text-primary" />
            Admin Health Log History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingLogs ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : adminLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No admin health logs recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 border-b border-slate-200">
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Date
                  </TableHead>
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Weight (kg)
                  </TableHead>
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    BP (mmHg)
                  </TableHead>
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Sugar (mg/dL)
                  </TableHead>
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Notes
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-slate-700">
                      {formatDate(log.log_date)}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {log.weight_kg ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {log.bp_systolic && log.bp_diastolic
                        ? `${log.bp_systolic}/${log.bp_diastolic}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {log.sugar_level_mgdl ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700 max-w-[200px] truncate">
                      {log.notes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Customer Health Logs (Read-Only Table) ─── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Customer Health Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingLogs ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : customerLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No customer health logs recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 border-b border-slate-200">
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Date
                  </TableHead>
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Water Intake (L)
                  </TableHead>
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Activity Name
                  </TableHead>
                  <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Duration (min)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-slate-700">
                      {formatDate(log.log_date)}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {log.water_intake_liters}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {log.activity_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {log.activity_duration_minutes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
