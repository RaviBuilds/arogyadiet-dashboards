"use client";

import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
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

import { recordStayRefundSchema } from "@/validations/accommodationSchema";
import { recordStayRefundAction } from "@/actions/stayPaymentActions";
import type { StayBalanceSnapshot } from "@/types/accommodation";
import type { z } from "zod";

type FormValues = z.input<typeof recordStayRefundSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecordStayRefundDialogProps {
  stayId: string;
  /** Current excess (Total_Paid − Total_Stay_Amount) available to refund. */
  refundDue: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (balance: StayBalanceSnapshot) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for recording a refund against a stay's refundable excess, typically
 * reached after an Early_Checkout leaves Total_Paid greater than the
 * Recalculated_Stay_Amount.
 *
 * Refund amount is prefilled with `refundDue` and bounded to `[1, refundDue]`
 * on the client as a hint; the row-locked RPC (`REFUND_EXCEEDS_EXCESS`) is the
 * authoritative check. A remark describing how the refund was initiated is
 * required; comment is optional.
 *
 * Requirements: 12.8, 12.9, 12.10, 12.11
 */
export function RecordStayRefundDialog({
  stayId,
  refundDue,
  open,
  onOpenChange,
  onSuccess,
}: RecordStayRefundDialogProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(recordStayRefundSchema),
    defaultValues: {
      amount: refundDue > 0 ? refundDue : undefined,
      remark: "",
      comment: "",
    },
  });

  // Prefill the amount with the current excess every time the dialog opens,
  // since refundDue may differ from the value it held the last time it was open.
  useEffect(() => {
    if (open) {
      form.reset({
        amount: refundDue > 0 ? refundDue : undefined,
        remark: "",
        comment: "",
      });
    }
  }, [open, refundDue, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await recordStayRefundAction(stayId, values);

      if ("success" in result && result.success) {
        toast.success("Refund recorded.");
        form.reset();
        onOpenChange(false);
        onSuccess(result.data);
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
          <DialogTitle>Record Refund</DialogTitle>
          <DialogDescription>
            Record a refund for the excess amount already paid against this
            stay.
          </DialogDescription>
        </DialogHeader>

        {refundDue <= 0 ? (
          <p className="text-sm text-muted-foreground">
            No refund is currently due for this stay.
          </p>
        ) : (
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Refund Amount (₹)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={refundDue}
                        placeholder={`Up to ₹${refundDue}`}
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
              <FormField
                control={form.control}
                name="remark"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Remark (how was the refund initiated?)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g. Refunded via UPI to source account"
                        maxLength={500}
                        disabled={isPending}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comment (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes about this refund"
                        maxLength={500}
                        disabled={isPending}
                        {...field}
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
                  Record Refund
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
