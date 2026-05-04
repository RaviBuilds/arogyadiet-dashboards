"use client";

import { format } from "date-fns";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  ReceiptText,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";

type Payment = {
  id: string;
  amount: number | string;
  payment_method: string;
  status: string;
  created_at: string;
};

type ActiveSubscription = {
  subscription_code: string;
  effective_end_on: string | null;
  total_days: number | null;
  consumed_days: number | null;
} | null;

type BillingClientProps = {
  payments: Payment[];
  activeSub: ActiveSubscription;
};

const successfulStatuses = new Set(["PAID", "SUCCESS", "CAPTURED"]);

export function BillingClient({ payments, activeSub }: BillingClientProps) {
  const handleDownloadInvoice = (paymentId: string) => {
    window.open(`/subscription/manage/billing/invoice/${paymentId}`, "_blank");
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div>
        <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">
          Billing & Invoices
        </h2>
        <p className="text-muted-foreground mt-1">
          Manage your payment history and download tax invoices.
        </p>
      </div>

      {activeSub && (
        <Card className="bg-zinc-900 text-white border-none shadow-lg overflow-hidden relative">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <CreditCard className="h-32 w-32" />
          </div>
          <CardContent className="p-6 md:p-8 relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <p className="text-zinc-400 text-sm font-medium uppercase tracking-wider mb-1">
                Current Active Plan
              </p>
              <h3 className="text-2xl md:text-3xl font-black">
                {activeSub.subscription_code}
              </h3>
              <p className="text-zinc-300 mt-2 text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                Valid until{" "}
                {activeSub.effective_end_on
                  ? format(new Date(activeSub.effective_end_on), "dd MMM, yyyy")
                  : "N/A"}
              </p>
            </div>
            <div className="bg-white/10 p-4 rounded-xl border border-white/10 backdrop-blur-sm">
              <p className="text-zinc-400 text-xs uppercase tracking-wider mb-1">
                Remaining Days
              </p>
              <p className="text-3xl font-black text-white">
                {(activeSub.total_days || 0) - (activeSub.consumed_days || 0)}{" "}
                <span className="text-sm font-normal text-zinc-400">
                  / {activeSub.total_days || 0}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm border-zinc-200">
        <CardHeader className="border-b border-zinc-100 bg-zinc-50/50">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ReceiptText className="h-5 w-5 text-primary" /> Payment History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <ReceiptText className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>No payment history found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b">
                  <tr>
                    <th className="px-6 py-4 font-bold tracking-wider">Date</th>
                    <th className="px-6 py-4 font-bold tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-4 font-bold tracking-wider">
                      Method
                    </th>
                    <th className="px-6 py-4 font-bold tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 font-bold tracking-wider text-right">
                      Invoice
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {payments.map((payment) => {
                    const isSuccessful = successfulStatuses.has(
                      payment.status,
                    );

                    return (
                      <tr
                        key={payment.id}
                        className="hover:bg-zinc-50/50 transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-zinc-900">
                          {format(new Date(payment.created_at), "dd MMM yyyy")}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap font-bold">
                          ₹{Number(payment.amount).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider">
                            {payment.payment_method}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={cn(
                              "px-2.5 py-1 rounded-full text-xs font-bold flex items-center w-fit gap-1 uppercase tracking-wider",
                              isSuccessful
                                ? "bg-green-50 text-green-700 border border-green-200"
                                : payment.status === "PENDING"
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-red-50 text-red-700 border border-red-200",
                            )}
                          >
                            {isSuccessful ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                            {payment.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          {isSuccessful && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDownloadInvoice(payment.id)}
                              className="font-bold text-primary hover:text-primary hover:bg-primary/5"
                            >
                              <Download className="h-4 w-4 mr-2" /> PDF
                              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
