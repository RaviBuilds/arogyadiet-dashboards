// src/lib/invoices/__tests__/accommodationRefundInvoice.property.test.ts
// Feature: accommodation-payment-lifecycle, Task 21.4: Refund invoice render branch
//
// **Validates: Requirements 14.7, 14.9**
//
// Properties asserted (100 iterations each):
// 1. The rendered Refund_Invoice shows the REFUND transaction's own amount —
//    not the stay's `payment_amount` or any other transaction's amount.
// 2. The subtitle contains the transaction's `transaction_date` and `remark`.
// 3. The `RFND-` invoice number starts with "RFND-" and never with "INV-".
// 4. For 2–3 refunds against the same stay, each Refund_Invoice renders its
//    own transaction's figures independently.
//
// Mock approach: `@/lib/supabase/admin`'s `createAdminClient` is mocked with
// a fake chainable query builder that answers:
//  - `.from("payments").select(...).eq("id", paymentId).single()`
//    → the fixture payment row (with `invoice_type: "ACCOMMODATION_REFUND_INVOICE"`,
//      `stay_payment_transaction_id`, and embedded `stay_entries`)
//  - `.from("stay_payment_transactions").select(...).eq("id", txId).single()`
//    → the fixture REFUND transaction row

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted mutable state: payment row lookup and transaction row lookup ───
const H = vi.hoisted(() => {
  let currentPaymentRow: any = null;
  let currentTransactionRow: any = null;
  let expectedTxId: string | null = null;

  function setFixtures(payment: any, transaction: any, txId: string) {
    currentPaymentRow = payment;
    currentTransactionRow = transaction;
    expectedTxId = txId;
  }

  function makeFakeAdmin() {
    return {
      from(table: string) {
        if (table === "payments") {
          return {
            select(_columns: string) {
              return {
                eq(column: string, value: unknown) {
                  return {
                    async single() {
                      if (
                        currentPaymentRow &&
                        column === "id" &&
                        value === currentPaymentRow.id
                      ) {
                        return { data: currentPaymentRow, error: null };
                      }
                      return { data: null, error: { message: "not found" } };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "stay_payment_transactions") {
          return {
            select(_columns: string) {
              return {
                eq(column: string, value: unknown) {
                  return {
                    async single() {
                      if (
                        currentTransactionRow &&
                        column === "id" &&
                        value === expectedTxId
                      ) {
                        return { data: currentTransactionRow, error: null };
                      }
                      return { data: null, error: { message: "not found" } };
                    },
                  };
                },
              };
            },
          };
        }
        // addon_orders or other tables — return empty
        return {
          select(_columns: string) {
            return {
              eq(_column: string, _value: unknown) {
                return {
                  async single() {
                    return { data: null, error: { message: "not found" } };
                  },
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  return { setFixtures, makeFakeAdmin };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mock is registered) ─────────────
import { generateInvoiceData } from "@/lib/invoices";
import {
  arbStayType,
  arbOccupancyType,
  arbISTDate,
  arbTotalNights,
  arbTotalStayAmount,
  arbTransactionAmount,
  arbStoredText,
  fixtureUuid,
  referenceGstBreakup,
} from "@/test/accommodation/paymentArbitraries";

// ─── Generators ──────────────────────────────────────────────────────────────

/** A remark that is always non-null (the refund invoice subtitle always shows it) */
const arbNonNullRemark: fc.Arbitrary<string> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "Refund initiated to source account",
      "Early departure - partial refund",
      "Overpayment corrected",
      "Guest requested cancellation",
    ),
    weight: 3,
  },
  {
    arbitrary: fc.string({ minLength: 1, maxLength: 100 }),
    weight: 5,
  },
);

/** Transaction date as YYYY-MM-DD */
const arbTransactionDate: fc.Arbitrary<string> = arbISTDate;

interface RefundFixtureSeed {
  paymentId: string;
  txId: string;
  stayType: string;
  occupancyType: string;
  startDate: string;
  totalNights: number;
  stayPaymentAmount: number; // the stay's payment_amount (Total_Stay_Amount)
  refundAmount: number; // the REFUND transaction's own amount
  transactionDate: string;
  remark: string;
  comment: string | null;
}

const arbRefundFixtureSeed: fc.Arbitrary<RefundFixtureSeed> = fc.record({
  paymentId: fc.constant(fixtureUuid(80, 1)),
  txId: fc.constant(fixtureUuid(81, 1)),
  stayType: arbStayType,
  occupancyType: arbOccupancyType,
  startDate: arbISTDate,
  totalNights: arbTotalNights,
  stayPaymentAmount: arbTotalStayAmount,
  refundAmount: arbTransactionAmount,
  transactionDate: arbTransactionDate,
  remark: arbNonNullRemark,
  comment: arbStoredText,
});

/** Builds the payment row (with embedded stay_entries) for a refund invoice. */
function buildRefundPaymentRow(seed: RefundFixtureSeed) {
  const gst = referenceGstBreakup(seed.stayPaymentAmount);
  return {
    id: seed.paymentId,
    amount: seed.refundAmount, // payment.amount matches the refund amount
    created_at: "2025-01-20T06:00:00.000Z",
    status: "PAID",
    payment_method: "MANUAL",
    payment_reference: null,
    payment_notes: null,
    invoice_type: "ACCOMMODATION_REFUND_INVOICE",
    stay_payment_transaction_id: seed.txId,
    customer_profiles: undefined,
    subscriptions: undefined,
    stay_entries: {
      stay_type: seed.stayType,
      occupancy_type: seed.occupancyType,
      start_date: seed.startDate,
      total_nights: seed.totalNights,
      payment_amount: seed.stayPaymentAmount,
      base_amount: gst.baseAmount,
      tax_amount: gst.taxAmount,
      tax_percentage: 18,
      recalculation_applied: false,
    },
  };
}

/** Builds the REFUND transaction row as it appears in the DB. */
function buildRefundTransactionRow(seed: RefundFixtureSeed) {
  return {
    transaction_type: "REFUND",
    amount: seed.refundAmount,
    transaction_date: seed.transactionDate,
    comment: seed.comment,
    remark: seed.remark,
  };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Task 21.4: Refund invoice render branch", () => {
  it("Property 1: shows the transaction's own amount, not the stay's payment_amount", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRefundFixtureSeed.filter(
          // Ensure refund amount differs from stay amount so the assertion is meaningful
          (s) => Math.round(s.refundAmount * 100) !== Math.round(s.stayPaymentAmount * 100),
        ),
        async (seed) => {
          const paymentRow = buildRefundPaymentRow(seed);
          const txRow = buildRefundTransactionRow(seed);
          H.setFixtures(paymentRow, txRow, seed.txId);

          const invoice = await generateInvoiceData(seed.paymentId);
          expect(invoice).not.toBeNull();
          if (!invoice) return;

          // The line item amount equals the refund transaction's amount
          expect(invoice.lineItems).toHaveLength(1);
          const [item] = invoice.lineItems;
          expect(item.amount).toBe(seed.refundAmount);

          // Pricing figures are all derived from the refund amount
          expect(invoice.pricing.baseAmount).toBe(seed.refundAmount);
          expect(invoice.pricing.totalAmount).toBe(seed.refundAmount);
          expect(invoice.pricing.finalPrice).toBe(seed.refundAmount);

          // Tax is zero for a refund document
          expect(invoice.pricing.taxAmount).toBe(0);
          expect(invoice.pricing.taxPercent).toBe(0);
          expect(invoice.pricing.discountAmount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 2: subtitle contains the transaction's transaction_date and remark", async () => {
    await fc.assert(
      fc.asyncProperty(arbRefundFixtureSeed, async (seed) => {
        const paymentRow = buildRefundPaymentRow(seed);
        const txRow = buildRefundTransactionRow(seed);
        H.setFixtures(paymentRow, txRow, seed.txId);

        const invoice = await generateInvoiceData(seed.paymentId);
        expect(invoice).not.toBeNull();
        if (!invoice) return;

        expect(invoice.lineItems).toHaveLength(1);
        const [item] = invoice.lineItems;

        // Subtitle format: "Refund dated {transaction_date} · {remark}"
        expect(item.subtitle).toBe(
          `Refund dated ${seed.transactionDate} · ${seed.remark}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("Property 3: the RFND- invoice number never collides with an INV- number", async () => {
    await fc.assert(
      fc.asyncProperty(arbRefundFixtureSeed, async (seed) => {
        const paymentRow = buildRefundPaymentRow(seed);
        const txRow = buildRefundTransactionRow(seed);
        H.setFixtures(paymentRow, txRow, seed.txId);

        const invoice = await generateInvoiceData(seed.paymentId);
        expect(invoice).not.toBeNull();
        if (!invoice) return;

        // Starts with RFND-, never INV-
        expect(invoice.invoiceNumber.startsWith("RFND-")).toBe(true);
        expect(invoice.invoiceNumber.startsWith("INV-")).toBe(false);

        // Derived from the payment ID's first UUID segment, uppercased
        const expectedPrefix = `RFND-${seed.paymentId.split("-")[0].toUpperCase()}`;
        expect(invoice.invoiceNumber).toBe(expectedPrefix);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 4: multiple refunds against the same stay each render their own figures independently", async () => {
    // Generate 2–3 distinct refunds with different amounts, dates, and remarks
    const arbMultipleRefunds = fc
      .integer({ min: 2, max: 3 })
      .chain((count) =>
        fc.tuple(
          arbStayType,
          arbOccupancyType,
          arbISTDate,
          arbTotalNights,
          arbTotalStayAmount,
          fc.array(
            fc.record({
              refundAmount: arbTransactionAmount,
              transactionDate: arbTransactionDate,
              remark: arbNonNullRemark,
              comment: arbStoredText,
            }),
            { minLength: count, maxLength: count },
          ),
        ),
      );

    await fc.assert(
      fc.asyncProperty(arbMultipleRefunds, async ([stayType, occupancyType, startDate, totalNights, stayPaymentAmount, refunds]) => {
        const results: Array<{
          amount: number;
          subtitle: string | undefined;
          invoiceNumber: string;
        }> = [];

        for (let i = 0; i < refunds.length; i++) {
          const refund = refunds[i];
          // Use distinct first-segment UUIDs so invoice numbers differ
          // (invoiceNumber = `RFND-<first segment>`)
          const paymentId = `${(i + 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
          const txId = fixtureUuid(83, i + 1);

          const seed: RefundFixtureSeed = {
            paymentId,
            txId,
            stayType,
            occupancyType,
            startDate,
            totalNights,
            stayPaymentAmount,
            refundAmount: refund.refundAmount,
            transactionDate: refund.transactionDate,
            remark: refund.remark,
            comment: refund.comment,
          };

          const paymentRow = buildRefundPaymentRow(seed);
          const txRow = buildRefundTransactionRow(seed);
          H.setFixtures(paymentRow, txRow, txId);

          const invoice = await generateInvoiceData(paymentId);
          expect(invoice).not.toBeNull();
          if (!invoice) return;

          results.push({
            amount: invoice.lineItems[0].amount,
            subtitle: invoice.lineItems[0].subtitle,
            invoiceNumber: invoice.invoiceNumber,
          });
        }

        // Each refund invoice renders its OWN transaction's figures
        for (let i = 0; i < refunds.length; i++) {
          expect(results[i].amount).toBe(refunds[i].refundAmount);
          expect(results[i].subtitle).toBe(
            `Refund dated ${refunds[i].transactionDate} · ${refunds[i].remark}`,
          );
        }

        // Each refund invoice has a distinct invoice number (different payment IDs)
        const invoiceNumbers = results.map((r) => r.invoiceNumber);
        expect(new Set(invoiceNumbers).size).toBe(invoiceNumbers.length);

        // The description references the same stay for all
        // (stay_type and occupancy_type are shared)
        // Already implicitly tested above through the individual assertions
      }),
      { numRuns: 100 },
    );
  });
});
