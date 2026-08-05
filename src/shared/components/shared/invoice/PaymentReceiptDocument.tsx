// src/shared/components/shared/invoice/PaymentReceiptDocument.tsx
//
// Printable per-transaction Payment_Receipt. Mirrors InvoiceDocument's page
// shell, header, and print conventions so receipts and invoices look like
// the same family of document, while staying simpler: no email/address,
// no line-item table, no discount/GST breakdown — just the single
// transaction's amount, date, and its ADVANCE / PARTIAL / REFUND label.
//
// The transaction's `comment` and `remark` are internal operations notes and are
// intentionally omitted from this document.
//
// This is a plain server-renderable component (no "use client").
//
// Requirements: 10.1, 10.2, 10.4, 10.5

import { format } from "date-fns";
import type { PaymentReceiptData } from "@/types/accommodation";

export function PaymentReceiptDocument({
  receiptData,
  autoPrint = true,
}: {
  receiptData: PaymentReceiptData;
  autoPrint?: boolean;
}) {
  const {
    receiptNumber,
    transaction,
    typeLabel,
    customerName,
    customerMobile,
    stayType,
    stayDates,
  } = receiptData;

  const isRefund = transaction.transactionType === "REFUND";
  const headingLabel = isRefund ? "Refund Receipt" : "Payment Receipt";

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 print:p-0 print:bg-white">
      {autoPrint && (
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
              {headingLabel}
            </h2>
            <p className="font-bold text-zinc-800">{receiptNumber}</p>
            <p className="text-sm text-zinc-500">
              Date: {format(new Date(transaction.transactionDate), "dd MMM, yyyy")}
            </p>
            <div
              className={`mt-4 inline-block px-3 py-1 font-bold text-xs rounded-full uppercase tracking-wider border ${
                isRefund
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-green-50 text-green-700 border-green-200"
              }`}
            >
              {typeLabel}
            </div>
          </div>
        </div>

        {/* Customer & Stay Details */}
        <div className="grid grid-cols-2 gap-12 mb-12">
          <div>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
              {isRefund ? "Refunded To" : "Received From"}
            </p>
            <p className="font-bold text-zinc-900 text-lg">{customerName}</p>
            <p className="text-sm text-zinc-600">+91 {customerMobile}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
              Stay Details
            </p>
            <p className="font-bold text-zinc-900">{stayType}</p>
            <p className="text-sm text-zinc-600">
              {format(new Date(stayDates.startDate), "dd MMM, yyyy")} to{" "}
              {format(new Date(stayDates.endDate), "dd MMM, yyyy")}
            </p>
          </div>
        </div>

        {/* Transaction Amount */}
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
              {/* Comment and remark are internal operations notes (front-desk
                  context, reconciliation hints) and are deliberately NOT printed
                  here. The customer-facing receipt carries only the label,
                  amount, and date; the notes stay in the admin payment ledger. */}
              <td className="py-5">
                <p className="font-bold text-zinc-900">{typeLabel}</p>
              </td>
              <td className="py-5 text-right font-medium text-zinc-900">
                ₹{transaction.amount.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Total */}
        <div className="flex justify-end">
          <div className="w-[60%] sm:w-1/2">
            <div className="flex justify-between py-2 text-xl font-black text-zinc-900">
              <span>{isRefund ? "Refund Amount" : "Amount Received"}</span>
              <span>₹{transaction.amount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-16 left-16 right-16 border-t pt-8 text-center">
          <p className="text-sm font-bold text-zinc-800">
            Thank you for prioritizing your health with ArogyaDiet!
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            This is a computer-generated receipt and does not require a physical
            signature.
          </p>
        </div>
      </div>
    </div>
  );
}
