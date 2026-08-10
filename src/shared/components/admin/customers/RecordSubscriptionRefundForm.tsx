"use client";

// src/shared/components/admin/customers/RecordSubscriptionRefundForm.tsx
//
// Feature: meal-subscription-early-closure
//
// Records a refund for a subscription that was over-collected — typically
// after a tenure recalculation shortened it below what the customer already
// paid. Deliberately NOT the generic ledger form: the amount is LOCKED to the
// live `refundDue` and cannot be edited, and a remark is mandatory. The server
// action re-derives the excess from the ledger and rejects any amount that has
// since drifted (see recordSubscriptionRefundAction).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Loader2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { recordSubscriptionRefundAction } from "@/actions/admin-actions/subscriptionPaymentActions";

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function RecordSubscriptionRefundForm({
  subscriptionId,
  customerProfileId,
  refundDue,
}: {
  subscriptionId: string;
  customerProfileId: string;
  /** Live over-collected amount — the ONLY amount this form can submit. */
  refundDue: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [remark, setRemark] = useState("");
  const [comment, setComment] = useState("");
  const [remarkError, setRemarkError] = useState<string | null>(null);

  const canSubmit = !isPending && remark.trim().length > 0 && refundDue > 0;

  const handleSubmit = () => {
    if (!canSubmit) {
      if (remark.trim().length === 0) {
        setRemarkError("A remark is required before processing a refund.");
      }
      return;
    }

    startTransition(async () => {
      try {
        const result = await recordSubscriptionRefundAction(
          subscriptionId,
          customerProfileId,
          {
            amount: refundDue,
            remark: remark.trim(),
            comment: comment.trim() || undefined,
          },
        );

        if (result.success) {
          toast.success(
            result.isFullyPaid
              ? `Refund of ${money(refundDue)} recorded. This subscription is now fully settled.`
              : `Refund of ${money(refundDue)} recorded.`,
          );
          setRemark("");
          setComment("");
          router.refresh();
          return;
        }

        setRemarkError(null);
        toast.error(result.error);
      } catch (err) {
        console.error("Recording the refund failed:", err);
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : "The refund could not be recorded. Please try again.",
        );
      }
    });
  };

  return (
    <div className="rounded-lg border bg-background/80 p-4">
      <div className="flex items-center gap-2">
        <Banknote className="h-4 w-4 text-blue-600" />
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Process Refund
        </p>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        This subscription was over-collected by {money(refundDue)}. The refund
        amount is locked to this figure.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Refund amount (₹)
          </label>
          <Input
            type="text"
            value={money(refundDue)}
            disabled
            readOnly
            className="h-9 bg-muted/50 font-semibold"
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label
            htmlFor={`refund-remark-${subscriptionId}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Remark <span className="text-destructive">*</span>
          </label>
          <Input
            id={`refund-remark-${subscriptionId}`}
            type="text"
            placeholder="e.g. Refund for early closure settlement"
            maxLength={500}
            className="h-9"
            aria-invalid={Boolean(remarkError)}
            value={remark}
            onChange={(e) => {
              setRemark(e.target.value);
              if (e.target.value.trim().length > 0) setRemarkError(null);
            }}
          />
          {remarkError && (
            <p className="text-xs text-destructive">{remarkError}</p>
          )}
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label
            htmlFor={`refund-comment-${subscriptionId}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Note <span className="text-muted-foreground/70">(optional)</span>
          </label>
          <Input
            id={`refund-comment-${subscriptionId}`}
            type="text"
            placeholder="Optional additional context"
            maxLength={500}
            className="h-9"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="button" size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          <Banknote className="mr-1 h-3.5 w-3.5" />
          Process Refund of {money(refundDue)}
        </Button>
      </div>
    </div>
  );
}
