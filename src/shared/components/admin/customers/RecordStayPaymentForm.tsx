"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";

import { recordStayPaymentSchema } from "@/validations/accommodationSchema";
import { recordStayPaymentAction } from "@/actions/stayPaymentActions";
import type { StayBalanceSnapshot } from "@/types/accommodation";
import type { z } from "zod";

type FormValues = z.input<typeof recordStayPaymentSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecordStayPaymentFormProps {
  stayId: string;
  remainingBalance: number;
  onSuccess: (balance: StayBalanceSnapshot) => void;
  /**
   * Called once the submission settles, whether it succeeded or failed.
   * Lets the parent force a ledger refetch (e.g. bump `refreshToken`) on
   * every attempt — including a failed one — so totals stay in sync per
   * Req 5.9 ("whether or not the Payment_Transaction was successfully
   * recorded").
   */
  onSettled?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Embeddable (non-dialog) form for recording a partial/balance payment
 * against a Stay_Entry's remaining balance.
 *
 * Client-side caps the amount hint at `remainingBalance` for UX, but the
 * server RPC (`record_stay_payment_transaction`) remains the authoritative
 * check (Req 5.5) — this component never hard-blocks submission beyond the
 * static Zod schema.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
export function RecordStayPaymentForm({
  stayId,
  remainingBalance,
  onSuccess,
  onSettled,
}: RecordStayPaymentFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(recordStayPaymentSchema),
    defaultValues: {
      amount: undefined,
      comment: "",
      remark: "",
    },
  });

  const amountValue = useWatch({ control: form.control, name: "amount" });
  const exceedsRemainingBalance =
    amountValue != null &&
    amountValue !== ("" as unknown) &&
    !Number.isNaN(Number(amountValue)) &&
    Number(amountValue) > remainingBalance;

  const applyServerFieldErrors = (fieldErrors?: Record<string, string>) => {
    if (!fieldErrors) return;
    for (const [key, message] of Object.entries(fieldErrors)) {
      form.setError(key as keyof FormValues, { type: "server", message });
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        const result = await recordStayPaymentAction(stayId, values);

        if ("success" in result && result.success) {
          toast.success("Payment recorded.");
          form.reset({ amount: undefined, comment: "", remark: "" });
          onSuccess(result.data);
        } else if ("error" in result) {
          toast.error(result.error);
          applyServerFieldErrors(result.fieldErrors);
        }
      } finally {
        // Always notify the parent the submission settled — success or
        // failure — so the ledger can be refetched either way (Req 5.9).
        onSettled?.();
      }
    });
  });

  if (remainingBalance <= 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This stay is fully paid — there is no remaining balance to record a
        payment against.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount (₹)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0.01}
                  max={remainingBalance}
                  step="0.01"
                  placeholder="e.g. 5000"
                  value={field.value != null ? String(field.value) : ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  disabled={isPending}
                />
              </FormControl>
              <p className="text-xs text-slate-500">
                Remaining balance: ₹{remainingBalance.toLocaleString("en-IN")}
              </p>
              {exceedsRemainingBalance && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-1">
                  Amount exceeds the remaining balance of ₹
                  {remainingBalance.toLocaleString("en-IN")}.
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="comment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Comment</FormLabel>
              <FormControl>
                <Textarea
                  maxLength={500}
                  placeholder="e.g. Cash received at front desk"
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
          name="remark"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Remark (optional)</FormLabel>
              <FormControl>
                <Textarea
                  maxLength={500}
                  placeholder="Additional notes"
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPending || remainingBalance <= 0}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record Payment
          </Button>
        </div>
      </form>
    </Form>
  );
}
