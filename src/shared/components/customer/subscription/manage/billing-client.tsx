"use client";

import { format } from "date-fns";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  ReceiptText,
  Wallet,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { cn } from "@/lib/utils";

type Payment = {
  id: string;
  amount: number | string;
  payment_method: string;
  status: string;
  created_at: string;
  paid_at?: string | null;
  invoice_type?: "ADDON" | "SUBSCRIPTION" | null;
  base_amount?: number | null;
  tax_percent?: number | null;
  tax_amount?: number | null;
  discount_amount?: number | null;
  payment_reference?: string | null;
  payment_notes?: string | null;
};

type ActiveSubscription = {
  subscription_code: string;
  effective_end_on: string | null;
  total_days: number | null;
} | null;

type BillingClientProps = {
  payments: Payment[];
  activeSub: ActiveSubscription;
};

const successfulStatuses = new Set(["PAID", "SUCCESS", "CAPTURED"]);

function formatPaymentMethod(method: string): string {
  if (method === "MANUAL") return "Manual";
  if (method === "RAZORPAY") return "Razorpay";
  return method;
}

export function BillingClient({ payments, activeSub }: BillingClientProps) {
  const handleViewInvoice = (paymentId: string) => {
    window.open(`/subscription/manage/billing/invoice/${paymentId}`, "_blank");
  };

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8">
      {/* Page header — same IconChip + title anchor used across every
          customer page (Stay History, Shop Orders, Health Report). */}
      <div className="reveal-rise flex items-start gap-3">
        <IconChip icon={Wallet} tone="coral" size="lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Billing & Invoices
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your payment history and download tax invoices.
          </p>
        </div>
      </div>

      {activeSub && (
        <Card
          className="reveal-rise rounded-2xl border border-slate-200 bg-white shadow-sm"
          style={{ ["--reveal-delay" as string]: "150ms" }}
        >
          <CardHeader className="border-b border-slate-100 bg-emerald-50/40 px-6 py-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <CalendarDays className="h-5 w-5 text-emerald-600" />
              Current Active Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <h3 className="mb-1 text-xl font-semibold text-slate-900">
                  {activeSub.subscription_code}
                </h3>
                <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Valid until{" "}
                  {activeSub.effective_end_on
                    ? format(
                        new Date(activeSub.effective_end_on),
                        "MMM do, yyyy",
                      )
                    : "N/A"}
                </p>
              </div>
              <div className="flex gap-6 sm:gap-8">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Total Days
                  </p>
                  <p className="text-2xl font-semibold text-slate-900">
                    {activeSub.total_days ?? 0}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card
        className="reveal-rise rounded-2xl border border-slate-200 bg-white shadow-sm"
        style={{ ["--reveal-delay" as string]: "300ms" }}
      >
        <CardHeader className="border-b border-slate-100 bg-emerald-50/40 px-6 py-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ReceiptText className="h-5 w-5 text-emerald-600" /> Payment History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                <ReceiptText className="h-8 w-8 text-emerald-400" />
              </div>
              <p className="font-medium text-slate-500">
                No payment history found.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-100 bg-emerald-50/40 text-xs uppercase tracking-wider text-emerald-700/80">
                    <tr>
                      <th className="px-6 py-3 font-semibold">Date</th>
                      <th className="px-6 py-3 font-semibold">Amount</th>
                      <th className="px-6 py-3 font-semibold">Method</th>
                      <th className="px-6 py-3 font-semibold">Status</th>
                      <th className="px-6 py-3 text-right font-semibold">
                        Invoice
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((payment) => {
                      const isSuccessful = successfulStatuses.has(
                        payment.status,
                      );
                      const isPendingManual =
                        payment.status === "PENDING" &&
                        payment.payment_method === "MANUAL";

                      const invoiceTypeLabel =
                        payment.invoice_type === "ADDON"
                          ? "Shop Order"
                          : payment.invoice_type === "SUBSCRIPTION"
                            ? "Meal Subscription"
                            : null;

                      const showInvoiceButton = isSuccessful || isPendingManual;

                      return (
                        <tr
                          key={payment.id}
                          className="transition-colors duration-200 hover:bg-emerald-50/30"
                        >
                          <td className="whitespace-nowrap px-6 py-4 font-medium text-slate-900">
                            {format(new Date(payment.created_at), "MMM do, yyyy")}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 font-semibold text-slate-900">
                            ₹{Number(payment.amount).toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <div className="flex flex-col gap-1">
                              <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                                {formatPaymentMethod(payment.payment_method)}
                              </span>
                              {invoiceTypeLabel ? (
                                <span className="text-xs font-medium text-slate-500">
                                  {invoiceTypeLabel}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <StatusPill status={payment.status} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-right">
                            {showInvoiceButton && (
                              <InvoiceButton
                                isPendingManual={isPendingManual}
                                onClick={() => handleViewInvoice(payment.id)}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile card stack — one self-contained card per payment,
                  same pattern used for Shop Orders on small screens. */}
              <div className="flex flex-col gap-3 p-4 md:hidden">
                {payments.map((payment) => {
                  const isSuccessful = successfulStatuses.has(payment.status);
                  const isPendingManual =
                    payment.status === "PENDING" &&
                    payment.payment_method === "MANUAL";
                  const invoiceTypeLabel =
                    payment.invoice_type === "ADDON"
                      ? "Shop Order"
                      : payment.invoice_type === "SUBSCRIPTION"
                        ? "Meal Subscription"
                        : null;
                  const showInvoiceButton = isSuccessful || isPendingManual;

                  return (
                    <div
                      key={payment.id}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-emerald-50/40 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            ₹{Number(payment.amount).toFixed(2)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {format(new Date(payment.created_at), "MMM do, yyyy")}
                          </p>
                        </div>
                        <StatusPill status={payment.status} />
                      </div>
                      <div className="space-y-2 px-4 py-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">Method</span>
                          <span className="font-medium text-slate-700">
                            {formatPaymentMethod(payment.payment_method)}
                          </span>
                        </div>
                        {invoiceTypeLabel ? (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-500">Type</span>
                            <span className="font-medium text-slate-700">
                              {invoiceTypeLabel}
                            </span>
                          </div>
                        ) : null}
                        {showInvoiceButton && (
                          <div className="pt-1">
                            <InvoiceButton
                              isPendingManual={isPendingManual}
                              onClick={() => handleViewInvoice(payment.id)}
                              fullWidth
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isSuccessful = successfulStatuses.has(status);
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ring-1 ring-inset",
        isSuccessful
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : status === "PENDING"
            ? "bg-amber-50 text-amber-700 ring-amber-200"
            : "bg-red-50 text-red-700 ring-red-200",
      )}
    >
      {isSuccessful ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <Clock className="h-3 w-3" />
      )}
      {isSuccessful ? "Paid" : status}
    </span>
  );
}

function InvoiceButton({
  isPendingManual,
  onClick,
  fullWidth = false,
}: {
  isPendingManual: boolean;
  onClick: () => void;
  fullWidth?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn(
        "rounded-full font-semibold transition-all duration-200",
        fullWidth && "w-full justify-center",
        isPendingManual
          ? "border-amber-200 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
          : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800",
      )}
    >
      {isPendingManual ? (
        <>
          <FileText className="mr-2 h-4 w-4" /> View
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </>
      ) : (
        <>
          <Download className="mr-2 h-4 w-4" /> PDF
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </>
      )}
    </Button>
  );
}
