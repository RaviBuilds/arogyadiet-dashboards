"use client";

// src/shared/components/admin/subscriptions/RecalculateTenureDialog.tsx
//
// Feature: meal-subscription-early-closure
//
// Replaces the old "Stop Subscription" confirm-by-typing dialog. An admin
// shortens an ACTIVE subscription's tenure, re-prices the invoice at the new
// (lower) subscription charge + delivery charge, and settles the difference —
// either an outstanding balance (existing Record Balance Payment flow) or a
// refund due (dedicated locked-amount refund action) once this dialog closes.
//
// GST is computed FORWARD on the new base charge (base * 0.05) — the opposite
// direction from onboarding's reverse-inclusive calculation — per explicit
// product decision. This is a live preview only; the RPC recomputes GST
// server-side from the same formula, so the two can never disagree.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Loader2, OctagonX } from "lucide-react";
import { format } from "date-fns";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { getRecalculationEndDateRange } from "@/lib/onboarding/cutoff";
import type { RecalculateTenureActionResult } from "@/actions/admin-actions/adminLifecycleActions";

const GST_RATE = 0.05;

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compares two rupee figures in integer paise, so float drift never causes a false mismatch. */
function paise(value: number): number {
  return Math.round(value * 100);
}

export interface RecalculateTenureInvoice {
  baseAmount: number;
  taxAmount: number;
  deliveryCharge: number;
  miscCharge: number;
  miscChargeLabel: string | null;
  totalPayable: number;
  amountPaid: number;
}

