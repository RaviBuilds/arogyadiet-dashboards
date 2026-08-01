import { notFound } from "next/navigation";
import { PaymentReceiptDocument } from "@/shared/components/shared/invoice/PaymentReceiptDocument";
import { guardAdminGroup } from "@/lib/auth/adminAccess";
import { getStayPaymentReceiptAction } from "@/actions/stayPaymentActions";

export const revalidate = 0;

/**
 * Admin-side payment receipt viewer/PDF-download for a single stay payment
 * transaction. Renders the printable `PaymentReceiptDocument`, scoped to the
 * customer (`[id]`) shown in the Customer 360 "Billing" tab. Admin access is
 * gated by the "customers" operations group, same as the sibling invoice route.
 */
export default async function StayPaymentReceiptPage({
  params,
}: {
  params: Promise<{ id: string; transactionId: string }>;
}) {
  const { id, transactionId } = await params;

  await guardAdminGroup("customers");

  const result = await getStayPaymentReceiptAction(transactionId);

  if ("error" in result) {
    notFound();
  }

  // Defense in depth: the transaction must belong to the customer named in
  // the URL, not just exist (prevents guessing another customer's
  // transaction id via this admin-scoped URL — mirrors the sibling invoice
  // route's ownership check).
  if (result.data.transaction.customerProfileId !== id) {
    notFound();
  }

  return <PaymentReceiptDocument receiptData={result.data} />;
}
