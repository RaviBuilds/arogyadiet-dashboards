"use client";

import Link from "next/link";
import { format, isValid, parseISO } from "date-fns";
import {
  AlertCircle,
  Banknote,
  Calendar,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  FileText,
  Layers,
  Receipt,
  Utensils,
  Wallet,
} from "lucide-react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import type { SubscriptionPaymentSummary } from "@/services/SubscriptionPaymentService";
import { RecordSubscriptionPaymentForm } from "./RecordSubscriptionPaymentForm";
import { RecordSubscriptionRefundForm } from "./RecordSubscriptionRefundForm";

/**
 * SubscriptionPaymentSummaryCard — the payment position of ONE subscription, at
 * the top of the admin Customer 360 → "Subscription" tab.
 *
 * Deliberately mirrors the Accommodation tab's "Stay Overview" card
 * (`AccommodationTab.tsx`): same `border-primary/20 bg-primary/5` shell, same
 * status-badge palette, same icon-led detail grid, and the same boxed
 * Total / Paid / Remaining trio with a "% collected" progress bar. Two surfaces
 * answering the same question — what does this cost and what is still owed —
 * should not look like two different products.
 *
 * The figures arrive already resolved from payment STATE rather than from the raw
 * `amount_paid` column, so a legacy settled subscription reads as fully paid
 * instead of as never having paid anything.
 */

// Same palette and cases as AccommodationTab.getStatusBadgeClasses, so a status
// badge means the same thing in both tabs.
function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "border-emerald-500 text-emerald-600 bg-emerald-50";
    case "PENDING":
      return "border-amber-500 text-amber-600 bg-amber-50";
    case "EXPIRED":
      return "border-red-400 text-red-600 bg-red-50";
    case "STOPPED":
    case "CANCELLED":
      return "border-slate-300 text-slate-600 bg-slate-50";
    default:
      return "border-slate-300 text-slate-600 bg-slate-50";
  }
}

/**
 * Whole rupees, matching the accommodation card. The paise-accurate figures live
 * in the Price Breakup and Payments Collected rows below; the headline trio reads
 * better without trailing zeros.
 */
function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/** Paise-accurate, for rows that must reconcile against the invoice. */
function formatExact(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const date = parseISO(dateStr);
  return isValid(date) ? format(date, "dd MMM yyyy") : "N/A";
}

