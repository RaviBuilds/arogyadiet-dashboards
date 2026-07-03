import { createClient as createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { generateInvoiceData } from "@/lib/invoices";

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
      paymentCheck?.subscriptions?.customer_category === "KIT" &&
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
    !paymentCheck?.customer_profiles ||
    paymentCheck.customer_profiles.user_id !== internalUser?.id
  ) {
    return (
      <div className="p-10 text-center font-bold text-red-600">
        Unauthorized to view this invoice.
      </div>
    );
  }

  // Extract data from invoice
  const {
    invoiceNumber,
    date,
    isPending,
    customerName,
    customerEmail,
    customerMobile,
    address,
    subscriptionCode,
    lineItems,
    pricing,
    paymentMethod,
    paymentReference,
    paymentNotes,
  } = invoiceData;

  const statusLabel = isPending ? "PAYMENT PENDING" : invoiceData.status;
  const totalLabel = isPending ? "Amount Due" : "Total Paid";
  const isManual = paymentMethod === "Manual";

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 print:p-0 print:bg-white">
      {/* Auto-print trigger only for paid invoices */}
      {!isPending && (
        <script
          dangerouslySetInnerHTML={{
            __html: `window.onload = function() { window.print(); }`,
          }}
        />
      )}

      <div className="bg-white w-full max-w-[210mm] min-h-[297mm] shadow-lg print:shadow-none p-10 md:p-16 border print:border-none relative">
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-zinc-100 pb-8 mb-8">
          <div>
            <div className="mb-4">
              <img
                src="/logo.png"
                alt="ArogyaDiet Logo"
                className="h-16 w-auto object-contain"
              />
            </div>
            <p className="text-sm text-zinc-500 max-w-[320px] leading-relaxed">
              Plot No: A-6, Door no: 14/103/A/6, Gayatri nagar,
              <br />
              near JV hills, Kondapur, Hyderabad,
              <br />
              Telangana 500084
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-4xl font-black text-zinc-200 uppercase tracking-widest mb-2">
              {isPending ? "Proforma" : "Invoice"}
            </h2>
            <p className="font-bold text-zinc-800">{invoiceNumber}</p>
            <p className="text-sm text-zinc-500">
              Date: {format(new Date(date), "dd MMM, yyyy")}
            </p>
            <div
              className={`mt-4 inline-block px-3 py-1 font-bold text-xs rounded-full uppercase tracking-wider border ${
                isPending
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-green-50 text-green-700 border-green-200"
              }`}
            >
              {statusLabel}
            </div>
          </div>
        </div>

        {/* Customer & Subscription Details */}
        <div className="grid grid-cols-2 gap-12 mb-12">
          <div>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
              Billed To
            </p>
            <p className="font-bold text-zinc-900 text-lg">{customerName}</p>
            <p className="text-sm text-zinc-600">{customerEmail}</p>
            <p className="text-sm text-zinc-600">+91 {customerMobile}</p>

            {address && (
              <div className="text-sm text-zinc-600 mt-3">
                <p>
                  {address.street_1}
                  {address.street_2 ? `, ${address.street_2}` : ""}
                </p>
                <p>
                  {address.landmark ? `${address.landmark}, ` : ""}
                  {address.city}
                </p>
                <p>
                  {address.state}, {address.pincode}
                </p>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
              {lineItems[0]?.description.includes("Add-on")
                ? "Order Details"
                : "Subscription Details"}
            </p>
            {subscriptionCode && (
              <p className="font-bold text-zinc-900">
                Subscription ID — {subscriptionCode}
              </p>
            )}
            <p className="text-sm text-zinc-600">{lineItems[0]?.description}</p>
            <p className="text-sm text-zinc-500 mt-4">
              Payment Method:{" "}
              <span className="uppercase font-medium">{paymentMethod}</span>
            </p>
            {isManual && paymentReference && (
              <p className="text-sm text-zinc-500 mt-1">
                Reference: <span className="font-medium">{paymentReference}</span>
              </p>
            )}
            {isManual && paymentNotes && (
              <p className="text-sm text-zinc-500 mt-1">
                Notes: <span className="font-medium">{paymentNotes}</span>
              </p>
            )}
          </div>
        </div>

        {/* Pending notice banner */}
        {isPending && (
          <div className="mb-8 p-4 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm font-bold text-amber-800">
              Payment Pending
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              This subscription has been created but payment has not yet been
              collected. Please arrange payment at your earliest convenience.
            </p>
          </div>
        )}

        {/* Line Items */}
        <table className="w-full mb-12">
          <thead>
            <tr className="border-b-2 border-zinc-900 text-left">
              <th className="py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Description
              </th>
              <th className="py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y border-b-2 border-zinc-100">
            {lineItems.map((item, index) => (
              <tr key={index}>
                <td className="py-5">
                  <p className="font-bold text-zinc-900">{item.description}</p>
                  <p className="text-sm text-zinc-500 mt-1">{item.subtitle}</p>
                </td>
                <td className="py-5 text-right font-medium text-zinc-900">
                  ₹{item.amount.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-[60%] sm:w-1/2">
            <div className="flex justify-between py-2 text-sm text-zinc-600">
              <span>Base Price</span>
              <span>₹{pricing.baseAmount.toFixed(2)}</span>
            </div>
            {pricing.discountAmount > 0 && (
              <div className="flex justify-between py-2 text-sm text-zinc-600">
                <span>Discount Applied</span>
                <span className="text-green-600">
                  -₹{pricing.discountAmount.toFixed(2)}
                </span>
              </div>
            )}
            {pricing.discountAmount > 0 && (
              <div className="flex justify-between py-2 text-sm text-zinc-800 font-bold border-t mt-2 pt-2">
                <span>Price After Discount</span>
                <span>₹{pricing.finalPrice.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between py-2 text-sm text-zinc-600 border-b pb-4 mb-2">
              <span>GST ({pricing.taxPercent.toFixed(0)}%)</span>
              <span>₹{pricing.taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-2 text-xl font-black text-zinc-900">
              <span>{totalLabel}</span>
              <span>₹{pricing.totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-16 left-16 right-16 border-t pt-8 text-center">
          <p className="text-sm font-bold text-zinc-800">
            Thank you for prioritizing your health with ArogyaDiet!
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            This is a computer-generated invoice and does not require a physical
            signature.
          </p>
        </div>
      </div>
    </div>
  );
}
