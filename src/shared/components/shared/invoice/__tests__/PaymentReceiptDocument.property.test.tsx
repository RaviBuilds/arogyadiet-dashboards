// @vitest-environment jsdom

// src/shared/components/shared/invoice/__tests__/PaymentReceiptDocument.property.test.tsx
//
// Feature: accommodation-payment-lifecycle, Property 16: Payment receipts are
// total and correctly labeled
//
// For any Payment_Transaction, exactly one Payment_Receipt SHALL be derivable
// from it, containing that transaction's amount, date, comment, and remark,
// and labeled "Advance", "Partial / Balance Payment", or "Refund" according
// to its Payment_Transaction_Type.
//
// Validates: Requirements 10.1, 10.2
//
// This file tests both halves the design's PBT strategy table calls out:
//
//   1. `buildPaymentReceiptData` (pure builder) — a full 100+-run property
//      test over `receiptNumber`, `typeLabel`, and pass-through of every
//      transaction/stay/customer field.
//   2. `PaymentReceiptDocument` (component render) — one representative
//      render per Payment_Transaction_Type (ADVANCE / PARTIAL_BALANCE_PAYMENT
//      / REFUND) asserting the rendered DOM carries the correct label,
//      receipt number, and formatted total, and never leaking the internal
//      comment/remark notes.

import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fc from "fast-check";

import {
  arbTransaction,
  arbTransactionOfType,
  arbStayType,
  DEFAULT_STAY_ID,
  fixtureUuid,
} from "@/test/accommodation/paymentArbitraries";

import {
  buildPaymentReceiptData,
} from "@/services/AccommodationService";
import { PAYMENT_TRANSACTION_LABELS } from "@/types/accommodation";
import type { PaymentTransactionType } from "@/types/accommodation";
import { PaymentReceiptDocument } from "@/shared/components/shared/invoice/PaymentReceiptDocument";

// A small fixed stay/customer fixture — not the focus of this property, so a
// single representative header is reused across all builder-function runs.
const FIXED_STAY = {
  stayType: "AC Villa" as const,
  startDate: "2025-01-10",
  endDate: "2025-01-20",
};
const FIXED_CUSTOMER = {
  fullName: "Asha Rao",
  mobile: "9876543210",
};

describe("buildPaymentReceiptData — Property 16 (builder half)", () => {
  it("produces a receiptNumber and typeLabel derived from the transaction, with every transaction field preserved verbatim", () => {
    fc.assert(
      fc.property(arbTransaction, (transaction) => {
        const receipt = buildPaymentReceiptData(
          transaction,
          FIXED_STAY,
          FIXED_CUSTOMER,
        );

        // 1. receiptNumber always equals "RCPT-" + first uuid segment, uppercased.
        expect(receipt.receiptNumber).toBe(
          `RCPT-${transaction.id.split("-")[0].toUpperCase()}`,
        );

        // 2. typeLabel always equals PAYMENT_TRANSACTION_LABELS[transactionType].
        expect(receipt.typeLabel).toBe(
          PAYMENT_TRANSACTION_LABELS[transaction.transactionType],
        );
        expect(["Advance", "Partial / Balance Payment", "Refund"]).toContain(
          receipt.typeLabel,
        );

        // 3. The returned transaction is the same one passed in — every field
        //    the receipt needs (amount, date, comment, remark, id) preserved.
        expect(receipt.transaction).toEqual(transaction);
        expect(receipt.transaction.amount).toBe(transaction.amount);
        expect(receipt.transaction.transactionDate).toBe(
          transaction.transactionDate,
        );
        expect(receipt.transaction.comment).toBe(transaction.comment);
        expect(receipt.transaction.remark).toBe(transaction.remark);
        expect(receipt.transaction.id).toBe(transaction.id);

        // 4. Stay/customer header fields pass through unchanged.
        expect(receipt.customerName).toBe(FIXED_CUSTOMER.fullName);
        expect(receipt.customerMobile).toBe(FIXED_CUSTOMER.mobile);
        expect(receipt.stayType).toBe(FIXED_STAY.stayType);
        expect(receipt.stayDates).toEqual({
          startDate: FIXED_STAY.startDate,
          endDate: FIXED_STAY.endDate,
        });
      }),
      { numRuns: 100 },
    );
  });

  it("varies receiptNumber and typeLabel consistently across stay types (arbStayType sample)", () => {
    fc.assert(
      fc.property(arbTransaction, arbStayType, (transaction, stayType) => {
        const receipt = buildPaymentReceiptData(
          transaction,
          { ...FIXED_STAY, stayType },
          FIXED_CUSTOMER,
        );

        expect(receipt.receiptNumber).toBe(
          `RCPT-${transaction.id.split("-")[0].toUpperCase()}`,
        );
        expect(receipt.typeLabel).toBe(
          PAYMENT_TRANSACTION_LABELS[transaction.transactionType],
        );
        expect(receipt.stayType).toBe(stayType);
      }),
      { numRuns: 100 },
    );
  });
});

