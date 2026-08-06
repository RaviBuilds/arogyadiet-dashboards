"use client";

// src/shared/components/admin/customers/RecalculateStayDialog.tsx
//
// Dialog for the Recalculate_Stay admin action (REPLACES `EarlyCheckoutDialog`,
// which is deleted once `AccommodationTab` no longer imports it — task 23.5).
//
// The admin picks a new Recalculated_End_Date from a calendar bounded to the
// stay's inclusive `[start date, currently booked Computed_End_Date]` range —
// nights are DERIVED from that date and displayed read-only, never typed — and
// an integer-only "Recalculated total stay amount". Pressing "Save Stay
// Details" persists both via `saveStayDetailsAction` and reports the resulting
// `SaveStayDetailsOutcome` to the parent via `onSaved`.
//
// This dialog intentionally renders NO checkout affordance and NO
// checked-out confirmation of any kind: Save Stay Details never transitions
// Stay_Status and never generates a Final_Consolidated_Invoice (Req 12.9).
// `Mark as Checked Out` lives entirely in `StayCheckoutActionBar` / the
// existing Requirement 7 gate — this dialog does not touch it.
//
// The picker's bounds are computed inline from the `startDate` /
// `bookedEndDate` props (both plain YYYY-MM-DD strings already available on
// `StayEntry`) rather than importing `AccommodationService.recalculationDateBounds`
// directly — that module pulls in `createAdminClient` and other server-only
// repositories, which must never be bundled into a "use client" component.
// The bounds are never empty: for a 1-night stay `startDate === bookedEndDate`,
// so the range collapses to that single selectable date (Req 12.3).
//
// Props are intentionally primitive (stayId + date/amount strings) rather
// than a full `StayEntry`, mirroring the shape `EarlyCheckoutDialog` used —
// the task 23.5 integrator can pass `selectedStay.startDate` /
// `AccommodationService`-computed booked end date (or `selectedStay.endDate`,
// which already IS the currently booked Computed_End_Date before this dialog
// changes anything) directly from `AccommodationTab`'s existing `StayEntry`.
//
// Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.11, 12.12

import { useEffect, useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { differenceInDays, format, parseISO } from "date-fns";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Calendar } from "@/shared/components/ui/calendar";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";

import { parseISODateString } from "@/lib/dates/ist";
import { createRecalculateStaySchema } from "@/validations/accommodationSchema";
import { saveStayDetailsAction } from "@/actions/stayActions";
import type { SaveStayDetailsOutcome } from "@/types/accommodation";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecalculateStayDialogProps {
  stayId: string;
  /** The Stay_Entry's start date (YYYY-MM-DD) — the picker's lower bound. */
  startDate: string;
  /**
   * The stay's CURRENTLY BOOKED Computed_End_Date (YYYY-MM-DD) — the picker's
   * upper bound and the prefilled default selection. This is `StayEntry.endDate`
   * as it stands *before* this dialog changes anything (i.e. `start + totalNights − 1`).
   */
  bookedEndDate: string;
  /** The Stay_Entry's current Total_Stay_Amount — prefills the amount input. */
  currentTotalStayAmount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reports the outcome so the parent can route to the next money follow-up. */
  onSaved: (outcome: SaveStayDetailsOutcome) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Total nights spanned by an inclusive `[startDate, endDate]` range:
 * `end − start + 1`. The exact client-side mirror of
 * `AccommodationService.nightsFromEndDate` — kept local (rather than imported)
 * so this "use client" file never reaches into the server-only service module.
 */
function nightsBetween(startDate: string, endDate: string): number {
  return differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for the Recalculate_Stay / Save_Stay_Details admin action.
 *
 * `createRecalculateStaySchema(startDate, bookedEndDate)` is recomputed (via
 * `useMemo`) whenever those props change, so the zodResolver always validates
 * against the stay's current bounds — the same schema the server re-validates
 * with (Req 12.5).
 *
 * The form resets to the current prefill values every time the dialog opens
 * (not just on mount), since "Recalculate Stay" is repeatable while the stay
 * stays ACTIVE (Req 12.10) and each reopening must reflect the stay's latest
 * booked figures (Req 12.2).
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.11, 12.12
 */
export function RecalculateStayDialog({
  stayId,
  startDate,
  bookedEndDate,
  currentTotalStayAmount,
  open,
  onOpenChange,
  onSaved,
}: RecalculateStayDialogProps) {
  const [isPending, startTransition] = useTransition();

  const schema = useMemo(
    () => createRecalculateStaySchema(startDate, bookedEndDate),
    [startDate, bookedEndDate]
  );
  type FormValues = z.input<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      recalculatedEndDate: bookedEndDate,
      recalculatedStayAmount: currentTotalStayAmount,
    },
  });

  // Re-prefill on every open — Recalculate Stay is repeatable, and each
  // invocation must reflect the stay's *current* booked end date and amount,
  // not whatever was left over from a previous open of the same dialog
  // instance (Req 12.2, 12.10).
  useEffect(() => {
    if (open) {
      form.reset({
        recalculatedEndDate: bookedEndDate,
        recalculatedStayAmount: currentTotalStayAmount,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookedEndDate, currentTotalStayAmount]);

  const selectedEndDate = form.watch("recalculatedEndDate") || bookedEndDate;
  const totalNights = nightsBetween(startDate, selectedEndDate);

  // Both bounds are inclusive and selectable — the range is never empty; for
  // a 1-night stay `minDate === maxDate === startDate` (Req 12.3).
  const minDate = useMemo(() => parseISODateString(startDate), [startDate]);
  const maxDate = useMemo(
    () => parseISODateString(bookedEndDate),
    [bookedEndDate]
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await saveStayDetailsAction(stayId, values);

      if ("success" in result && result.success) {
        const outcome = result.data;

        if (outcome.nextAction === "COLLECT_BALANCE") {
          toast.success(
            `Stay details saved — a balance of ₹${outcome.balance.remainingBalance.toLocaleString(
              "en-IN"
            )} is now due.`
          );
        } else if (outcome.nextAction === "RECORD_REFUND") {
          toast.success(
            `Stay details saved — a refund of ₹${outcome.refundDue.toLocaleString(
              "en-IN"
            )} is now due.`
          );
        } else {
          toast.success("Stay details saved — fully settled.");
        }

        onOpenChange(false);
        onSaved(outcome);
      } else if ("error" in result) {
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recalculate Stay</DialogTitle>
          <DialogDescription>
            Pick the new end date and/or correct the total stay amount. This
            does not check the guest out — the stay stays active.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="recalculatedEndDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recalculated end date</FormLabel>
                  <FormControl>
                    <div className="flex justify-center rounded-lg border">
                      <Calendar
                        mode="single"
                        selected={parseISODateString(field.value)}
                        defaultMonth={parseISODateString(field.value)}
                        onSelect={(date) => {
                          if (!date) return;
                          field.onChange(format(date, "yyyy-MM-dd"));
                        }}
                        disabled={(date) => date < minDate || date > maxDate}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-sm font-medium">
              Total nights: <span className="tabular-nums">{totalNights}</span>
            </p>
            <FormField
              control={form.control}
              name="recalculatedStayAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Recalculated total stay amount (₹, GST inclusive)
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={9999999}
                      step={1}
                      inputMode="numeric"
                      placeholder="e.g. 15000"
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
                {isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Stay Details
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