export function RecalculateTenureDialog({
  open,
  onOpenChange,
  subscriptionId,
  planName,
  startsOn,
  currentEffectiveEndOn,
  invoice,
  recalculateAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string;
  planName: string;
  startsOn: string;
  currentEffectiveEndOn: string;
  invoice: RecalculateTenureInvoice;
  recalculateAction: (
    subscriptionId: string,
    input: unknown,
  ) => Promise<RecalculateTenureActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { min: minEndDate, max: maxEndDate } = useMemo(
    () => getRecalculationEndDateRange(new Date(), currentEffectiveEndOn),
    [currentEffectiveEndOn],
  );
  const rangeIsEmpty = minEndDate > maxEndDate;

  const [newEndDate, setNewEndDate] = useState(rangeIsEmpty ? "" : maxEndDate);
  const [baseInput, setBaseInput] = useState("");
  const [deliveryInput, setDeliveryInput] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const newBaseAmount = baseInput.trim() === "" ? null : Number(baseInput);
  const newDeliveryCharge = deliveryInput.trim() === "" ? null : Number(deliveryInput);

  const baseValid =
    newBaseAmount !== null &&
    Number.isFinite(newBaseAmount) &&
    newBaseAmount >= 0 &&
    paise(newBaseAmount) < paise(invoice.baseAmount);

  const deliveryValid =
    newDeliveryCharge !== null &&
    Number.isFinite(newDeliveryCharge) &&
    newDeliveryCharge >= 0 &&
    paise(newDeliveryCharge) < paise(invoice.deliveryCharge);

  const endDateValid =
    !rangeIsEmpty && newEndDate >= minEndDate && newEndDate <= maxEndDate;

  // Live preview — the RPC recomputes this from the identical forward-5% formula.
  const newTaxAmount =
    newBaseAmount !== null && baseValid
      ? Math.round(newBaseAmount * GST_RATE * 100) / 100
      : 0;
  const newTotalPayable =
    baseValid && deliveryValid
      ? Number(
          (
            (newBaseAmount ?? 0) +
            newTaxAmount +
            (newDeliveryCharge ?? 0) +
            invoice.miscCharge
          ).toFixed(2),
        )
      : null;

  const settlementAmount =
    newTotalPayable !== null
      ? Number((newTotalPayable - invoice.amountPaid).toFixed(2))
      : null;

  const canSubmit =
    !isPending &&
    endDateValid &&
    baseValid &&
    deliveryValid &&
    acknowledged;

  const resetAndClose = () => {
    setBaseInput("");
    setDeliveryInput("");
    setAcknowledged(false);
    setErrors({});
    onOpenChange(false);
  };

  const handleSubmit = () => {
    if (!canSubmit || newBaseAmount === null || newDeliveryCharge === null) return;

    startTransition(async () => {
      const result = await recalculateAction(subscriptionId, {
        newEndDate,
        newBaseAmount,
        newDeliveryCharge,
        acknowledged: true,
      });

      if (result.success) {
        toast.success(
          `Subscription recalculated. New end date ${format(new Date(result.newEndDate), "MMM d, yyyy")}.`,
        );
        resetAndClose();
        router.refresh();
        return;
      }

      setErrors(result.fieldErrors ?? {});
      toast.error(result.error);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) {
          if (!next) resetAndClose();
          else onOpenChange(next);
        }
      }}
    >
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <OctagonX className="h-5 w-5" /> Recalculate Subscription Tenure
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-red-800">
                This shortens the subscription and is irreversible.
              </p>
              <p className="text-sm text-red-700">
                {planName} will remain <strong>ACTIVE</strong> and continue
                delivering through the new end date you choose below. It will
                automatically expire on that date, and the invoice is
                re-priced at the reduced tenure now.
              </p>
            </div>
          </div>

          {/* Existing pricing snapshot */}
          <div className="bg-zinc-50 border rounded-lg p-4 text-sm space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current Subscription
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Running" value={`${format(new Date(startsOn), "MMM d, yyyy")} → ${format(new Date(currentEffectiveEndOn), "MMM d, yyyy")}`} span2 />
              <Row label="Subscription charge" value={money(invoice.baseAmount)} />
              <Row label="GST" value={money(invoice.taxAmount)} />
              <Row label="Delivery charges" value={money(invoice.deliveryCharge)} />
              {invoice.miscCharge > 0 && (
                <Row label={invoice.miscChargeLabel ?? "Additional charges"} value={money(invoice.miscCharge)} />
              )}
              <Row label="Total payable" value={money(invoice.totalPayable)} bold />
              <Row label="Advance + payments paid" value={money(invoice.amountPaid)} bold />
            </div>
          </div>

          {/* New end date */}
          <div className="grid gap-2">
            <Label className="font-medium text-zinc-700">New End Date</Label>
            {rangeIsEmpty ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                This subscription&apos;s end date is too close to shorten any
                further under the 5 PM cutoff rule.
              </p>
            ) : (
              <>
                <Input
                  type="date"
                  min={minEndDate}
                  max={maxEndDate}
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  aria-invalid={Boolean(errors.newEndDate)}
                />
                <p className="text-xs text-muted-foreground">
                  Selectable between {format(new Date(minEndDate), "MMM d, yyyy")}{" "}
                  and {format(new Date(maxEndDate), "MMM d, yyyy")}.
                </p>
                {errors.newEndDate && (
                  <p className="text-xs text-destructive">{errors.newEndDate}</p>
                )}
              </>
            )}
          </div>

          {/* New charges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="font-medium text-zinc-700 text-sm">
                New Subscription Charge (₹, excl. GST)
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder={`Less than ${money(invoice.baseAmount)}`}
                value={baseInput}
                onChange={(e) => setBaseInput(e.target.value)}
                aria-invalid={Boolean(errors.newBaseAmount) || (baseInput !== "" && !baseValid)}
              />
              {baseInput !== "" && !baseValid && (
                <p className="text-xs text-destructive">
                  Must be less than {money(invoice.baseAmount)}.
                </p>
              )}
              {errors.newBaseAmount && (
                <p className="text-xs text-destructive">{errors.newBaseAmount}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label className="font-medium text-zinc-700 text-sm">
                New Delivery Charge (₹)
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder={`Less than ${money(invoice.deliveryCharge)}`}
                value={deliveryInput}
                onChange={(e) => setDeliveryInput(e.target.value)}
                aria-invalid={Boolean(errors.newDeliveryCharge) || (deliveryInput !== "" && !deliveryValid)}
              />
              {deliveryInput !== "" && !deliveryValid && (
                <p className="text-xs text-destructive">
                  Must be less than {money(invoice.deliveryCharge)}.
                </p>
              )}
              {errors.newDeliveryCharge && (
                <p className="text-xs text-destructive">{errors.newDeliveryCharge}</p>
              )}
            </div>
          </div>

          {/* Live recalculated breakup + settlement */}
          {newTotalPayable !== null && settlementAmount !== null && (
            <div className="rounded-lg border bg-background/80 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recalculated Breakup
              </p>
              <Row label="New subscription charge" value={money(newBaseAmount ?? 0)} />
              <Row label="GST (5%)" value={money(newTaxAmount)} />
              <Row label="New delivery charge" value={money(newDeliveryCharge ?? 0)} />
              {invoice.miscCharge > 0 && (
                <Row label={invoice.miscChargeLabel ?? "Additional charges"} value={money(invoice.miscCharge)} />
              )}
              <Row label="New total payable" value={money(newTotalPayable)} bold />

              <div
                className={`mt-2 rounded-lg p-3 text-sm font-semibold ${
                  settlementAmount > 0
                    ? "bg-amber-50 text-amber-900 border border-amber-200"
                    : settlementAmount < 0
                      ? "bg-blue-50 text-blue-900 border border-blue-200"
                      : "bg-emerald-50 text-emerald-900 border border-emerald-200"
                }`}
              >
                {settlementAmount > 0 && (
                  <>{money(settlementAmount)} has to be COLLECTED from the customer.</>
                )}
                {settlementAmount < 0 && (
                  <>{money(Math.abs(settlementAmount))} has to be REFUNDED to the customer.</>
                )}
                {settlementAmount === 0 && <>Exactly settled — nothing due either way.</>}
              </div>
            </div>
          )}

          {/* Acknowledgment */}
          <div className="flex items-start gap-2 rounded-lg border p-3 bg-zinc-50">
            <Checkbox
              id={`recalc-ack-${subscriptionId}`}
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor={`recalc-ack-${subscriptionId}`}
              className="text-sm font-normal text-zinc-700 leading-snug cursor-pointer"
            >
              I acknowledge the new settlement amount, have communicated it to
              the customer, and will process the settlement (collection or
              refund) on the Customer 360 dashboard after recalculating.
            </Label>
          </div>
        </div>

        <DialogFooter className="flex pt-4 border-t gap-2">
          <Button variant="outline" onClick={resetAndClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <OctagonX className="mr-2 h-4 w-4" />
            )}
            Recalculate the Subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  bold,
  span2,
}: {
  label: string;
  value: string;
  bold?: boolean;
  span2?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${span2 ? "col-span-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-bold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}
