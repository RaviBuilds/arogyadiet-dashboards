// src/services/__tests__/subscriptionService.property.test.ts
// Property tests for SubscriptionService (customer-mobile-onboarding feature).
//
// This file is SHARED between task 6.7 (Property 12) and task 6.8 (Property 13).
// Each property lives in its own `describe` block so the two tasks stay
// independent.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  SubscriptionService,
  type SubscriptionDeps,
  type SubscriptionRecord,
  type AddOnPaymentInput,
  type PaymentOutcome,
  type CreateCategorySubscriptionInput,
  NON_TERMINAL_STATUSES,
} from "@/services/SubscriptionService";
import {
  CUSTOMER_CATEGORIES,
  type CustomerCategory,
} from "@/lib/onboarding/category";

// ─── Shared in-memory fakes ──────────────────────────────────────────────────
// A recording SubscriptionDeps whose backing store is a mutable list of
// subscriptions. `processPayment` and `createCategorySubscription` count their
// invocations so tests can assert they are (not) called and that no duplicate
// subscription is written.

interface FakeState {
  subscriptions: SubscriptionRecord[];
  paymentCalls: number;
  createCalls: number;
}

function makeFakeDeps(
  initial: SubscriptionRecord[],
  opts: { paymentOk?: boolean } = {},
): { deps: SubscriptionDeps; state: FakeState } {
  const paymentOk = opts.paymentOk ?? true;
  const state: FakeState = {
    subscriptions: [...initial],
    paymentCalls: 0,
    createCalls: 0,
  };

  const deps: SubscriptionDeps = {
    async findActiveSubscriptions(customerProfileId: string) {
      return state.subscriptions.filter(
        (s) =>
          s.customerProfileId === customerProfileId &&
          (NON_TERMINAL_STATUSES as readonly string[]).includes(s.status),
      );
    },
    async processPayment(_payment: AddOnPaymentInput): Promise<PaymentOutcome> {
      state.paymentCalls += 1;
      return paymentOk
        ? { ok: true, paymentId: "pay_test" }
        : { ok: false, message: "declined" };
    },
    async createCategorySubscription(
      input: CreateCategorySubscriptionInput,
    ): Promise<SubscriptionRecord> {
      state.createCalls += 1;
      const created: SubscriptionRecord = {
        id: `sub_${state.subscriptions.length + 1}`,
        customerProfileId: input.customerProfileId,
        customerCategory: input.category,
        status: "PENDING",
      };
      state.subscriptions.push(created);
      return created;
    },
  };

  return { deps, state };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbCategory: fc.Arbitrary<CustomerCategory> = fc.constantFrom(
  ...CUSTOMER_CATEGORIES,
);

// Statuses split into "non-terminal" (block a new subscription in the same
// category) and "terminal" (do not block).
const NON_TERMINAL = [...NON_TERMINAL_STATUSES];
const TERMINAL = ["CANCELLED", "EXPIRED", "STOPPED"];
const arbStatus = fc.constantFrom(...NON_TERMINAL, ...TERMINAL);

const arbPayment: fc.Arbitrary<AddOnPaymentInput> = fc.record({
  planId: fc.uuid(),
  amount: fc.integer({ min: 1, max: 100000 }),
  startsOn: fc.constant("2025-01-01"),
});

/** Build a subscription for a fixed customer with the given category/status. */
function subscription(
  category: CustomerCategory,
  status: string,
  idx: number,
): SubscriptionRecord {
  return {
    id: `existing_${idx}`,
    customerProfileId: "cust-1",
    customerCategory: category,
    status,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Feature: customer-mobile-onboarding, Property 12: At most one active subscription per category
//
// Property 12: At most one active subscription per category
// For any customer and any Customer_Category, at most one subscription with
// status PENDING or ACTIVE exists for that (customer, category) pair; an
// activation request targeting a category the customer already actively
// subscribes to is rejected without initiating payment or creating a duplicate
// subscription.
//
// Validates: Requirements 13.10, 13.11
// ═════════════════════════════════════════════════════════════════════════════

describe("Property 12: At most one active subscription per category", () => {
  const CUSTOMER = "cust-1";

  it("rejects an activation for a category already actively held, without paying or creating a duplicate", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategory,
        fc.constantFrom(...NON_TERMINAL),
        arbPayment,
        async (category, activeStatus, payment) => {
          // The customer already holds this category in a non-terminal state.
          const { deps, state } = makeFakeDeps([
            subscription(category, activeStatus, 1),
          ]);
          const service = new SubscriptionService(deps);

          const before = state.subscriptions.length;

          const result = await service.activateAddOnCategory(
            CUSTOMER,
            category,
            payment,
          );

          // Rejected as ALREADY_SUBSCRIBED (Req 13.10).
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe("ALREADY_SUBSCRIBED");
          }
          // No payment initiated and no subscription created (Req 13.10).
          expect(state.paymentCalls).toBe(0);
          expect(state.createCalls).toBe(0);
          expect(state.subscriptions.length).toBe(before);

          // Invariant holds: still at most one non-terminal sub for the
          // (customer, category) pair (Req 13.11).
          const activeInCat = state.subscriptions.filter(
            (s) =>
              s.customerCategory === category &&
              (NON_TERMINAL_STATUSES as readonly string[]).includes(s.status),
          );
          expect(activeInCat.length).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("allows activation when only a TERMINAL subscription exists for the category (does not block)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategory,
        fc.constantFrom(...TERMINAL),
        arbPayment,
        async (category, terminalStatus, payment) => {
          const { deps, state } = makeFakeDeps([
            subscription(category, terminalStatus, 1),
          ]);
          const service = new SubscriptionService(deps);

          const result = await service.activateAddOnCategory(
            CUSTOMER,
            category,
            payment,
          );

          // Terminal statuses don't block: payment is initiated and a new
          // subscription is created (Req 13.11).
          expect(result.ok).toBe(true);
          expect(state.paymentCalls).toBe(1);
          expect(state.createCalls).toBe(1);

          // Exactly one non-terminal subscription now exists for the pair.
          const activeInCat = state.subscriptions.filter(
            (s) =>
              s.customerCategory === category &&
              (NON_TERMINAL_STATUSES as readonly string[]).includes(s.status),
          );
          expect(activeInCat.length).toBe(1);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("never lets a successful activation produce more than one non-terminal subscription per category", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A pre-existing subscription state that already respects the invariant:
        // per category, at most one non-terminal subscription. We model this by
        // assigning each category a single "slot" that is either absent, a
        // non-terminal status, or a terminal status. (Multiple terminal subs are
        // fine but add nothing, so one slot per category is sufficient coverage.)
        fc.record({
          MEAL: fc.option(arbStatus, { nil: undefined }),
          KIT: fc.option(arbStatus, { nil: undefined }),
          ACCOMMODATION: fc.option(arbStatus, { nil: undefined }),
        }),
        arbCategory,
        arbPayment,
        async (slots, targetCategory, payment) => {
          const initial: SubscriptionRecord[] = CUSTOMER_CATEGORIES.flatMap(
            (cat, i) => {
              const status = slots[cat];
              return status ? [subscription(cat, status, i)] : [];
            },
          );
          const { deps, state } = makeFakeDeps(initial);
          const service = new SubscriptionService(deps);

          const targetAlreadyActive = initial.some(
            (s) =>
              s.customerCategory === targetCategory &&
              (NON_TERMINAL_STATUSES as readonly string[]).includes(s.status),
          );

          const result = await service.activateAddOnCategory(
            CUSTOMER,
            targetCategory,
            payment,
          );

          if (targetAlreadyActive) {
            // Must reject and not touch payment or storage.
            expect(result.ok).toBe(false);
            expect(state.paymentCalls).toBe(0);
            expect(state.createCalls).toBe(0);
          } else {
            expect(result.ok).toBe(true);
          }

          // Core invariant across ALL categories: at most one non-terminal
          // subscription per (customer, category) (Req 13.11).
          for (const cat of CUSTOMER_CATEGORIES) {
            const activeInCat = state.subscriptions.filter(
              (s) =>
                s.customerCategory === cat &&
                (NON_TERMINAL_STATUSES as readonly string[]).includes(s.status),
            );
            expect(activeInCat.length).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Feature: customer-mobile-onboarding, Property 13: Add-on activation is payment-gated and isolated
//
// Property 13: Add-on activation is payment-gated and isolated
// For any add-on category activation, the add-on subscription is started (as a
// separate subscription associated with the customer) IFF its payment completes
// successfully; when payment fails the add-on is not started and the customer's
// existing subscriptions remain unchanged.
//
// Validates: Requirements 13.7, 13.8, 13.9
// ═════════════════════════════════════════════════════════════════════════════

describe("Property 13: Add-on activation is payment-gated and isolated", () => {
  const CUSTOMER = "cust-1";

  // Build a pre-existing subscription state in which the TARGET category is NOT
  // non-terminally held (so the activation is not short-circuited as
  // ALREADY_SUBSCRIBED and the payment gate is actually exercised). Non-target
  // categories may hold any status; the target category may only appear with a
  // terminal status (which does not block a fresh subscription).
  const arbInitialWithTargetFree = (target: CustomerCategory) =>
    fc
      .record(
        Object.fromEntries(
          CUSTOMER_CATEGORIES.map((cat) => [
            cat,
            cat === target
              ? fc.option(fc.constantFrom(...TERMINAL), { nil: undefined })
              : fc.option(arbStatus, { nil: undefined }),
          ]),
        ) as Record<CustomerCategory, fc.Arbitrary<string | undefined>>,
      )
      .map((slots) =>
        CUSTOMER_CATEGORIES.flatMap((cat, i) => {
          const status = slots[cat];
          return status ? [subscription(cat, status, i)] : [];
        }),
      );

  it("starts exactly one new subscription when payment succeeds", async () => {
    // Use `chain` so the initial subscription state depends on the target
    // category (guaranteeing the target isn't already non-terminally held).
    await fc.assert(
      fc.asyncProperty(
        arbCategory.chain((target) =>
          fc.record({
            target: fc.constant(target),
            initial: arbInitialWithTargetFree(target),
            payment: arbPayment,
          }),
        ),
        async ({ target, initial, payment }) => {
          const { deps, state } = makeFakeDeps(initial, { paymentOk: true });
          const service = new SubscriptionService(deps);

          const before = state.subscriptions.length;
          const activeBefore = state.subscriptions.filter((s) =>
            (NON_TERMINAL_STATUSES as readonly string[]).includes(s.status),
          ).length;

          const result = await service.activateAddOnCategory(
            CUSTOMER,
            target,
            payment,
          );

          // Payment succeeded → add-on started (Req 13.7/13.8).
          expect(result.ok).toBe(true);
          // Payment was attempted exactly once.
          expect(state.paymentCalls).toBe(1);
          // EXACTLY ONE new subscription was created.
          expect(state.createCalls).toBe(1);
          expect(state.subscriptions.length).toBe(before + 1);

          // The new subscription is a separate record for this customer in the
          // requested category (Req 13.8).
          if (result.ok) {
            expect(result.subscription.customerProfileId).toBe(CUSTOMER);
            expect(result.subscription.customerCategory).toBe(target);
            expect(
              (NON_TERMINAL_STATUSES as readonly string[]).includes(
                result.subscription.status,
              ),
            ).toBe(true);
          }

          // Exactly one more non-terminal subscription than before.
          const activeAfter = state.subscriptions.filter((s) =>
            (NON_TERMINAL_STATUSES as readonly string[]).includes(s.status),
          ).length;
          expect(activeAfter).toBe(activeBefore + 1);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("starts nothing and leaves existing subscriptions unchanged when payment fails", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategory.chain((target) =>
          fc.record({
            target: fc.constant(target),
            initial: arbInitialWithTargetFree(target),
            payment: arbPayment,
          }),
        ),
        async ({ target, initial, payment }) => {
          const { deps, state } = makeFakeDeps(initial, { paymentOk: false });
          const service = new SubscriptionService(deps);

          // Snapshot the existing subscriptions before the attempt.
          const snapshot = state.subscriptions.map((s) => ({ ...s }));

          const result = await service.activateAddOnCategory(
            CUSTOMER,
            target,
            payment,
          );

          // Payment failed → add-on NOT started (Req 13.9).
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe("PAYMENT_FAILED");
          }
          // Payment was attempted, but NO subscription was created.
          expect(state.paymentCalls).toBe(1);
          expect(state.createCalls).toBe(0);

          // Existing subscriptions remain exactly as they were (Req 13.9).
          expect(state.subscriptions).toEqual(snapshot);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("started IFF payment succeeded — biconditional across random payment outcomes", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategory.chain((target) =>
          fc.record({
            target: fc.constant(target),
            initial: arbInitialWithTargetFree(target),
            payment: arbPayment,
            paymentOk: fc.boolean(),
          }),
        ),
        async ({ target, initial, payment, paymentOk }) => {
          const { deps, state } = makeFakeDeps(initial, { paymentOk });
          const service = new SubscriptionService(deps);

          const before = state.subscriptions.length;
          const result = await service.activateAddOnCategory(
            CUSTOMER,
            target,
            payment,
          );

          const started = state.createCalls === 1;
          const grew = state.subscriptions.length === before + 1;

          // The core biconditional: a subscription is started IFF payment ok.
          expect(started).toBe(paymentOk);
          expect(result.ok).toBe(paymentOk);
          expect(grew).toBe(paymentOk);

          if (!paymentOk) {
            // Isolation: nothing added when payment fails.
            expect(state.subscriptions.length).toBe(before);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});
