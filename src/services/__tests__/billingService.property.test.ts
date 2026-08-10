// src/services/__tests__/billingService.property.test.ts
// Feature: customer-mobile-onboarding, Property 10: Single PAID invoice with correct amount
//
// Property 10: For any subscription onboarded with payment marked PAID, exactly
// one `payments` row is created for that subscription with `status == PAID`,
// `amount` equal to the subscription's amount due, and a non-null `paid_at`; and
// a second attempt to mark payment done for a subscription that already has a
// PAID row creates no additional PAID row and leaves the existing one unchanged.
//
// Validates: Requirements 8.3, 8.4, 8.6
//
// The rule lives in `recordOnboardingInvoice` in src/services/BillingService.ts,
// which takes an INJECTED Supabase service-role client. We drive it with an
// in-memory fake `SupabaseClient` that models just the `payments` table and the
// query chains the service uses:
//   - lookup: .from("payments").select("id").eq(...).eq(...).limit(1).maybeSingle()
//   - insert: .from("payments").insert(row).select("id").single()
// This lets each property run assert the invariants directly against the
// resulting table state across generated amounts and repeated calls.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordOnboardingInvoice,
  PAID_STATUS,
} from "@/services/BillingService";

// ─── In-memory fake `payments` table + Supabase client ───────────────────────

interface FakePaymentRow {
  id: string;
  subscription_id: string | null;
  amount: number;
  status: string | null;
  paid_at: string | null;
  invoice_type: string | null;
  customer_profile_id?: string | null;
  franchise_id?: string | null;
  created_at: string | null;
}

/** Holds the rows so a test can inspect table state after service calls. */
class FakePaymentsStore {
  rows: FakePaymentRow[] = [];
  private seq = 0;
  nextId(): string {
    this.seq += 1;
    return `pay-${this.seq}`;
  }
}

/**
 * A tiny query builder that supports exactly the chains BillingService uses.
 * `select`/`eq`/`limit` refine a query; `maybeSingle`/`single` resolve it;
 * `insert(...).select(...).single()` performs an insert.
 */
class PaymentsQueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private limitN: number | null = null;
  private mode: "select" | "insert" = "select";
  private insertRow: Record<string, unknown> | null = null;

  constructor(private readonly store: FakePaymentsStore) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  /**
   * Supabase `.in(column, values)` filter — added for
   * meal-subscription-partial-payment: the idempotency lookup in
   * `recordOnboardingInvoice` now uses `.in("status", [...])` instead of
   * `.eq("status", ...)`. Semantics: any row whose column value is IN the array.
   */
  in(column: string, values: unknown[]): this {
    // Stored as a special filter entry; `matches()` knows how to handle it.
    this.filters.push([`__in__${column}`, values]);
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  insert(row: Record<string, unknown>): this {
    this.mode = "insert";
    this.insertRow = row;
    return this;
  }

  order(_column: string, _opts?: unknown): this {
    return this;
  }

  private matches(): FakePaymentRow[] {
    let rows = this.store.rows.filter((row) =>
      this.filters.every(([col, val]) => {
        if (col.startsWith("__in__")) {
          const realCol = col.slice(6);
          return Array.isArray(val) &&
            val.includes((row as Record<string, unknown>)[realCol]);
        }
        return (row as Record<string, unknown>)[col] === val;
      }),
    );
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    const rows = this.matches();
    return { data: rows.length > 0 ? { id: rows[0].id } : null, error: null };
  }

  async single(): Promise<{
    data: unknown;
    error: { message: string } | null;
  }> {
    if (this.mode === "insert") {
      const src = this.insertRow ?? {};
      const inserted: FakePaymentRow = {
        id: this.store.nextId(),
        subscription_id: (src.subscription_id as string) ?? null,
        amount: Number(src.amount ?? 0),
        status: (src.status as string) ?? null,
        paid_at: (src.paid_at as string) ?? null,
        invoice_type: (src.invoice_type as string) ?? null,
        customer_profile_id: (src.customer_profile_id as string) ?? null,
        franchise_id: (src.franchise_id as string) ?? null,
        created_at: new Date().toISOString(),
      };
      this.store.rows.push(inserted);
      return { data: { id: inserted.id }, error: null };
    }
    const rows = this.matches();
    if (rows.length === 0) {
      return { data: null, error: { message: "No rows found" } };
    }
    return { data: { id: rows[0].id }, error: null };
  }
}

function makeFakeAdmin(store: FakePaymentsStore): SupabaseClient {
  const client = {
    from(table: string) {
      if (table !== "payments") {
        throw new Error(`Unexpected table in fake client: ${table}`);
      }
      return new PaymentsQueryBuilder(store);
    },
  };
  return client as unknown as SupabaseClient;
}