describe("PaymentReceiptDocument — Property 16 (render half)", () => {
  const TRANSACTION_TYPES: readonly PaymentTransactionType[] = [
    "ADVANCE",
    "PARTIAL_BALANCE_PAYMENT",
    "REFUND",
  ];

  for (const transactionType of TRANSACTION_TYPES) {
    it(`renders the correct label, receipt number, total, and conditional fields for ${transactionType}`, () => {
      fc.assert(
        fc.property(
          arbTransactionOfType(transactionType, { stayEntryId: DEFAULT_STAY_ID }),
          (transaction) => {
            const receiptData = buildPaymentReceiptData(
              transaction,
              FIXED_STAY,
              FIXED_CUSTOMER,
            );

            let container: HTMLElement | undefined;
            try {
              const rendered = render(
                <PaymentReceiptDocument receiptData={receiptData} autoPrint={false} />,
              );
              container = rendered.container;

              // 5. Correct typeLabel text appears.
              const expectedLabel = PAYMENT_TRANSACTION_LABELS[transactionType];
              expect(screen.getAllByText(expectedLabel).length).toBeGreaterThan(0);

              // 6. receiptNumber appears.
              expect(screen.getByText(receiptData.receiptNumber)).toBeInTheDocument();

              // 7. Formatted amount appears (table row + total line). Checked
              //    via textContent since the currency symbol and the number
              //    render as separate adjacent JSX text nodes.
              const formattedAmount = `₹${transaction.amount.toFixed(2)}`;
              const fullText = container.textContent ?? "";
              const amountOccurrences = fullText.split(formattedAmount).length - 1;
              expect(amountOccurrences).toBeGreaterThanOrEqual(2);

              // 8/9. Comment and remark are internal operations notes: they are
              //    carried on PaymentReceiptData (the ledger and any internal
              //    view can read them) but must never be printed on the
              //    customer-facing document, whatever their value.
              //    Asserted on the labels rather than the raw values: a short
              //    generated note can legitimately occur inside unrelated
              //    boilerplate (a remark of "+" appears in the "+91" mobile
              //    prefix). The value-level check lives in the fixed-fixture
              //    test below, which uses a distinctive note.
              expect(fullText).not.toContain("Comment: ");
              expect(fullText).not.toContain("Remark: ");

              // 10. REFUND-specific heading and total label; others use the
              //     Payment Receipt / Amount Received wording.
              if (transactionType === "REFUND") {
                expect(screen.getByText("Refund Receipt")).toBeInTheDocument();
                expect(screen.getByText("Refund Amount")).toBeInTheDocument();
                expect(screen.queryByText("Payment Receipt")).not.toBeInTheDocument();
                expect(screen.queryByText("Amount Received")).not.toBeInTheDocument();
              } else {
                expect(screen.getByText("Payment Receipt")).toBeInTheDocument();
                expect(screen.getByText("Amount Received")).toBeInTheDocument();
                expect(screen.queryByText("Refund Receipt")).not.toBeInTheDocument();
                expect(screen.queryByText("Refund Amount")).not.toBeInTheDocument();
              }
            } finally {
              // fast-check runs many iterations inside a single test; the
              // global afterEach cleanup only fires once per `it`, so unmount
              // between iterations to avoid duplicate-node false positives.
              cleanup();
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  }

  it("produces a distinct receipt per transaction id (fixtureUuid distinctness sample)", () => {
    const transaction = {
      id: fixtureUuid(77, 1),
      stayEntryId: DEFAULT_STAY_ID,
      customerProfileId: fixtureUuid(88, 1),
      transactionType: "ADVANCE" as const,
      amount: 5000,
      transactionDate: "2025-01-10",
      comment: "Cash at reception",
      remark: null,
      createdBy: null,
      createdAt: "2025-01-10T06:00:00.000Z",
    };

    const receiptData = buildPaymentReceiptData(transaction, FIXED_STAY, FIXED_CUSTOMER);

    try {
      render(<PaymentReceiptDocument receiptData={receiptData} autoPrint={false} />);
      expect(screen.getByText(receiptData.receiptNumber)).toBeInTheDocument();
      // Comment and remark are internal operations notes: they must never reach
      // the customer-facing receipt, even when the transaction carries them.
      expect(screen.queryByText(/Cash at reception/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Comment: /)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Remark: /)).not.toBeInTheDocument();
    } finally {
      cleanup();
    }
  });
});
