import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { format } from "date-fns";

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

  // Admin client to bypass RLS for invoice generation
  const supabaseAdmin = createAdminClient();

  // Fetch core payment + subscription + profile
  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .select(
      `
      *,
      subscriptions (
        subscription_code,
        total_days,
        subscription_plans ( price, base_price )
      ),
      customer_profiles (
        user_id,
        users ( full_name, email, mobile ),
        addresses ( street_1, street_2, landmark, city, state, pincode, is_primary )
      )
    `,
    )
    .eq("id", paymentId)
    .single();

  if (error) {
    console.error("SERVER ERROR FETCHING INVOICE:", error);
  }

  if (error || !payment) {
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
  if (payment.customer_profiles?.user_id !== internalUser?.id) {
    return (
      <div className="p-10 text-center font-bold text-red-600">
        Unauthorized to view this invoice.
      </div>
    );
  }

  // Fetch add-on order separately
  const { data: addonOrder } = await supabaseAdmin
    .from("addon_orders")
    .select("id, total_amount, target_delivery_date, status")
    .eq("payment_id", paymentId)
    .maybeSingle();

  const profile = payment.customer_profiles;
  const sub = payment.subscriptions;
  const customerUser = profile?.users;

  const primaryAddress =
    profile?.addresses?.find((a: any) => a.is_primary) ||
    profile?.addresses?.[0];

  // ─── Pricing math ─────────────────────────────────────────────────────────
  // Priority: use stored breakdown columns → fallback to 5% reverse-calc for
  // older Razorpay rows that don't have them.

  const totalAmount = Number(payment.amount);

  let baseAmount: number;
  let taxAmountCalc: number;
  let taxPercentCalc: number;
  let discountAmount: number;

  if (payment.base_amount != null && payment.tax_amount != null) {
    // New rows with stored breakdown
    baseAmount = Number(payment.base_amount);
    taxAmountCalc = Number(payment.tax_amount);
    taxPercentCalc = Number(payment.tax_percent ?? 5);
    discountAmount = Number(payment.discount_amount ?? 0);
  } else {
    // Legacy fallback — reverse-calculate 5% GST
    const priceBeforeTax = totalAmount / 1.05;
    taxAmountCalc = totalAmount - priceBeforeTax;
    taxPercentCalc = 5;
    discountAmount = 0;

    const planPrice = sub?.subscription_plans?.price
      ? Number(sub.subscription_plans.price)
      : priceBeforeTax;
    discountAmount = Math.max(0, planPrice - priceBeforeTax);
    baseAmount = planPrice;
  }

  const finalPrice = baseAmount - discountAmount;

  // Payment method label
  const isManual = payment.payment_method === "MANUAL";
  const methodLabel = isManual ? "Manual" : payment.payment_method;

  // Status-driven labels
  const isPending = payment.status === "PENDING";
  const statusLabel = isPending ? "PAYMENT PENDING" : payment.status;
  const totalLabel = isPending ? "Amount Due" : "Total Paid";

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
            <p className="font-bold text-zinc-800">
              INV-{payment.id.split("-")[0].toUpperCase()}
            </p>
            <p className="text-sm text-zinc-500">
              Date: {format(new Date(payment.created_at), "dd MMM, yyyy")}
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
            <p className="font-bold text-zinc-900 text-lg">
              {customerUser?.full_name}
            </p>
            <p className="text-sm text-zinc-600">{customerUser?.email}</p>
            <p className="text-sm text-zinc-600">+91 {customerUser?.mobile}</p>

            {primaryAddress && (
              <div className="text-sm text-zinc-600 mt-3">
                <p>
                  {primaryAddress.street_1}
                  {primaryAddress.street_2
                    ? `, ${primaryAddress.street_2}`
                    : ""}
                </p>
                <p>
                  {primaryAddress.landmark
                    ? `${primaryAddress.landmark}, `
                    : ""}
                  {primaryAddress.city}
                </p>
                <p>
                  {primaryAddress.state}, {primaryAddress.pincode}
                </p>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
              {addonOrder ? "Order Details" : "Subscription Details"}
            </p>
            {addonOrder ? (
              <>
                <p className="font-bold text-zinc-900">Add-on Order</p>
                {addonOrder.target_delivery_date ? (
                  <p className="text-sm text-zinc-600">
                    Target delivery:{" "}
                    {format(
                      new Date(addonOrder.target_delivery_date),
                      "dd MMM, yyyy",
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="font-bold text-zinc-900">
                  Subscription ID — {sub?.subscription_code}
                </p>
                <p className="text-sm text-zinc-600">
                  {sub?.total_days} Days Meal Plan
                </p>
              </>
            )}
            <p className="text-sm text-zinc-500 mt-4">
              Payment Method:{" "}
              <span className="uppercase font-medium">{methodLabel}</span>
            </p>
            {isManual && payment.payment_reference && (
              <p className="text-sm text-zinc-500 mt-1">
                Reference:{" "}
                <span className="font-medium">{payment.payment_reference}</span>
              </p>
            )}
            {isManual && payment.payment_notes && (
              <p className="text-sm text-zinc-500 mt-1">
                Notes:{" "}
                <span className="font-medium">{payment.payment_notes}</span>
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
            <tr>
              <td className="py-5">
                <p className="font-bold text-zinc-900">
                  {addonOrder
                    ? "ArogyaDiet Add-on Purchase"
                    : `ArogyaDiet ${sub?.total_days} Days Standard Plan`}
                </p>
                <p className="text-sm text-zinc-500 mt-1">
                  {addonOrder
                    ? "Includes add-on items purchased from the shop."
                    : "Includes daily meal delivery, pause credits, and dynamic address routing."}
                </p>
              </td>
              <td className="py-5 text-right font-medium text-zinc-900">
                ₹{baseAmount.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-[60%] sm:w-1/2">
            <div className="flex justify-between py-2 text-sm text-zinc-600">
              <span>Base Price</span>
              <span>₹{baseAmount.toFixed(2)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between py-2 text-sm text-zinc-600">
                <span>Discount Applied</span>
                <span className="text-green-600">
                  -₹{discountAmount.toFixed(2)}
                </span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between py-2 text-sm text-zinc-800 font-bold border-t mt-2 pt-2">
                <span>Price After Discount</span>
                <span>₹{finalPrice.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between py-2 text-sm text-zinc-600 border-b pb-4 mb-2">
              <span>GST ({taxPercentCalc.toFixed(0)}%)</span>
              <span>₹{taxAmountCalc.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-2 text-xl font-black text-zinc-900">
              <span>{totalLabel}</span>
              <span>₹{totalAmount.toFixed(2)}</span>
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
