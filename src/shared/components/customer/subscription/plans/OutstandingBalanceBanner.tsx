import { IndianRupee } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import { OUTSTANDING_BALANCE_CUSTOMER_MESSAGE } from "@/types/subscriptionPayment";

/**
 * OutstandingBalanceBanner — shown when the customer still owes money on an
 * existing or previous subscription, which blocks buying a new one
 * (meal-subscription-partial-payment, Phase 5.1).
 *
 * Deliberately has NO call-to-action button, unlike `ProfileGateBanner`.
 * Balance collection happens at the counter, so offering a self-service "pay
 * now" route here would create a second, unreconciled path for money to arrive
 * and leave the ledger disagreeing with what was actually taken. The only
 * correct next step is to contact the admin.
 *
 * Rose rather than amber so it is visually distinct from the profile-incomplete
 * banner — the two can appear together, and they need different remedies.
 */
export function OutstandingBalanceBanner({
  outstandingAmount,
}: {
  /** Total still owed across every unsettled subscription. */
  outstandingAmount: number;
}) {
  return (
    <Alert className="reveal-rise rounded-3xl border-rose-200 bg-rose-50/80 p-5 text-rose-900 shadow-sm sm:p-6">
      <IndianRupee className="h-5 w-5 stroke-rose-600" />
      <AlertTitle className="font-semibold text-rose-900">
        Outstanding balance of ₹
        {outstandingAmount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </AlertTitle>
      <AlertDescription className="mt-2">
        <p className="text-sm leading-relaxed text-rose-800/90">
          {OUTSTANDING_BALANCE_CUSTOMER_MESSAGE}.
        </p>
      </AlertDescription>
    </Alert>
  );
}
