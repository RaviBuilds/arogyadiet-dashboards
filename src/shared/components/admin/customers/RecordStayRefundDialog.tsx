"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, ReceiptText } from "lucide-react";

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
  /** Customer this stay belongs to — used to build the Refund_Invoice link. */
  customerProfileId: string;
  /** Current excess (Total_Paid − Total_Stay_Amount) available to refund. */
  refundDue: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called with the fresh balance and the id of the `payments` row generated
   * for the Refund_Invoice as soon as the refund is recorded, so the caller
   * can update totals immediately (Req 14.6, 14.7).
   */
  onSuccess: (result: {
    balance: StayBalanceSnapshot;
    refundInvoicePaymentId: string;
  }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Standalone "Mark as refunded" dialog. Available whenever an ACTIVE stay's
 * Total_Paid exceeds its current Total_Stay_Amount, regardless of how that
 * excess came about (Req 14.1) — not just as a follow-up to a stay
 * recalculation.
 *
 * Refund amount is prefilled with `refundDue` and bounded to `[1, refundDue]`
 * on the client as a hint (Req 14.2); the row-locked RPC
 * (`REFUND_EXCEEDS_EXCESS`) is the authoritative check. A remark describing
 * how the refund was initiated is required; comment is optional (Req 14.3).
 *
 * On success the dialog stays open and shows a link to the generated
 * Refund_Invoice (Req 14.7) instead of closing immediately, since the
 * `payments.id` for that invoice only exists after this submission succeeds.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.7
 */
export function RecordStayRefundDialog({
  stayId,
  customerProfileId,
  refundDue,
  open,
  onOpenChange,
  onSuccess,
}: RecordStayRefundDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [refundInvoicePaymentId, setRefundInvoicePaymentId] = useState<
    string | null
  >(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(recordStayRefundSchema),
    defaultValues: {
      amount: refundDue > 0 ? refundDue : undefined,
      remark: "",
      comment: "",
    },
  });

  // Prefill the amount with the current excess every time the dialog opens,
  // since refundDue may differ from the value it held the last time it was
  // open, and clear any previous success state.
  useEffect(() => {
    if (open) {
      form.reset({
        amount: refundDue > 0 ? refundDue : undefined,
        remark: "",
        comment: "",
      });
      setRefundInvoicePaymentId(null);
    }
  }, [open, refundDue, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await recordStayRefundAction(stayId, values);

      if ("success" in result && result.success) {
        toast.success("Refund recorded.");
        // Keep the dialog open so the admin can follow the invoice link
        // below rather than closing immediately (Req 14.7).
        setRefundInvoicePaymentId(result.data.refundInvoicePaymentId);
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

  const handleClose = () => {
    form.reset();
    setRefundInvoicePaymentId(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : handleClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Refunded</DialogTitle>
          <DialogDescription>
            Record a refund for the excess amount already paid against this
            stay.
          </DialogDescription>
        </DialogHeader>

        {refundInvoicePaymentId ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The refund has been recorded and a Refund Invoice has been
              generated.
            </p>
            <a
              href={`/admin/customers/${customerProfileId}/billing/invoice/${refundInvoicePaymentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ReceiptText className="h-4 w-4" />
              View Refund Invoice
            </a>
            <div className="flex justify-end pt-2">
              <Button type="button" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        ) : refundDue <= 0 ? (
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
                  onClick={handleClose}
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
