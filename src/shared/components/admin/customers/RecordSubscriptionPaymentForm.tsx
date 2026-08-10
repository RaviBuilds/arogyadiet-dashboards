"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { IndianRupee, Loader2, Wallet } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/lib/utils";
import { recordSubscriptionBalancePaymentAction } from "@/actions/admin-actions/subscriptionPaymentActions";
import {
  SUBSCRIPTION_PAYMENT_METHODS,
  type SubscriptionPaymentMethod,
} from "@/validations/subscriptionPaymentSchema";

/**
 * RecordSubscriptionPaymentForm — collects a balance payment against a
 * subscription that still has money outstanding
 * (meal-subscription-partial-payment).
 *
 * Only rendered when `balanceDue > 0`. On success the row is appended to the
 * ledger, the single invoice's `amount_paid` / `balance_due` are re-projected,
 * and `router.refresh()` re-runs the server render so the breakup card and the
 * Payments Collected list update from one source of truth rather than from
 * optimistic client state.
 *
 * The amount is validated client-side against the balance as rendered, but the
 * server re-checks inside a row lock and returns the authoritative figure. That
 * matters when two admins collect concurrently: the second submit is rejected
 * with the real remaining balance rather than silently over-collecting.
 */
const METHOD_LABELS: Record<SubscriptionPaymentMethod, string> = {
  COUNTER: "Cash at counter",
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function RecordSubscriptionPaymentForm({
  subscriptionId,
  customerProfileId,
  balanceDue,
  amountPaid,
}: {
  subscriptionId: string;
  customerProfileId: string;
  /** Live remaining balance, and the upper bound on this collection. */
  balanceDue: number;
  /** Collected so far — used only to preview the running total. */
  amountPaid: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [amountInput, setAmountInput] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [method, setMethod] = useState<SubscriptionPaymentMethod>("COUNTER");
  const [reference, setReference] = useState("");
  const [comment, setComment] = useState("");

  const handleAmountChange = (raw: string) => {
    setAmountInput(raw);

    if (raw.trim() === "") {
      setAmount(null);
      setAmountError(null);
      return;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed)) {
      setAmount(null);
      setAmountError("Enter a valid amount.");
      return;
    }
    if (parsed <= 0) {
      setAmount(null);
      setAmountError("Amount must be greater than ₹0.");
      return;
    }

    const decimals = raw.split(".")[1];
    if (decimals && decimals.length > 2) {
      setAmount(null);
      setAmountError("Amount cannot have more than 2 decimal places.");
      return;
    }

    // Compared in paise so a payment that exactly clears the balance is accepted
    // rather than rejected on float drift.
    if (Math.round(parsed * 100) > Math.round(balanceDue * 100)) {
      setAmount(null);
      setAmountError(`Amount cannot exceed the balance of ${money(balanceDue)}.`);
      return;
    }

    setAmount(parsed);
    setAmountError(null);
  };

  /** One click to settle the account in full — the common case. */
  const handlePayFull = () => {
    handleAmountChange(balanceDue.toFixed(2));
  };

  const projectedPaid = amount === null ? amountPaid : amountPaid + amount;
  const projectedBalance =
    amount === null
      ? balanceDue
      : Math.round(balanceDue * 100 - amount * 100) / 100;

  const canSubmit = !isPending && amount !== null && !amountError;

  const handleSubmit = () => {
    if (!canSubmit || amount === null) return;

    startTransition(async () => {
      try {
        const result = await recordSubscriptionBalancePaymentAction(
          subscriptionId,
          customerProfileId,
          {
            amount,
            paymentMethod: method,
            paymentReference: reference.trim() || undefined,
            comment: comment.trim() || undefined,
          },
        );

        if (result.success) {
          toast.success(
            result.isFullyPaid
              ? `Payment of ${money(amount)} recorded. This subscription is now fully paid.`
              : `Payment of ${money(amount)} recorded. ${money(result.remainingBalance)} still due.`,
          );
          setAmountInput("");
          setAmount(null);
          setReference("");
          setComment("");
          // Re-render from the server so the breakup card, the Payments
          // Collected list and the Add-Subscription gate all move together.
          router.refresh();
          return;
        }

        setAmountError(result.fieldErrors?.amount ?? null);
        toast.error(result.error);
      } catch (err) {
        // A thrown Server Action rejects the promise; unhandled, the form would
        // just appear frozen.
        console.error("Recording the balance payment failed:", err);
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : "The payment could not be recorded. Please try again.",
        );
      }
    });
  };

  return (
    /* Neutral shell matching the card's other inner boxes
       (`rounded-lg border bg-background/80`), so the form reads as part of the
       Subscription Overview card rather than as a competing panel. */
    <div className="rounded-lg border bg-background/80 p-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-emerald-600" />
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Record Balance Payment
        </p>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Collecting against an outstanding balance of {money(balanceDue)}.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            htmlFor={`payment-amount-${subscriptionId}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Amount received (₹) <span className="text-destructive">*</span>
          </label>
          <div className="flex gap-2">
            <Input
              id={`payment-amount-${subscriptionId}`}
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              className="h-9"
              aria-invalid={Boolean(amountError)}
              value={amountInput}
              onChange={(e) => handleAmountChange(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={handlePayFull}
              disabled={isPending}
            >
              Full
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Collected via <span className="text-destructive">*</span>
          </label>
          <Select
            value={method}
            onValueChange={(v) => setMethod(v as SubscriptionPaymentMethod)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUBSCRIPTION_PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {METHOD_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label
            htmlFor={`payment-reference-${subscriptionId}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Reference <span className="text-muted-foreground/70">(optional)</span>
          </label>
          <Input
            id={`payment-reference-${subscriptionId}`}
            type="text"
            placeholder="UPI ref / cheque no. / receipt no."
            maxLength={200}
            className="h-9"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor={`payment-comment-${subscriptionId}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Note <span className="text-muted-foreground/70">(optional)</span>
          </label>
          <Input
            id={`payment-comment-${subscriptionId}`}
            type="text"
            placeholder="e.g. Second instalment"
            maxLength={500}
            className="h-9"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </div>

      {amountError && (
        <p className="mt-2 text-xs text-destructive">{amountError}</p>
      )}

      {/* Live preview of where this leaves the account, so the admin can confirm
          the arithmetic before committing rather than after. */}
      {amount !== null && (
        <div className="mt-4 space-y-1.5 rounded-lg border bg-muted/30 px-3 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">
              Total paid after this payment
            </span>
            <span className="text-sm font-bold tabular-nums text-emerald-900">
              {money(projectedPaid)}
            </span>
          </div>
          <div className="flex items-baseline justify-between border-t pt-1.5">
            <span
              className={cn(
                "text-xs font-semibold",
                projectedBalance === 0 ? "text-emerald-700" : "text-amber-700",
              )}
            >
              {projectedBalance === 0 ? "Balance cleared" : "Balance remaining"}
            </span>
            <span
              className={cn(
                "text-sm font-black tabular-nums",
                projectedBalance === 0 ? "text-emerald-900" : "text-amber-900",
              )}
            >
              {money(projectedBalance)}
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button type="button" size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          <IndianRupee className="mr-1 h-3.5 w-3.5" />
          Record Payment
        </Button>
      </div>
    </div>
  );
}
