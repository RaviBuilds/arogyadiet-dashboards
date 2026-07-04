import { createClient as createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { generateInvoiceData } from "@/lib/invoices";
import { InvoiceDocument } from "@/shared/components/shared/invoice/InvoiceDocument";

export const revalidate = 0;

export default async function InvoicePage({
  params,
}: {
  params: { id: string } | Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const paymentId = resolvedParams.id;

  // Standard auth check
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Generate invoice data using the unified invoice library
  const invoiceData = await generateInvoiceData(paymentId);

  if (!invoiceData) {
    // Check if this is due to unpaid KIT order (Requirement 10.4)
    const { data: paymentCheck } = await supabase
      .from("payments")
      .select(
        `
        status,
        subscriptions (
          customer_category
        )
      `
      )
      .eq("id", paymentId)
      .single();

    const isUnpaidKit =
      paymentCheck?.subscriptions?.[0]?.customer_category === "KIT" &&
      paymentCheck?.status !== "PAID";

    if (isUnpaidKit) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-10 text-center bg-zinc-50">
          <div className="max-w-md bg-white p-8 rounded-lg shadow-lg border border-amber-200">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-black text-amber-900 mb-2">
              Payment Pending
            </h2>
            <p className="text-zinc-600 font-medium">
              Invoice cannot be generated for unpaid KIT orders. Please complete
              payment to access your invoice.
            </p>
            <p className="text-sm text-zinc-500 mt-4">
              Contact support if you believe payment has been completed.
            </p>
          </div>
        </div>
      );
    }

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

  // Security: ensure auth user owns this payment
  const { data: internalUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  // Check if user has access (via admin client query in generateInvoiceData)
  // Re-fetch minimal payment data to verify ownership
  const { data: paymentCheck } = await supabase
    .from("payments")
    .select("customer_profiles(user_id)")
    .eq("id", paymentId)
    .single();

  if (
    !paymentCheck?.customer_profiles?.[0] ||
    paymentCheck.customer_profiles[0].user_id !== internalUser?.id
  ) {
    return (
      <div className="p-10 text-center font-bold text-red-600">
        Unauthorized to view this invoice.
      </div>
    );
  }

  return <InvoiceDocument invoiceData={invoiceData} />;
}
