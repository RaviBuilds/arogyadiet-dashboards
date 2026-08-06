"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";

import { markStayCheckedOutAction } from "@/actions/stayActions";
import { generateFinalStayInvoiceAction } from "@/actions/stayInvoiceActions";
import type { StayActionVisibility } from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StayCheckoutActionBarProps {
  stayId: string;
  visibility: StayActionVisibility;
  remainingBalance: number;
  finalInvoiceError: string | null;
  /** The stay's inclusive end date (YYYY-MM-DD), named in the disabled hint. */
  endDate?: string;
  onCheckedOut: (result: {
    status: "FINISHED";
    invoiceStatus: string;
  }) => void;
  onInvoiceGenerated: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invoiceStatusMessage(invoiceStatus: string): string {
  switch (invoiceStatus) {
    case "GENERATED":
      return "Checked out — invoice generated.";
    case "PENDING_RETRY":
      return "Checked out — invoice generation pending, retry available.";
    default:
      return "Checked out.";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Checkout and final-invoice affordances for a Stay_Entry.
 *
 * "Mark as Checked Out" and "Generate Final Invoice" are mutually exclusive
 * by construction of `StayActionVisibility` (Req 7.1, 7.2, 9.1, 9.2, 9.4);
 * this component trusts that invariant rather than re-deriving it. A retry
 * affordance for a failed invoice generation is shown independently of
 * either action, driven purely by `finalInvoiceError`.
 *
 * Requirements: 7.1, 7.2, 8.7, 9.1, 9.2, 9.4
 */
export function StayCheckoutActionBar({
  stayId,
  visibility,
  remainingBalance,
  finalInvoiceError,
  endDate,
  onCheckedOut,
  onInvoiceGenerated,
}: StayCheckoutActionBarProps) {
  const [isCheckingOut, startCheckoutTransition] = useTransition();
  const [isGeneratingInvoice, startInvoiceTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleCheckout = () => {
    setConfirmOpen(false);
    startCheckoutTransition(async () => {
      const result = await markStayCheckedOutAction(stayId);

      if ("success" in result && result.success) {
        toast.success(invoiceStatusMessage(result.data.invoiceStatus));
        onCheckedOut(result.data);
      } else if ("error" in result) {
        toast.error(result.error);
      }
    });
  };

  const handleGenerateInvoice = () => {
    startInvoiceTransition(async () => {
      // Both call sites of this handler (the Backdated_Stay "Generate Final
      // Invoice" action and the "Invoice generation failed — retry" button)
      // are explicit admin-initiated triggers, so both mark the request as
      // a manual retrigger (Req 8.9, 8.10).
      const result = await generateFinalStayInvoiceAction(stayId, {
        manualRetrigger: true,
      });

      if ("success" in result && result.success) {
        toast.success("Final invoice generated.");
        onInvoiceGenerated();
      } else if ("error" in result) {
        toast.error(result.error);
      }
    });
  };

  // Why the button is visible but disabled. The balance wording keeps its
  // existing shape; the date wording names the end date so the admin knows
  // exactly when checkout opens, and points at Recalculate Stay as the
  // alternative for a guest leaving sooner.
  const blockedLabel =
    visibility.markCheckedOutBlockedReason === "BALANCE_OUTSTANDING"
      ? remainingBalance > 0
        ? `Outstanding: ₹${remainingBalance.toLocaleString("en-IN")}`
        : remainingBalance < 0
          ? `Refund due before checkout: ₹${Math.abs(remainingBalance).toLocaleString("en-IN")}`
          : null
      : visibility.markCheckedOutBlockedReason === "BEFORE_END_DATE"
        ? endDate
          ? `Opens on ${endDate} — use Recalculate Stay to shorten the stay, then check out on the new end date`
          : "Opens on the stay's end date — use Recalculate Stay to shorten the stay, then check out on the new end date"
        : null;

  const nothingToShow =
    !visibility.showMarkCheckedOut &&
    !visibility.showGenerateFinalInvoice &&
    !finalInvoiceError;

  if (nothingToShow) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {visibility.showMarkCheckedOut && (
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!visibility.markCheckedOutEnabled || isCheckingOut}
          >
            {isCheckingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Mark as Checked Out
          </Button>
          {blockedLabel && (
            <span className="text-sm text-muted-foreground">
              {blockedLabel}
            </span>
          )}

          {/* Checkout is irreversible and generates the final invoice, so it
              takes an explicit confirmation rather than firing on first click. */}
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  You are going to mark the customer as Checked Out. Are you
                  sure?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This closes the stay{endDate ? ` ending ${endDate}` : ""} and
                  generates the final invoice. It cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isCheckingOut}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleCheckout}
                  disabled={isCheckingOut}
                >
                  I confirm and process checkout
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {visibility.showGenerateFinalInvoice && (
        <Button
          onClick={handleGenerateInvoice}
          disabled={isGeneratingInvoice}
        >
          {isGeneratingInvoice && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Generate Final Invoice
        </Button>
      )}

      {finalInvoiceError && (
        <Button
          variant="outline"
          size="sm"
          className="text-red-600 border-red-300 hover:bg-red-50"
          onClick={handleGenerateInvoice}
          disabled={isGeneratingInvoice}
        >
          {isGeneratingInvoice && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Invoice generation failed — retry
        </Button>
      )}
    </div>
  );
}
