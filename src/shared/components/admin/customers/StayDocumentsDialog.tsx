"use client";

// src/shared/components/admin/customers/StayDocumentsDialog.tsx
//
// "Invoices" cell on the Accommodation History table: a trigger that opens the
// full set of money documents for ONE stay — a receipt for the advance and each
// partial/balance payment, the Refund_Invoice for each refund, and the stay's
// Final_Consolidated_Invoice — each openable and printable on its own.
//
// The ledger is fetched only when the dialog is opened, not when the history
// table renders. A customer with several stays would otherwise fire one ledger
// query per row on every visit to the tab, for documents nobody asked to see.

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Download, FileText, Loader2, Receipt } from "lucide-react";

import { getStayPaymentLedgerAction } from "@/actions/stayPaymentActions";
import { buildStayDocumentRows } from "@/lib/accommodation/paymentHistory";
import type { StayDocumentRow } from "@/lib/accommodation/paymentHistory";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";

interface StayDocumentsDialogProps {
  stayId: string;
  /** Shown in the dialog header so the admin knows which stay they opened. */
  stayLabel: string;
  stayPeriod: string;
}

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/** Receipts and invoices are visually distinct — one is money in, one is a tax document. */
function kindBadgeClasses(kind: StayDocumentRow["kind"]): string {
  switch (kind) {
    case "RECEIPT":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "REFUND_INVOICE":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "FINAL_INVOICE":
      return "border-primary/30 bg-primary/10 text-primary";
  }
}

export function StayDocumentsDialog({
  stayId,
  stayLabel,
  stayPeriod,
}: StayDocumentsDialogProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<StayDocumentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getStayPaymentLedgerAction(stayId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setRows(
        buildStayDocumentRows(result.data.transactions, {
          customerProfileId: result.data.stay.customerProfileId,
          finalInvoicePaymentId: result.data.stay.finalInvoicePaymentId,
          paymentAmount: result.data.stay.paymentAmount,
        })
      );
    } catch {
      setError("Unable to load invoices for this stay.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    // Refetch on every open rather than caching: an admin who records a payment
    // and reopens this must see the new receipt, not a stale list.
    if (nextOpen) {
      void load();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs"
          title="Show all invoices and receipts for this stay"
        >
          <Receipt className="h-3.5 w-3.5" />
          Show all
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invoices &amp; Receipts</DialogTitle>
          <DialogDescription>
            Every document for {stayLabel} · {stayPeriod}. Each opens in a new tab
            ready to print or save as PDF.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex min-h-[160px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && error && (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-2">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && rows && rows.length === 0 && (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-2">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No payments have been recorded against this stay yet.
            </p>
          </div>
        )}

        {!loading && !error && rows && rows.length > 0 && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={kindBadgeClasses(row.kind)}
                    >
                      {row.typeLabel}
                    </Badge>
                    {row.date && (
                      <span className="text-xs text-muted-foreground">
                        {row.date}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.reference}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-semibold tabular-nums">
                    {formatRupees(row.amount)}
                  </span>
                  <Button variant="outline" size="icon" className="h-8 w-8" asChild>
                    <Link
                      href={row.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open and download"
                    >
                      <Download className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