export function SubscriptionPaymentSummaryCard({
  summary,
  invoiceHrefBase,
  customerProfileId,
}: {
  summary: SubscriptionPaymentSummary;
  /**
   * Base path for the invoice viewer, e.g. `/customers/<id>/billing/invoice`.
   * Injected because the admin and franchise portals mount it at different routes.
   */
  invoiceHrefBase: string;
  /**
   * Enables the balance-collection form. Omit to render the card read-only.
   */
  customerProfileId?: string;
}) {
  const hasBalance = summary.balanceDue > 0;
  const hasRefund = summary.refundDue > 0;
  const unsettled = hasBalance || hasRefund;

  // Same formula as AccommodationTab: clamped, rounded to a whole percent.
  const paidPercent =
    summary.totalPayable > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round((summary.amountPaid / summary.totalPayable) * 100),
          ),
        )
      : 0;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">
            Subscription Overview
            {summary.planName ? ` — ${summary.planName}` : ""}
          </CardTitle>
          {summary.subscriptionStatus && (
            <Badge
              variant="outline"
              className={getStatusBadgeClasses(summary.subscriptionStatus)}
            >
              {summary.subscriptionStatus}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Mirrors the awaiting-checkout banner: name the thing the admin has to
            act on, and say what to do about it. */}
        {unsettled && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
            <div className="text-sm text-orange-900">
              {hasBalance ? (
                <>
                  <p className="font-medium">
                    {formatExact(summary.balanceDue)} still due on this
                    subscription.
                  </p>
                  <p className="mt-0.5 text-orange-800">
                    Collect the balance using Record Balance Payment below. A new
                    subscription cannot be added until it is settled, and this
                    invoice stays non-final while a balance remains.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">
                    {formatExact(summary.refundDue)} was over-collected on this
                    subscription.
                  </p>
                  <p className="mt-0.5 text-orange-800">
                    Process the refund before adding a new subscription.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Overview grid ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-start gap-3">
            <Utensils className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Plan</p>
              <p className="font-semibold">{summary.planName ?? "Custom Plan"}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Layers className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Category
              </p>
              <p className="font-semibold">
                {summary.customerCategory ?? "MEAL"}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Start Date
              </p>
              <p className="font-semibold">{formatDate(summary.startsOn)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                End Date
              </p>
              <p className="font-semibold">{formatDate(summary.endsOn)}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          {summary.totalDays != null && summary.totalDays > 0 && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {summary.totalDays} day{summary.totalDays !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {summary.subscriptionCode && (
            <Badge variant="secondary" className="font-mono">
              {summary.subscriptionCode}
            </Badge>
          )}
          {summary.paymentMethod && (
            <Badge variant="secondary">{summary.paymentMethod}</Badge>
          )}
        </div>

        {/* ── Payment summary ── */}
        <div className="mt-4 border-t pt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Payment Summary
            </p>
            {summary.isFullyPaid ? (
              <Badge
                variant="outline"
                className="border-emerald-500 bg-emerald-50 text-emerald-700"
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Fully Paid
              </Badge>
            ) : hasRefund ? (
              <Badge
                variant="outline"
                className="border-blue-500 bg-blue-50 text-blue-700"
              >
                <AlertCircle className="mr-1 h-3.5 w-3.5" />
                Refund Due
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500 bg-amber-50 text-amber-700"
              >
                <AlertCircle className="mr-1 h-3.5 w-3.5" />
                Balance Due
              </Badge>
            )}
          </div>

          <div className="rounded-lg border bg-background/80 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
              <div className="flex items-start gap-3 sm:pr-4">
                <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Total Payable
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatRupees(summary.totalPayable)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 sm:px-4">
                <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Total Paid
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-emerald-700">
                    {formatRupees(summary.amountPaid)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 sm:pl-4">
                <CircleDollarSign
                  className={`mt-0.5 h-5 w-5 shrink-0 ${
                    summary.isFullyPaid ? "text-emerald-600" : "text-amber-600"
                  }`}
                />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Remaining Balance
                  </p>
                  <p
                    className={`text-lg font-semibold tabular-nums ${
                      summary.isFullyPaid
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }`}
                  >
                    {formatRupees(summary.balanceDue)}
                  </p>
                </div>
              </div>
            </div>

            {/* Paid-vs-total progress */}
            <div className="mt-4">
              <div
                role="progressbar"
                aria-label="Subscription payment collected"
                aria-valuenow={paidPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    summary.isFullyPaid ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                  style={{ width: `${paidPercent}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {paidPercent}% collected
                {hasRefund && (
                  <span className="font-medium text-blue-700">
                    {" "}
                    · Refund due {formatRupees(summary.refundDue)}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* ── Price breakup — the same lines the invoice prints, so the two
            reconcile row by row. ── */}
        <div className="mt-4 border-t pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Price Breakup
          </p>
          <div className="overflow-hidden rounded-lg border bg-background/80">
            <div className="divide-y">
              <BreakupRow label="Plan base price" amount={summary.baseAmount} />
              {summary.discountAmount > 0 && (
                <BreakupRow
                  label="Discount"
                  amount={-summary.discountAmount}
                  tone="positive"
                />
              )}
              <BreakupRow label="GST" amount={summary.taxAmount} />
              {summary.deliveryCharge > 0 && (
                <BreakupRow
                  label="Delivery charges"
                  amount={summary.deliveryCharge}
                />
              )}
              {summary.miscCharge > 0 && (
                /* The admin-entered name, verbatim — never "Miscellaneous". */
                <BreakupRow
                  label={summary.miscChargeLabel ?? "Additional charges"}
                  amount={summary.miscCharge}
                />
              )}
              <div className="flex items-center justify-between bg-muted/40 px-4 py-3">
                <span className="text-sm font-bold">Total Payable</span>
                <span className="text-sm font-black tabular-nums">
                  {formatExact(summary.totalPayable)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Payments collected ──
            Only when a ledger exists. A subscription paid in full at onboarding
            has no ledger rows by design, and an empty table would read as
            missing data rather than as "nothing to instal". */}
        {summary.transactions.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Payments Collected
            </p>
            <div className="overflow-hidden rounded-lg border bg-background/80">
              <div className="divide-y">
                {summary.transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-start justify-between gap-4 px-4 py-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {TRANSACTION_LABELS[tx.transactionType] ??
                            tx.transactionType}
                        </span>
                        {tx.paymentMethod && (
                          <Badge variant="outline" className="text-[0.6rem]">
                            {tx.paymentMethod}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(tx.transactionDate)}
                        {tx.paymentReference ? ` · Ref ${tx.paymentReference}` : ""}
                        {tx.comment ? ` · ${tx.comment}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-bold tabular-nums ${
                        tx.transactionType === "REFUND"
                          ? "text-blue-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {tx.transactionType === "REFUND" ? "−" : "+"}
                      {formatExact(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Collect the balance ──
            Only while money is actually owed, so the UI offers no route to
            over-collecting. */}
        {hasBalance && customerProfileId && (
          <div className="mt-4 border-t pt-4">
            <RecordSubscriptionPaymentForm
              subscriptionId={summary.subscriptionId}
              customerProfileId={customerProfileId}
              balanceDue={summary.balanceDue}
              amountPaid={summary.amountPaid}
            />
          </div>
        )}

        {/* ── Process a refund ──
            Only while the customer was over-collected (meal-subscription-early
            -closure). The amount is locked to the live excess — never
            admin-typed — see RecordSubscriptionRefundForm. */}
        {hasRefund && customerProfileId && (
          <div className="mt-4 border-t pt-4">
            <RecordSubscriptionRefundForm
              subscriptionId={summary.subscriptionId}
              customerProfileId={customerProfileId}
              refundDue={summary.refundDue}
            />
          </div>
        )}

        {/* ── Invoice ── */}
        {summary.paymentId && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {unsettled
                ? "This invoice is not final while a balance remains."
                : "Fully paid — this is the final invoice."}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href={`${invoiceHrefBase}/${summary.paymentId}`}>
                <FileText className="mr-2 h-4 w-4" />
                View Invoice
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const TRANSACTION_LABELS: Record<string, string> = {
  ADVANCE: "Advance at onboarding",
  PARTIAL_BALANCE_PAYMENT: "Balance payment",
  REFUND: "Refund",
};

function BreakupRow({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: number;
  tone?: "positive";
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-medium tabular-nums ${
          tone === "positive" ? "text-emerald-700" : ""
        }`}
      >
        {amount < 0 ? `−${formatExact(Math.abs(amount))}` : formatExact(amount)}
      </span>
    </div>
  );
}
