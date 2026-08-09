"use client";

// src/shared/components/admin/customers/NewStayDialog.tsx
//
// "Add New Stay" for an EXISTING accommodation customer, reached from the
// Customer_360 Accommodation tab. Deliberately a mirror of the Quick_Onboard
// form's Category & Plan accommodation step, minus everything that describes a
// customer rather than a stay (name, mobile, temp PIN, address, medical
// history) — that customer already exists.
//
// What it therefore carries, all of it validated by the same `createStaySchema`
// refinements the onboarding schema uses:
//   * Backdated_Stay_Toggle, with the same ±30-day / +365-day start ranges and
//     the same "this stay will be created FINISHED" warning.
//   * An END DATE calendar instead of a typed night count. Nights are DERIVED
//     (`end − start + 1`) and shown read-only, so no second number can disagree
//     with the dates. The end date is the stay's inclusive LAST NIGHT AND its
//     checkout date, matching the Current Stay card's "End Date" and
//     `finalize_stay_checkout`'s "checkout opens on the end date" gate — there
//     is no separate "day after" checkout convention in this system.
//   * Total_Stay_Amount (renamed from the old "Payment Amount") + Advance_Amount
//     with a live "Balance to collect later" figure.
//   * Shared_Payment toggle, which hides both money fields and asks for the
//     Payment_Host's mobile instead.
//   * Optional Dietitian dropdown, unscoped (every active Dietitian).

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Loader2,
  CalendarCheck,
  Moon,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { format, parseISO, isValid as isValidDate } from "date-fns";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import {
  createStaySchema,
  nightsBetweenInclusive,
  MAX_STAY_NIGHTS,
} from "@/validations/accommodationSchema";
import {
  backdatedStayRange,
  forwardStayRange,
  describeBackdatedStayOutcome,
} from "@/lib/accommodation/backdatedStay";
import { addDaysToISODate, getISTDateString } from "@/lib/dates/ist";
import { createNewStayAction } from "@/actions/stayActions";
import { listActiveDietitiansForAdmin } from "@/actions/admin-actions/customerHealthLogActions";
import type { DietitianAccount } from "@/types/dietitian";
import type { z } from "zod";

type FormValues = z.input<typeof createStaySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a complete, parseable YYYY-MM-DD string. */
function isUsableDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE.test(value) &&
    isValidDate(parseISO(value))
  );
}

