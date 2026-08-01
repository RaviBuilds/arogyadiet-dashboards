// src/lib/invoices/__tests__/accommodationFinalInvoice.figures.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 13: Final invoice figures reflect early checkout
//
// **Validates: Requirements 8.3**
//
// *For any* Stay_Entry, the Final_Consolidated_Invoice SHALL display the
// Recalculated_Stay_Amount and Actual_Nights_Stayed when an Early_Checkout has
// been applied, and the Total_Stay_Amount and booked total nights otherwise,
// with the displayed GST_Breakup computed from whichever amount was selected.
//
// `generateInvoiceData(paymentId)` (src/lib/invoices/index.ts) reads the
// `payments` row — joined with `stay_entries` — via `createAdminClient()`,
// doing `.from("payments").select(...).eq("id", paymentId).single()`. We MOCK
// `@/lib/supabase/admin`'s `createAdminClient` with a fake chainable query
// builder that supports exactly that chain and returns a fixture `payment`
// row carrying a `stay_entries` object (simulating the PostgREST embedded
// join), following the query-builder convention already used in
// `AccommodationService.finalInvoiceIdempotence.property.test.ts` and
// `billingService.property.test.ts`.
//
// The reference end-date calculation uses `shiftISODate` from
// `paymentArbitraries.ts` (declared independently of the SUT's own
// `addDaysToISODate`), so the test cannot inherit a date-arithmetic bug from
// the code it exercises.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { vi } from "vitest";

// ─── Shared mutable "current payment row" (hoisted so the mock factory can
// close over it) ────────────────────────────────────────────────────────────
const H = vi.hoisted(() => {
  let currentPaymentRow: any = null;

  function setPaymentRow(row: any) {
    currentPaymentRow = row;
  }

  function makeFakeAdmin() {
    return {
      from(table: string) {
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

  return { setPaymentRow, makeFakeAdmin };
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
  referenceGstBreakup,
  shiftISODate,
  fixtureUuid,
  REFERENCE_MAX_TOTAL_NIGHTS,
} from "@/test/accommodation/paymentArbitraries";

const PAYMENT_ID = fixtureUuid(66, 1);

// ─── Fixture builder ─────────────────────────────────────────────────────────

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

/** Builds the `payments` row (with its joined `stay_entries`) the fake admin client returns. */
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

// ─── Generators ──────────────────────────────────────────────────────────────

/** A stay closed via the ordinary "Mark as Checked Out" path — no Early_Checkout. */
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

/**
 * A stay closed via Early_Checkout. `actualNightsStayed` is generated
 * distinct from `totalNights` on purpose — so the assertion that the
 * invoice used `actual_nights_stayed` cannot pass merely because the two
 * fields happen to coincide.
 */
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

// ─── Property 13 ─────────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Property 13: Final invoice figures reflect early checkout", () => {
  it("uses total_nights and the stay's stored GST breakup when Early_Checkout was NOT applied", async () => {
    await fc.assert(
      fc.asyncProperty(arbNonEarlyCheckoutSeed, async (seed) => {
        const row = buildPaymentRow(seed);
        H.setPaymentRow(row);

        const invoice = await generateInvoiceData(PAYMENT_ID);
        expect(invoice).not.toBeNull();
        if (!invoice) return;

        const stay = row.stay_entries;
        const expectedEndDate = shiftISODate(
          seed.startDate,
          seed.totalNights - 1,
        );

        expect(invoice.lineItems).toHaveLength(1);
        const [item] = invoice.lineItems;
        expect(item.description).toBe(
          `Accommodation Stay — ${seed.stayType} (${seed.occupancyType})`,
        );
        expect(item.subtitle).toBe(
          `${seed.totalNights} night(s): ${seed.startDate} to ${expectedEndDate}`,
        );

        // pricing.baseAmount equals the stay's stored base_amount (Req 8.3).
        expect(item.amount).toBe(stay.base_amount);
        expect(invoice.pricing.baseAmount).toBe(stay.base_amount);
        expect(invoice.pricing.taxAmount).toBe(stay.tax_amount);
        expect(invoice.pricing.taxPercent).toBe(stay.tax_percentage);
      }),
      { numRuns: 100 },
    );
  });

  it("uses actual_nights_stayed (NOT total_nights) and the stay's stored GST breakup when Early_Checkout WAS applied", async () => {
    await fc.assert(
      fc.asyncProperty(arbEarlyCheckoutSeed, async (seed) => {
        const row = buildPaymentRow(seed);
        H.setPaymentRow(row);

        const invoice = await generateInvoiceData(PAYMENT_ID);
        expect(invoice).not.toBeNull();
        if (!invoice) return;

        const stay = row.stay_entries;
        const nights = seed.actualNightsStayed as number;
        const expectedEndDate = shiftISODate(seed.startDate, nights - 1);

        expect(invoice.lineItems).toHaveLength(1);
        const [item] = invoice.lineItems;
        expect(item.subtitle).toBe(
          `${nights} night(s): ${seed.startDate} to ${expectedEndDate}`,
        );

        // The night count used is actual_nights_stayed, not total_nights —
        // the two are generated distinct, so this is a real discriminator.
        expect(nights).not.toBe(seed.totalNights);

        // pricing.baseAmount still equals the stay's stored base_amount,
        // which by invoicing time already reflects the recalculated total
        // (Req 8.3).
        expect(item.amount).toBe(stay.base_amount);
        expect(invoice.pricing.baseAmount).toBe(stay.base_amount);
        expect(invoice.pricing.taxAmount).toBe(stay.tax_amount);
        expect(invoice.pricing.taxPercent).toBe(stay.tax_percentage);
      }),
      { numRuns: 100 },
    );
  });

  it("always computes the end date as start_date + (nightsForInvoice - 1) days, regardless of which nights field was selected", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(arbNonEarlyCheckoutSeed, arbEarlyCheckoutSeed),
        async (seed) => {
          const row = buildPaymentRow(seed);
          H.setPaymentRow(row);

          const invoice = await generateInvoiceData(PAYMENT_ID);
          expect(invoice).not.toBeNull();
          if (!invoice) return;

          const nightsForInvoice = seed.earlyCheckoutApplied
            ? (seed.actualNightsStayed as number)
            : seed.totalNights;
          const expectedEndDate = shiftISODate(
            seed.startDate,
            nightsForInvoice - 1,
          );

          const [item] = invoice.lineItems;
          expect(item.subtitle).toBe(
            `${nightsForInvoice} night(s): ${seed.startDate} to ${expectedEndDate}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