/** All PAID rows recorded against a given subscription. */
function paidRowsFor(store: FakePaymentsStore, subscriptionId: string) {
  return store.rows.filter(
    (r) => r.subscription_id === subscriptionId && r.status === PAID_STATUS,
  );
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbSubscriptionId = fc.uuid();

// A finite, non-negative currency amount. The service records it verbatim.
const arbAmount = fc.double({
  min: 0,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

const arbNow = fc.date({
  min: new Date("2020-01-01T00:00:00.000Z"),
  max: new Date("2030-12-31T23:59:59.000Z"),
  noInvalidDate: true,
});

// ─── Property tests ──────────────────────────────────────────────────────────

describe("Property 10: Single PAID invoice with correct amount", () => {
  it("records exactly one PAID row with amount == amount due and non-null paid_at", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSubscriptionId,
        arbAmount,
        arbNow,
        async (subscriptionId, amountDue, now) => {
          const store = new FakePaymentsStore();
          const admin = makeFakeAdmin(store);

          const result = await recordOnboardingInvoice(
            { subscriptionId, amountDue },
            admin,
            now,
          );

          // The result reports a fresh recording (Req 8.3/8.6).
          expect(result.ok).toBe(true);
          expect(result.status).toBe("RECORDED");

          // Exactly one PAID row exists for this subscription (Req 8.6).
          const paid = paidRowsFor(store, subscriptionId);
          expect(paid).toHaveLength(1);

          // amount == subscription amount due, status PAID, paid_at non-null (Req 8.3).
          expect(paid[0].status).toBe(PAID_STATUS);
          expect(paid[0].amount).toBe(amountDue);
          expect(paid[0].paid_at).not.toBeNull();
          expect(paid[0].paid_at).toBe(now.toISOString());

          if (result.ok && result.status === "RECORDED") {
            expect(result.amount).toBe(amountDue);
            expect(result.paidAt).toBe(now.toISOString());
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("a second attempt creates no additional PAID row and leaves the existing one unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSubscriptionId,
        arbAmount,
        arbAmount, // a possibly-different amount for the second attempt
        arbNow,
        arbNow, // a possibly-different timestamp for the second attempt
        async (subscriptionId, amountDue1, amountDue2, now1, now2) => {
          const store = new FakePaymentsStore();
          const admin = makeFakeAdmin(store);

          const first = await recordOnboardingInvoice(
            { subscriptionId, amountDue: amountDue1 },
            admin,
            now1,
          );
          expect(first.ok).toBe(true);
          expect(first.status).toBe("RECORDED");

          // Snapshot the recorded row before the second attempt.
          const before = paidRowsFor(store, subscriptionId);
          expect(before).toHaveLength(1);
          const snapshot = { ...before[0] };

          const second = await recordOnboardingInvoice(
            { subscriptionId, amountDue: amountDue2 },
            admin,
            now2,
          );

          // The duplicate is rejected (Req 8.4).
          expect(second.ok).toBe(false);
          expect(second.status).toBe("ALREADY_RECORDED");
          if (!second.ok && second.status === "ALREADY_RECORDED") {
            expect(second.existingPaymentId).toBe(snapshot.id);
          }

          // Still exactly one PAID row, and it is byte-for-byte unchanged (Req 8.4).
          const after = paidRowsFor(store, subscriptionId);
          expect(after).toHaveLength(1);
          expect(after[0]).toEqual(snapshot);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("repeated attempts never create more than one PAID row for a subscription", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSubscriptionId,
        arbAmount,
        fc.integer({ min: 2, max: 6 }),
        async (subscriptionId, amountDue, attempts) => {
          const store = new FakePaymentsStore();
          const admin = makeFakeAdmin(store);

          const results = [];
          for (let i = 0; i < attempts; i += 1) {
            results.push(
              await recordOnboardingInvoice(
                { subscriptionId, amountDue },
                admin,
              ),
            );
          }

          // First succeeds, all the rest are rejected as already-recorded.
          expect(results[0].status).toBe("RECORDED");
          for (let i = 1; i < attempts; i += 1) {
            expect(results[i].status).toBe("ALREADY_RECORDED");
          }

          expect(paidRowsFor(store, subscriptionId)).toHaveLength(1);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("distinct subscriptions each get exactly one PAID invoice with their own amount", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.tuple(fc.uuid(), arbAmount), {
          minLength: 1,
          maxLength: 8,
          selector: ([id]) => id,
        }),
        async (subs) => {
          const store = new FakePaymentsStore();
          const admin = makeFakeAdmin(store);

          for (const [subscriptionId, amountDue] of subs) {
            const result = await recordOnboardingInvoice(
              { subscriptionId, amountDue },
              admin,
            );
            expect(result.status).toBe("RECORDED");
          }

          // Each subscription has exactly one PAID row with its own amount.
          for (const [subscriptionId, amountDue] of subs) {
            const paid = paidRowsFor(store, subscriptionId);
            expect(paid).toHaveLength(1);
            expect(paid[0].amount).toBe(amountDue);
          }

          // Total PAID rows equals the number of distinct subscriptions.
          expect(store.rows.filter((r) => r.status === PAID_STATUS)).toHaveLength(
            subs.length,
          );
        },
      ),
      { numRuns: 25 },
    );
  });
});