function formatLongDate(iso: string): string {
  return format(parseISO(iso), "EEE, dd MMM yyyy");
}

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/** A finite, non-negative number from a react-hook-form numeric field. */
function numberOrNull(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewStayDialogProps {
  customerProfileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for creating a new stay entry for a returning guest. Only rendered
 * when the customer has no stay occupying the Current Stay surface — nothing
 * ACTIVE, PENDING, or awaiting checkout.
 *
 * Requirements: 1.2, 1.3, 2.1, 3.4, 3.5, 4.2, 4.3, 4.4, 13.5, 14.3, 14.4
 */
export function NewStayDialog({
  customerProfileId,
  open,
  onOpenChange,
  onSuccess,
}: NewStayDialogProps) {
  const [isPending, startTransition] = useTransition();
  // `null` means "not fetched yet", which is what makes the loading state
  // derivable instead of a second piece of state to keep in sync.
  const [dietitians, setDietitians] = useState<DietitianAccount[] | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(createStaySchema),
    defaultValues: {
      startDate: "",
      endDate: "",
      stayType: undefined,
      occupancyType: undefined,
      mealPreference: undefined,
      backdatedStayEnabled: false,
      isSharedPayment: false,
      totalStayAmount: undefined,
      advanceAmountPaid: undefined,
      paymentHostMobile: "",
      dietitianUserId: "",
    },
  });

  // Subscribed field-by-field via `useWatch` rather than through a whole-form
  // `form.watch()`: the latter returns a fresh function on every render, which
  // opts this component out of React Compiler memoization entirely.
  const control = form.control;
  const backdatedEnabled =
    useWatch({ control, name: "backdatedStayEnabled" }) === true;
  const isSharedPayment = useWatch({ control, name: "isSharedPayment" }) === true;
  const watchedStartDate = useWatch({ control, name: "startDate" });
  const watchedEndDate = useWatch({ control, name: "endDate" });
  const watchedTotal = useWatch({ control, name: "totalStayAmount" });
  const watchedAdvance = useWatch({ control, name: "advanceAmountPaid" });

  // ── Dietitian options: unscoped list of every active Dietitian (Req 9.2).
  // Fetched once, the first time the dialog is opened. A failed fetch settles
  // to an empty list rather than retrying, so the dropdown simply offers
  // nothing and the stay can still be created — the dietitian is optional.
  useEffect(() => {
    if (!open || dietitians !== null) return;

    let cancelled = false;

    void (async () => {
      const result = await listActiveDietitiansForAdmin();
      if (cancelled) return;
      setDietitians(result.success ? result.data : []);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, dietitians]);

  const dietitianOptions = dietitians ?? [];
  const isLoadingDietitians = open && dietitians === null;

  // ── Selectable start-date range, driven by the backdated toggle. Recomputed
  // per render off the current IST date, exactly as the onboarding form does.
  const startRange = useMemo(
    () => (backdatedEnabled ? backdatedStayRange() : forwardStayRange()),
    [backdatedEnabled]
  );

  // ── Derived night count. `endDate` is the inclusive last night AND the
  // checkout date, so nights = end − start + 1 with no separate checkout day.
  const startDate = isUsableDate(watchedStartDate) ? watchedStartDate : null;
  const endDate = isUsableDate(watchedEndDate) ? watchedEndDate : null;

  const derivedNights =
    startDate && endDate && endDate >= startDate
      ? nightsBetweenInclusive(startDate, endDate)
      : null;

  const nightsInRange =
    derivedNights !== null &&
    derivedNights >= 1 &&
    derivedNights <= MAX_STAY_NIGHTS;

  // ── "This stay will be created FINISHED" warning. Same predicate the
  // onboarding form uses: the computed end date already sits before today IST.
  const backdatedOutcome =
    startDate && nightsInRange && derivedNights !== null
      ? describeBackdatedStayOutcome(startDate, derivedNights)
      : null;

  // ── Money: total, advance, and the balance that will be left to collect.
  const totalStayAmount = numberOrNull(watchedTotal);
  const advanceAmountPaid = numberOrNull(watchedAdvance);
  const advanceExceedsTotal =
    totalStayAmount !== null &&
    advanceAmountPaid !== null &&
    advanceAmountPaid > totalStayAmount;
  const showBalance =
    totalStayAmount !== null &&
    advanceAmountPaid !== null &&
    totalStayAmount >= 1 &&
    advanceAmountPaid >= 0 &&
    !advanceExceedsTotal;

  // Flipping the backdated toggle clears both dates: the previously picked
  // start is almost certainly outside the newly active range, and an end date
  // anchored to it is meaningless (Req 1.4).
  const handleBackdatedToggle = (enabled: boolean) => {
    form.setValue("backdatedStayEnabled", enabled, { shouldValidate: false });
    form.setValue("startDate", "", { shouldValidate: false });
    form.setValue("endDate", "", { shouldValidate: false });
    form.clearErrors(["startDate", "endDate"]);
  };

  // Shared payment and the total/advance split are mutually exclusive: a
  // Shared_Payment stay carries no Total_Stay_Amount and no ledger at all, so
  // whichever side is being hidden is cleared rather than left to submit stale.
  const handleSharedPaymentToggle = (enabled: boolean) => {
    form.setValue("isSharedPayment", enabled, { shouldValidate: false });
    if (enabled) {
      form.setValue("totalStayAmount", undefined, { shouldValidate: false });
      form.setValue("advanceAmountPaid", undefined, { shouldValidate: false });
      form.clearErrors(["totalStayAmount", "advanceAmountPaid"]);
    } else {
      form.setValue("paymentHostMobile", "", { shouldValidate: false });
      form.clearErrors("paymentHostMobile");
    }
  };

  const onSubmit = form.handleSubmit((formValues) => {
    startTransition(async () => {
      const result = await createNewStayAction(customerProfileId, formValues);

      if ("success" in result && result.success) {
        if (result.data.dietitianWarning) {
          toast.warning(result.data.dietitianWarning);
        } else {
          toast.success("New stay created");
        }
        form.reset();
        onOpenChange(false);
        onSuccess();
        return;
      }

      if ("error" in result) {
        // Bind server-side field errors so they land on the right input
        // instead of only appearing in a toast.
        if (result.fieldErrors) {
          for (const [field, message] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof FormValues, { message });
          }
        }
        toast.error(result.error);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Stay</DialogTitle>
          <DialogDescription>
            Create a new stay entry for this returning guest.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-5">
            {/* ─── Backdated stay toggle ─── */}
            <FormField
              control={form.control}
              name="backdatedStayEnabled"
              render={({ field }) => (
                <FormItem>
                  <label className="inline-flex w-fit cursor-pointer items-start gap-3 select-none">
                    <FormControl>
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(checked) =>
                          handleBackdatedToggle(checked === true)
                        }
                        disabled={isPending}
                      />
                    </FormControl>
                    <span className="text-sm">
                      <span className="font-medium">Backdated stay entry</span>
                      <span className="block text-xs text-muted-foreground">
                        Enable to record a stay that already started or finished.
                      </span>
                    </span>
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ─── Dates ─── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        min={startRange.min}
                        max={startRange.max}
                        {...field}
                        value={field.value ?? ""}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      {backdatedEnabled
                        ? `A past date between ${startRange.min} and ${startRange.max}.`
                        : "Today or any future date up to 365 days."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        // The start date itself is selectable and yields a
                        // 1-night stay, so it is the inclusive lower bound.
                        min={startDate ?? undefined}
                        max={
                          startDate
                            ? addDaysToISODate(startDate, MAX_STAY_NIGHTS - 1)
                            : undefined
                        }
                        {...field}
                        value={field.value ?? ""}
                        disabled={isPending || !startDate}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      {startDate
                        ? "The guest's last night. Total nights is calculated from it."
                        : "Pick a start date first."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ─── Derived nights + checkout date ───
                End Date IS the checkout date in this system — `finalize_stay_checkout`
                opens on and stamps `checked_out_at` at end-of-day on this same
                date (see the "Checkout opens on that date" gate in
                stayActions.ts). There is no separate "day after" convention, so
                this chip echoes End Date rather than adding a day to it. */}
            {nightsInRange && derivedNights !== null && endDate && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pr-3 pl-2 text-xs">
                  <Moon
                    className="h-3.5 w-3.5 shrink-0 text-slate-500"
                    aria-hidden="true"
                  />
                  <span className="font-medium text-slate-600">
                    Total nights
                  </span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {derivedNights}
                  </span>
                </span>
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-200 bg-sky-50 py-1 pr-3 pl-2 text-xs">
                  <CalendarCheck
                    className="h-3.5 w-3.5 shrink-0 text-sky-600"
                    aria-hidden="true"
                  />
                  <span className="font-medium text-sky-700">Checkout</span>
                  <span className="font-semibold text-sky-900 tabular-nums">
                    {formatLongDate(endDate)}
                  </span>
                </span>
                {derivedNights < 7 && (
                  <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                    Recommended minimum stay is 7 nights.
                  </span>
                )}
              </div>
            )}

            {/* ─── Instant-FINISHED warning ─── */}
            {backdatedOutcome?.showCompletionAlert && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Stay will be created as finished</AlertTitle>
                <AlertDescription>
                  The end date ({formatLongDate(backdatedOutcome.computedEndDate)})
                  is already in the past, so this stay will be created with
                  status FINISHED. You can still submit it, or move the end date
                  to {getISTDateString(0)} or later to keep it active.
                </AlertDescription>
              </Alert>
            )}

            {/* ─── Stay type + occupancy ─── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="stayType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stay Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="AC Villa">AC Villa</SelectItem>
                        <SelectItem value="Village Style Hut">
                          Village Style Hut
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="occupancyType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Occupancy Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select occupancy" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Single">Single</SelectItem>
                        <SelectItem value="Double">Double</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ─── Meal preference ─── */}
            <FormField
              control={form.control}
              name="mealPreference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Meal Preference</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full sm:max-w-xs">
                        <SelectValue placeholder="Select meal" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="VEG">Veg</SelectItem>
                      <SelectItem value="EGG">Egg</SelectItem>
                      <SelectItem value="CHICKEN">Chicken</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ─── Payment ─── */}
            <div className="rounded-xl border p-4 space-y-4">
              <FormField
                control={form.control}
                name="isSharedPayment"
                render={({ field }) => (
                  <FormItem>
                    <label className="inline-flex w-fit cursor-pointer items-start gap-3 select-none">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(checked) =>
                            handleSharedPaymentToggle(checked === true)
                          }
                          disabled={isPending}
                        />
                      </FormControl>
                      <span className="text-sm">
                        <span className="font-medium">
                          This is a shared payment
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Another guest is paying for this stay.
                        </span>
                      </span>
                    </label>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isSharedPayment ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="totalStayAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Total Stay Amount (₹)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={9999999}
                            placeholder="e.g. 50000"
                            value={field.value != null ? String(field.value) : ""}
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
                        <FormDescription className="text-xs">
                          Inclusive of 18% GST (₹1 – ₹99,99,999).
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="advanceAmountPaid"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Advance Amount Paid (₹)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={totalStayAmount ?? 9999999}
                            placeholder="e.g. 10000"
                            value={field.value != null ? String(field.value) : ""}
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
                        <FormDescription className="text-xs">
                          Collected now (₹0 if none).
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {advanceExceedsTotal && (
                    <p className="sm:col-span-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                      Advance amount cannot exceed the total stay amount.
                    </p>
                  )}

                  {showBalance && (
                    <div className="sm:col-span-2 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 py-1 pr-3 pl-2 text-xs">
                      <Wallet
                        className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                      <span className="font-medium text-emerald-700">
                        Balance to collect later
                      </span>
                      <span className="font-semibold text-emerald-900 tabular-nums">
                        {formatRupees(totalStayAmount! - advanceAmountPaid!)}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <FormField
                  control={form.control}
                  name="paymentHostMobile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Host Mobile</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="10-digit mobile of the paying guest"
                          className="sm:max-w-xs"
                          {...field}
                          value={field.value ?? ""}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Must be an existing accommodation customer with an active
                        or pending stay.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {/* ─── Dietitian ─── */}
            <FormField
              control={form.control}
              name="dietitianUserId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Dietitian{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? ""}
                    disabled={isPending || isLoadingDietitians}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full sm:max-w-sm">
                        <SelectValue
                          placeholder={
                            isLoadingDietitians
                              ? "Loading dietitians…"
                              : "Select a dietitian (optional)"
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {dietitianOptions.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    Updates the customer&apos;s assigned dietitian. Leave empty to
                    keep the current one.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Stay
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
