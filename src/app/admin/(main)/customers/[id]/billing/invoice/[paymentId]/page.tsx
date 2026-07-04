import { notFound } from "next/navigation";
import { generateInvoiceData } from "@/lib/invoices";
import { InvoiceDocument } from "@/shared/components/shared/invoice/InvoiceDocument";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export const revalidate = 0;

/**
 * Admin-side invoice viewer/PDF-download for a customer's payment. Renders the
 * exact same printable invoice as the customer-facing billing page (via the
 * shared `InvoiceDocument` + `generateInvoiceData`), scoped to the customer
 * (`[id]`) shown in the Customer 360 "Billing" tab. Admin access is gated by
 * the "customers" operations group, same as the rest of that dashboard.
 */
export default async function AdminInvoicePage({
  params,
}: {
  params: Promise<{ id: string; paymentId: string }>;
}) {
  const { id, paymentId } = await params;

  await guardAdminGroup("customers");

  const supabaseAdmin = createAdminClient();

  // Ensure the payment actually belongs to this customer before rendering
  // (defense in depth — prevents guessing another customer's payment id via
  // this admin-scoped URL).
  const { data: paymentCheck } = await supabaseAdmin
    .from("payments")
    .select("id, customer_profile_id")
    .eq("id", paymentId)
    .eq("customer_profile_id", id)
    .maybeSingle();

  if (!paymentCheck) {
    notFound();
  }

  const invoiceData = await generateInvoiceData(paymentId);

  if (!invoiceData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-10 text-center bg-zinc-50">
        <h2 className="text-2xl font-black text-red-600">
          Invoice not found or an error occurred.
        </h2>
        <p className="text-zinc-600 mt-2 font-medium">
          Please check your server console for the exact error log.
        </p>
      </div>
    );
  }

  return <InvoiceDocument invoiceData={invoiceData} />;
}
