"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";

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
  onCheckedOut,
  onInvoiceGenerated,
}: StayCheckoutActionBarProps) {
  const [isCheckingOut, startCheckoutTransition] = useTransition();
  const [isGeneratingInvoice, startInvoiceTransition] = useTransition();

  const handleCheckout = () => {
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
      const result = await generateFinalStayInvoiceAction(stayId);

      if ("success" in result && result.success) {
        toast.success("Final invoice generated.");
        onInvoiceGenerated();
      } else if ("error" in result) {
        toast.error(result.error);
      }
    });
  };

  const showOutstandingHint =
    visibility.showMarkCheckedOut && !visibility.markCheckedOutEnabled;

  const outstandingLabel =
    remainingBalance > 0
      ? `Outstanding: ₹${remainingBalance.toLocaleString("en-IN")}`
      : remainingBalance < 0
        ? `Refund due before checkout: ₹${Math.abs(remainingBalance).toLocaleString("en-IN")}`
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
            onClick={handleCheckout}
            disabled={!visibility.markCheckedOutEnabled || isCheckingOut}
          >
            {isCheckingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Mark as Checked Out
          </Button>
          {showOutstandingHint && outstandingLabel && (
            <span className="text-sm text-muted-foreground">
              {outstandingLabel}
            </span>
          )}
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
