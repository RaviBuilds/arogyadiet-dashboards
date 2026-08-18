// src/shared/components/shared/invoice/InvoiceDocument.tsx
//
// Shared invoice document renderer. Renders the SAME printable invoice layout
// for every caller (customer self-service billing page, admin/franchise
// Customer 360 "Billing" tab, etc.) so the PDF customers download and the PDF
// admins can pull for a customer are always visually identical.
//
// This is a plain server-renderable component (no "use client"): it takes the
// already-resolved `InvoiceData` (see `@/lib/invoices`) and only handles
// presentation. The auto-print trigger is opt-in via `autoPrint` so embedding
// contexts that don't want the browser print dialog to pop automatically can
// omit it.

import { format } from "date-fns";
import type { InvoiceData } from "@/lib/invoices";
import { AutoPrintTrigger } from "./AutoPrintTrigger";

export function InvoiceDocument({
  invoiceData,
  autoPrint = true,
}: {
  invoiceData: InvoiceData;
  autoPrint?: boolean;
}) {
  const {
    invoiceNumber,
    date,
    isPending,
    paymentState,
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

  // Three-state payment position (meal-subscription-partial-payment).
  // `isPending` cannot express a part payment, and `paymentState` is derived in
  // `generateInvoiceData` from `payments.status` first — so a legacy PENDING
  // invoice (which has balance_due = 0) is never mislabelled as fully paid.
  const isPartiallyPaid = paymentState === "PARTIALLY_PAID";

  const statusLabel = isPending
    ? "PAYMENT PENDING"
    : isPartiallyPaid
      ? "PARTIAL PAYMENT PENDING"
      : "FULLY PAID";

  // On a part payment the figure below is what is OWED in total, not what was
  // collected — calling it "Total Paid" would overstate the payment by the
  // outstanding balance. The amount and its calculation are untouched; only the
  // word changes.
  const totalLabel = isPending
    ? "Amount Due"
    : isPartiallyPaid
      ? "Total Payable"
      : "Total Paid";

  const isManual = paymentMethod === "Manual";

  // Optional extra charges. Absent on invoices recorded before these were
  // itemised, so default to 0 and render nothing.
  const deliveryCharge = pricing.deliveryCharge ?? 0;
  const miscCharge = pricing.miscCharge ?? 0;

  // Payment position figures. Both default to 0 on legacy rows, which together
  // with the `amountPaid > 0` gate below keeps historical invoices byte-identical.
  const amountPaid = pricing.amountPaid ?? 0;
  const balanceDue = pricing.balanceDue ?? 0;
  const showPartialPaymentBlock = isPartiallyPaid && amountPaid > 0;

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 print:p-0 print:bg-white">
      {/* Auto-print for real invoices, never for an unpaid Proforma.
          A PARTIALLY_PAID invoice does print — it is a genuine document.
          Was an inline `<script>` tag, which React silently refuses to execute;
          see AutoPrintTrigger for the details. */}
      {autoPrint && !isPending && <AutoPrintTrigger />}

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
                isPending || isPartiallyPaid
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

        {/* ── Partial payment position ──
            Sits ABOVE the pricing breakup, which is deliberately left exactly as
            it was: the breakup states what the subscription costs, this states
            what has been settled against it. Only rendered for a part payment,
            so every fully-paid and legacy invoice is unchanged. */}
        {showPartialPaymentBlock && (
          <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50/70 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
              Payment Received
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex justify-between text-sm text-amber-900">
                <span>Total Amount Paid</span>
                <span className="font-bold">₹{amountPaid.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-amber-200 pt-2 text-sm text-amber-900">
                <span className="font-bold">Balance Remaining</span>
                <span className="font-black">₹{balanceDue.toFixed(2)}</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-amber-700">
              This invoice is not final. A balance of ₹{balanceDue.toFixed(2)} is
              still due on this subscription.
            </p>
          </div>
        )}

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-[60%] sm:w-1/2">
            <div className="flex justify-between py-2 text-sm text-zinc-600">
              <span>Base Price</span>
              <span>₹{pricing.baseAmount.toFixed(2)}</span>
            </div>
            {pricing.discountAmount > 0 && (
              <div className="py-2">
                <div className="flex justify-between text-sm text-zinc-600">
                  <span>Discount Applied</span>
                  <span className="text-green-600">
                    -₹{pricing.discountAmount.toFixed(2)}
                  </span>
                </div>
                {/* The customer was quoted ONE figure, but it is split across the
                    charge and its GST so the tax below is charged on the reduced
                    taxable value. Printing the total concession keeps the invoice
                    recognisable against what the admin told them at the counter.
                    Gated on grossDiscount, which is only set for a manual
                    onboarding discount — legacy and add-on rows are unaffected. */}
                {(pricing.grossDiscount ?? 0) > 0 && (
                  <p className="mt-0.5 text-[0.7rem] leading-snug text-zinc-500">
                    Total discount ₹{(pricing.grossDiscount ?? 0).toFixed(2)} — ₹
                    {pricing.discountAmount.toFixed(2)} on charges and ₹
                    {(pricing.discountTaxRelief ?? 0).toFixed(2)} on GST
                  </p>
                )}
              </div>
            )}
            {pricing.discountAmount > 0 && (
              <div className="flex justify-between py-2 text-sm text-zinc-800 font-bold border-t mt-2 pt-2">
                <span>Price After Discount</span>
                <span>₹{pricing.finalPrice.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between py-2 text-sm text-zinc-600">
              <span>GST ({pricing.taxPercent.toFixed(0)}%)</span>
              <span>₹{pricing.taxAmount.toFixed(2)}</span>
            </div>
            {/* Extra charges are itemised so the rows add up to the total. */}
            {deliveryCharge > 0 && (
              <div className="flex justify-between py-2 text-sm text-zinc-600">
                <span>Delivery Charges</span>
                <span>₹{deliveryCharge.toFixed(2)}</span>
              </div>
            )}
            {miscCharge > 0 && (
              <div className="flex justify-between py-2 text-sm text-zinc-600">
                {/* Shows the name the admin entered, not "Miscellaneous". */}
                <span>{pricing.miscChargeLabel || "Additional Charges"}</span>
                <span>₹{miscCharge.toFixed(2)}</span>
              </div>
            )}
            <div className="border-b pb-2 mb-2" />
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
