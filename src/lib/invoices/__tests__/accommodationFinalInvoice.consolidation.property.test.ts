// src/lib/invoices/__tests__/accommodationFinalInvoice.consolidation.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 14: Final invoice excludes per-transaction detail
//
// **Validates: Requirements 8.5**
//
// *For any* Stay_Entry and *any* ledger of Payment_Transaction records, the
// generated Final_Consolidated_Invoice SHALL contain exactly one line item
// and SHALL NOT contain any individual Payment_Transaction's amount, date,
// comment, or remark.
//
// The ACCOMMODATION_FINAL_INVOICE branch of `generateInvoiceData(paymentId)`
// (src/lib/invoices/index.ts) builds the invoice ENTIRELY from the linked
// `stay_entries` row — it never queries `stay_payment_transactions`. This
// test mocks `@/lib/supabase/admin`'s `createAdminClient` with a fake
// chainable query builder (the same convention as
// `accommodationFinalInvoice.figures.property.test.ts` and
// `billingService.property.test.ts`) that:
//   - answers `.from("payments").select(...).eq("id", paymentId).single()`
//     with a fixture payment row carrying an embedded `stay_entries` join
//   - THROWS if `.from("stay_payment_transactions")` is ever invoked, so the
//     property fails loudly (the SUT call rejects and the `await` surfaces
//     it) if the ledger table is ever touched
//
// The ledger itself is drawn from `arbLedger` for a realistic shape (0–20
// rows, every Payment_Transaction_Type, the usual mixes), then overlaid with
// marker amount/comment/remark/date values that cannot coincidentally match
// anything the stay-derived fields would naturally produce:
//   - marker amounts carry 4 decimal digits from a fixed pool, so they can
//     never equal a `roundToPaise`-rounded (2-decimal) stay figure
//   - marker comments/remarks are long, prefixed, index-suffixed strings no
//     stay field could produce
//   - the marker transaction date (1999-09-09) sits far outside the ±800-day
//     window `arbISTDate` draws stay dates from

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared mutable "current payment row" + ledger-touch flag (hoisted so the
// mock factory can close over them) ─────────────────────────────────────────
const H = vi.hoisted(() => {
  let currentPaymentRow: any = null;
  let ledgerTableTouched = false;

  function setPaymentRow(row: any) {
    currentPaymentRow = row;
  }

  function resetLedgerTouch() {
    ledgerTableTouched = false;
  }

  function wasLedgerTouched() {
    return ledgerTableTouched;
  }

  function makeFakeAdmin() {
    return {
      from(table: string) {
        if (table === "stay_payment_transactions") {
          ledgerTableTouched = true;
          throw new Error(
            "Property 14 violation: generateInvoiceData queried " +
              "stay_payment_transactions for an ACCOMMODATION_FINAL_INVOICE",
          );
        }
        if (table !== "payments") {
          throw new Error(`Unexpected table in fake admin client: ${table}`);
        }
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
      },
    };
  }

  return { setPaymentRow, resetLedgerTouch, wasLedgerTouched, makeFakeAdmin };
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
  arbMoney,
  arbLedger,
  referenceGstBreakup,
  shiftISODate,
  fixtureUuid,
  REFERENCE_MAX_TOTAL_NIGHTS,
} from "@/test/accommodation/paymentArbitraries";
import type { StayPaymentTransaction } from "@/types/accommodation";

const PAYMENT_ID = fixtureUuid(77, 1);

// ─── Marker values guaranteed not to coincide with stay-derived figures ────

/** 4-decimal amounts — a `roundToPaise` (2-decimal) stay figure can never equal these. */
const MARKER_AMOUNTS: number[] = [
  918273.6543, 154623.7891, 837465.1029, 271828.459, 314159.2653,
  562398.7412, 445566.7788, 909182.7364, 123987.6541, 776655.4433,
  888111.2229, 334455.6671, 991827.3645, 546372.8193, 213645.7982,
  675849.3021, 192837.4655, 837162.9504, 465738.291, 758493.0217,
];

const LEDGER_MARKER_DATE = "1999-09-09"; // far outside arbISTDate's ±800-day window

function markerComment(index: number): string {
  return `LEDGER-MARKER-COMMENT-${index}-ZZZQQQ-DO-NOT-LEAK`;
}

function markerRemark(index: number): string {
  return `LEDGER-MARKER-REMARK-${index}-ZZZQQQ-DO-NOT-LEAK`;
}

/**
 * Overlays a realistically-shaped ledger (from `arbLedger`) with marker
 * amount/comment/remark/date values that are clearly distinguishable from
 * anything the stay's own fields would naturally produce.
 */
function withMarkerValues(
  ledger: readonly StayPaymentTransaction[],
): StayPaymentTransaction[] {
  return ledger.map((tx, index) => ({
    ...tx,
    amount: MARKER_AMOUNTS[index % MARKER_AMOUNTS.length],
    comment: markerComment(index),
    remark: markerRemark(index),
    transactionDate: LEDGER_MARKER_DATE,
  }));
}

const arbMarkerLedger: fc.Arbitrary<StayPaymentTransaction[]> = arbLedger.map(
  withMarkerValues,
);

// ─── Stay fixture generator (both early-checkout and ordinary closures) ────

interface FixtureSeed {
  stayType: string;
  occupancyType: string;
  startDate: string;
  totalNights: number;
  actualNightsStayed: number | null;
  earlyCheckoutApplied: boolean;
  totalForGst: number;
  paymentAmount: number;
}

function buildPaymentRow(seed: FixtureSeed) {
  const gst = referenceGstBreakup(seed.totalForGst);
  return {
    id: PAYMENT_ID,
    amount: seed.paymentAmount,
    created_at: "2025-01-15T06:00:00.000Z",
    status: "PAID",
    payment_method: "MANUAL",
    payment_reference: null,
    payment_notes: null,
    invoice_type: "ACCOMMODATION_FINAL_INVOICE",
    customer_profiles: undefined,
    subscriptions: undefined,
    stay_entries: {
      stay_type: seed.stayType,
      occupancy_type: seed.occupancyType,
      start_date: seed.startDate,
      total_nights: seed.totalNights,
      payment_amount: seed.totalForGst,
      base_amount: gst.baseAmount,
      tax_amount: gst.taxAmount,
      tax_percentage: 18,
      actual_nights_stayed: seed.actualNightsStayed,
      early_checkout_applied: seed.earlyCheckoutApplied,
    },
  };
}

const arbNonEarlyCheckoutSeed: fc.Arbitrary<FixtureSeed> = fc
  .record({
    stayType: arbStayType,
    occupancyType: arbOccupancyType,
    startDate: arbISTDate,
    totalNights: arbTotalNights,
    totalForGst: arbTotalStayAmount,
    paymentAmount: arbMoney,
  })
  .map((s) => ({
    ...s,
    actualNightsStayed: null,
    earlyCheckoutApplied: false,
  }));

const arbEarlyCheckoutSeed: fc.Arbitrary<FixtureSeed> = fc
  .record({
    stayType: arbStayType,
    occupancyType: arbOccupancyType,
    startDate: arbISTDate,
    totalNights: arbTotalNights,
    actualNightsStayed: fc.integer({
      min: 1,
      max: REFERENCE_MAX_TOTAL_NIGHTS,
    }),
    totalForGst: arbTotalStayAmount,
    paymentAmount: arbMoney,
  })
  .filter((s) => s.actualNightsStayed !== s.totalNights)
  .map((s) => ({
    ...s,
    earlyCheckoutApplied: true,
  }));

const arbFixtureSeed: fc.Arbitrary<FixtureSeed> = fc.oneof(
  arbNonEarlyCheckoutSeed,
  arbEarlyCheckoutSeed,
);

// ─── Property 14 ─────────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Property 14: Final invoice excludes per-transaction detail", () => {
  it("contains exactly one line item and never touches or leaks the ledger", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbFixtureSeed,
        arbMarkerLedger,
        async (seed, ledger) => {
          H.resetLedgerTouch();
          const row = buildPaymentRow(seed);
          H.setPaymentRow(row);

          // The ledger is NOT wired into the fake DB at all — the SUT is
          // never given a channel to read it. If it tries anyway (by
          // querying stay_payment_transactions), the fake `.from(...)`
          // throws and this call rejects, failing the property loudly.
          const invoice = await generateInvoiceData(PAYMENT_ID);

          // The ledger table must never have been touched.
          expect(H.wasLedgerTouched()).toBe(false);

          expect(invoice).not.toBeNull();
          if (!invoice) return;

          // Exactly one line item — never one-per-transaction.
          expect(invoice.lineItems).toHaveLength(1);

          // The single line item's description/subtitle derive only from
          // stay fields (stay_type, occupancy_type, nights, dates).
          const stay = row.stay_entries;
          const nightsForInvoice = seed.earlyCheckoutApplied
            ? (seed.actualNightsStayed as number)
            : seed.totalNights;
          const expectedEndDate = shiftISODate(
            seed.startDate,
            nightsForInvoice - 1,
          );
          const [item] = invoice.lineItems;
          expect(item.description).toBe(
            `Accommodation Stay — ${seed.stayType} (${seed.occupancyType})`,
          );
          expect(item.subtitle).toBe(
            `${nightsForInvoice} night(s): ${seed.startDate} to ${expectedEndDate}`,
          );
          expect(item.amount).toBe(stay.base_amount);

          // Strong "no ledger value leaked" check: none of the ledger's
          // transaction amounts, comments, remarks, or transaction dates
          // appear anywhere in the stringified invoice output.
          const serialized = JSON.stringify(invoice);
          for (const tx of ledger) {
            expect(serialized.includes(String(tx.amount))).toBe(false);
            if (tx.comment) {
              expect(serialized.includes(tx.comment)).toBe(false);
            }
            if (tx.remark) {
              expect(serialized.includes(tx.remark)).toBe(false);
            }
            expect(serialized.includes(tx.transactionDate)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
