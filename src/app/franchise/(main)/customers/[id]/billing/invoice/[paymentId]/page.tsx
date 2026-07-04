import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { generateInvoiceData } from "@/lib/invoices";
import { InvoiceDocument } from "@/shared/components/shared/invoice/InvoiceDocument";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 0;

/**
 * Franchise-side invoice viewer/PDF-download for a customer's payment. Renders
 * the exact same printable invoice as the customer-facing billing page (via
 * the shared `InvoiceDocument` + `generateInvoiceData`), scoped to the calling
 * franchise so a FRANCHISE_ADMIN can only pull invoices for their own
 * customers.
 */
export default async function FranchiseInvoicePage({
  params,
}: {
  params: Promise<{ id: string; paymentId: string }>;
}) {
  const { id, paymentId } = await params;

  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    notFound();
  }

  const supabaseAdmin = createAdminClient();

  // Ensure the customer belongs to this franchise AND the payment belongs to
  // that same customer before rendering anything.
  const { data: customerCheck } = await supabaseAdmin
    .from("customer_profiles")
    .select("id")
    .eq("id", id)
    .eq("franchise_id", franchiseId)
    .maybeSingle();

  if (!customerCheck) {
    notFound();
  }

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
