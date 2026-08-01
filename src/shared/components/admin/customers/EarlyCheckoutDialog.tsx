"use client";

// src/shared/components/admin/customers/EarlyCheckoutDialog.tsx
//
// Dialog for applying an Early_Checkout to an ACTIVE stay: captures
// Actual_Nights_Stayed and Recalculated_Stay_Amount, then reports the
// resulting EarlyCheckoutOutcome to the parent via `onOutcome`.
//
// This component intentionally does NOT render the follow-up Record Payment
// form or Record Refund dialog itself — those are sibling components
// (RecordStayPaymentForm / RecordStayRefundDialog, tasks 11.2/11.3). The
// parent (AccommodationTab, task 11.6) decides what to render next based on
// `outcome.nextStep`.
//
// Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.12, 12.13

import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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

import { createEarlyCheckoutSchema } from "@/validations/accommodationSchema";
import { earlyCheckoutStayAction } from "@/actions/stayActions";
import type { EarlyCheckoutOutcome } from "@/types/accommodation";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EarlyCheckoutDialogProps {
  stayId: string;
  /** The stay's currently booked total nights — bounds Actual_Nights_Stayed. */
  bookedTotalNights: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reports the outcome so the parent can route to the next step. */
  onOutcome: (outcome: EarlyCheckoutOutcome) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for the Early_Checkout admin action.
 *
 * `createEarlyCheckoutSchema(bookedTotalNights)` is recomputed (via
 * `useMemo` keyed on `bookedTotalNights`) on every render so the zodResolver
 * always validates against the stay's *current* booked total nights, not a
 * value captured at first mount — react-hook-form re-reads `resolver` from
 * its options on every render, so a fresh schema reference is picked up
 * without needing to force a remount of the form.
 *
 * For a one-night stay the valid range `[1, bookedTotalNights − 1]` is empty
 * by design (Req 12.3) — every submission is rejected by the schema and the
 * Zod error surfaces naturally; no special-cased UI copy is added here to
 * keep this dialog focused.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.12, 12.13
 */
export function EarlyCheckoutDialog({
  stayId,
  bookedTotalNights,
  open,
  onOpenChange,
  onOutcome,
}: EarlyCheckoutDialogProps) {
  const [isPending, startTransition] = useTransition();

  const schema = useMemo(
    () => createEarlyCheckoutSchema(bookedTotalNights),
    [bookedTotalNights]
  );
  type FormValues = z.input<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      actualNightsStayed: undefined,
      recalculatedStayAmount: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await earlyCheckoutStayAction(stayId, values);

      if ("success" in result && result.success) {
        const outcome = result.data;

        if (outcome.nextStep === "CHECKED_OUT") {
          toast.success(
            outcome.invoiceStatus === "PENDING_RETRY"
              ? "Stay checked out early. Invoice generation failed — retry from the checkout panel."
              : "Stay checked out early."
          );
        } else if (outcome.nextStep === "COLLECT_BALANCE") {
          toast.success(
            "Recalculation applied — a balance is now due."
          );
        } else {
          toast.success(
            "Recalculation applied — a refund is now due."
          );
        }

        form.reset();
        onOpenChange(false);
        onOutcome(outcome);
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
          <DialogTitle>Early Checkout</DialogTitle>
          <DialogDescription>
            Record the actual nights stayed and the recalculated stay amount
            for an early departure.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="actualNightsStayed"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Actual nights stayed</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={Math.max(0, bookedTotalNights - 1)}
                      placeholder="e.g. 3"
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
                  <p className="text-xs text-slate-500">
                    Must be less than the currently booked {bookedTotalNights}{" "}
                    nights.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="recalculatedStayAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Recalculated stay amount (₹, GST inclusive)
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={9999999}
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
                Confirm Early Checkout
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
