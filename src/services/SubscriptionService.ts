// src/services/SubscriptionService.ts
// Business logic for category-associated subscriptions and paid Add_On_Category
// activation (customer-mobile-onboarding feature, Task 6.6).
//
// LAYERING: Service layer. This module owns the *policy* for the multi-category
// subscription model (Requirement 13):
//   - Every subscription is associated with EXACTLY ONE Customer_Category, and
//     any value outside MEAL/KIT/ACCOMMODATION is rejected (Req 13.1, 13.11).
//   - Activating an Add_On_Category is gated on SUCCESSFUL PAYMENT: no payment,
//     no subscription (Req 13.7, 13.8).
//   - A failed payment leaves the customer's EXISTING subscriptions unchanged
//     — the activation is isolated and has no side effects (Req 13.9).
//   - A category the customer already actively holds is rejected WITHOUT
//     initiating payment and WITHOUT creating a duplicate subscription
//     (Req 13.10) — mirroring the DB partial-unique index that permits at most
//     one PENDING/ACTIVE subscription per (customer, category) (Req 13.11).
//
// The pure category validation is reused from `src/lib/onboarding/category.ts`
// so the service and the rest of the feature share one definition. All I/O
// (subscription reads/writes, payment) is injected through `SubscriptionDeps`,
// keeping the decision logic deterministic and property-testable (tasks
// 6.7/6.8) independently of Supabase and any payment gateway. A default,
// Supabase-backed set of dependencies is provided for production callers
// (e.g. OnboardingService.activateAddOnCategory).
//
// Requirements: 13.7, 13.8, 13.9, 13.10, 13.11

import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertValidCategory,
  isValidCategory,
  type CustomerCategory,
} from "@/lib/onboarding/category";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The subscription statuses considered "active" for the at-most-one-per-category
 * rule. These are the NON-TERMINAL statuses that the database partial unique
 * index (`uq_active_subscription_per_category`) also treats as blocking, so the
 * service and the DB agree on what "already subscribes to that category" means
 * (Req 13.10, 13.11). Terminal statuses (CANCELLED / EXPIRED / STOPPED) do not
 * block a fresh subscription in the same category.
 */
export const NON_TERMINAL_STATUSES = ["PENDING", "ACTIVE"] as const;

export type NonTerminalStatus = (typeof NON_TERMINAL_STATUSES)[number];

/** A subscription as this service reasons about it. */
export interface SubscriptionRecord {
  id: string;
  customerProfileId: string;
  customerCategory: CustomerCategory;
  status: string;
}

/**
 * Payment request for an Add_On_Category activation. The service passes this to
 * {@link SubscriptionDeps.processPayment}; only on a successful outcome is the
 * new subscription created (Req 13.7/13.8).
 */
export interface AddOnPaymentInput {
  /** The `subscription_plans.id` being purchased for the add-on. */
  planId: string;
  /** Total amount due for the add-on subscription. */
  amount: number;
  baseAmount?: number | null;
  taxPercent?: number | null;
  taxAmount?: number | null;
  discountAmount?: number | null;
  /** Payment channel (defaults to MANUAL / counter collection). */
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** ISO date (yyyy-MM-dd) the add-on subscription starts on. */
  startsOn: string;
  endsOn?: string | null;
  totalDays?: number | null;
  pauseCreditsTotal?: number | null;
  /** Franchise scoping stamped onto the new subscription + payment rows. */
  franchiseId?: string | null;
}

/** Outcome of attempting to collect payment for an add-on. */
export type PaymentOutcome =
  | { ok: true; paymentId?: string }
  | { ok: false; message?: string };

/** Input used to persist a new category subscription (plus its PAID invoice). */
export interface CreateCategorySubscriptionInput {
  customerProfileId: string;
  category: CustomerCategory;
  payment: AddOnPaymentInput;
  /** The payment id/reference produced by a successful charge, if any. */
  paymentId?: string;
}

/**
 * The injectable I/O boundary for the service. Production callers use
 * {@link createDefaultSubscriptionDeps}; tests supply in-memory fakes.
 */
export interface SubscriptionDeps {
  /**
   * Return the customer's NON-TERMINAL (PENDING/ACTIVE) subscriptions. Used to
   * decide whether a category is already actively held (Req 13.10).
   */
  findActiveSubscriptions(
    customerProfileId: string
  ): Promise<SubscriptionRecord[]>;

  /**
   * Attempt to collect payment for the add-on. Returns `{ ok: true }` only when
   * payment succeeded; any failure returns `{ ok: false }` and MUST NOT create
   * or mutate any subscription (Req 13.9).
   */
  processPayment(payment: AddOnPaymentInput): Promise<PaymentOutcome>;

  /**
   * Persist a new subscription associated with EXACTLY ONE Customer_Category
   * for the customer (Req 13.8/13.11), created only after a successful payment.
   */
  createCategorySubscription(
    input: CreateCategorySubscriptionInput
  ): Promise<SubscriptionRecord>;
}

/**
 * Result of {@link SubscriptionService.activateAddOnCategory}. Business-
 * meaningful failures are modeled explicitly so the action/UI layer can render
 * the right message without inspecting exceptions:
 *   - `INVALID_CATEGORY`  — category outside MEAL/KIT/ACCOMMODATION (Req 13.1).
 *   - `ALREADY_SUBSCRIBED`— customer already holds this category (Req 13.10);
 *                           no payment was initiated and no duplicate created.
 *   - `PAYMENT_FAILED`    — payment did not succeed (Req 13.9); existing
 *                           subscriptions are unchanged.
 *   - `ERROR`             — an unexpected failure after payment.
 */
export type ActivateAddOnResult =
  | { ok: true; subscription: SubscriptionRecord }
  | {
      ok: false;
      reason:
        | "INVALID_CATEGORY"
        | "ALREADY_SUBSCRIBED"
        | "PAYMENT_FAILED"
        | "ERROR";
      message: string;
    };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Owns the multi-category subscription policy (Req 13). Constructed with an
 * injectable {@link SubscriptionDeps} so its decision logic is deterministic
 * and testable without external systems.
 */
export class SubscriptionService {
  constructor(private readonly deps: SubscriptionDeps) {}

  /**
   * Whether the customer currently holds a NON-TERMINAL (PENDING/ACTIVE)
   * subscription in `category` (Req 13.10/13.11). Reused by
   * {@link activateAddOnCategory} and available to callers that need to gate UI
   * before offering an add-on.
   */
  async hasActiveCategory(
    customerProfileId: string,
    category: CustomerCategory
  ): Promise<boolean> {
    const active = await this.deps.findActiveSubscriptions(customerProfileId);
    return active.some(
      (s) =>
        s.customerCategory === category &&
        (NON_TERMINAL_STATUSES as readonly string[]).includes(s.status)
    );
  }

  /**
   * Activate an Add_On_Category subscription for an already-onboarded customer.
   *
   * Ordering is deliberate and enforces every clause of Requirement 13.7–13.11:
   *   1. Reject a category outside the allowed set (Req 13.1) — no payment.
   *   2. Reject a category the customer already actively holds (Req 13.10) —
   *      WITHOUT initiating payment and WITHOUT creating a duplicate.
   *   3. Otherwise attempt payment; only a SUCCESSFUL payment starts the
   *      subscription (Req 13.7/13.8).
   *   4. A failed payment starts nothing and leaves existing subscriptions
   *      untouched (Req 13.9).
   */
  async activateAddOnCategory(
    customerProfileId: string,
    category: CustomerCategory,
    payment: AddOnPaymentInput
  ): Promise<ActivateAddOnResult> {
    // 1) Category must be one of MEAL/KIT/ACCOMMODATION (Req 13.1).
    if (!isValidCategory(category)) {
      return {
        ok: false,
        reason: "INVALID_CATEGORY",
        message: `Invalid customer category "${String(category)}".`,
      };
    }

    // 2) Reject a category already actively held — BEFORE any payment, so no
    //    payment is initiated and no duplicate is created (Req 13.10/13.11).
    const alreadyActive = await this.hasActiveCategory(
      customerProfileId,
      category
    );
    if (alreadyActive) {
      return {
        ok: false,
        reason: "ALREADY_SUBSCRIBED",
        message: `The customer already subscribes to the ${category} category.`,
      };
    }

    // 3) Gate activation on successful payment (Req 13.7).
    const paymentResult = await this.deps.processPayment(payment);
    if (!paymentResult.ok) {
      // 4) Payment failed: start nothing, leave existing subscriptions
      //    unchanged (Req 13.9). No createCategorySubscription call is made.
      return {
        ok: false,
        reason: "PAYMENT_FAILED",
        message:
          paymentResult.message ??
          "Payment failed. The add-on subscription was not started.",
      };
    }

    // Payment succeeded: start the add-on as a separately paid subscription
    // associated with exactly one Customer_Category (Req 13.8/13.11).
    try {
      const subscription = await this.deps.createCategorySubscription({
        customerProfileId,
        category,
        payment,
        paymentId: paymentResult.paymentId,
      });
      return { ok: true, subscription };
    } catch (err) {
      return {
        ok: false,
        reason: "ERROR",
        message:
          err instanceof Error
            ? err.message
            : "Failed to start the add-on subscription after payment.",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Default (Supabase-backed) dependencies
// ---------------------------------------------------------------------------

/**
 * Maps a raw `subscriptions` row to a {@link SubscriptionRecord}, validating
 * that its stored `customer_category` is one of the allowed values (Req 13.1).
 */
function toSubscriptionRecord(row: Record<string, unknown>): SubscriptionRecord {
  const category = row.customer_category;
  assertValidCategory(category);
  return {
    id: String(row.id),
    customerProfileId: String(row.customer_profile_id),
    customerCategory: category,
    status: String(row.status),
  };
}

/**
 * Production {@link SubscriptionDeps} backed by the service-role Supabase
 * client. Reads non-terminal subscriptions and, on a successful payment,
 * inserts the subscription row (with its `customer_category`) and a PAID
 * `payments` invoice for it.
 *
 * NOTE: `processPayment` here records a MANUAL/counter-collected payment as
 * successful; when a real payment gateway (e.g. Razorpay) is wired in, replace
 * this implementation with a gateway-backed charge. The service policy above is
 * agnostic to how payment is performed.
 */
export function createDefaultSubscriptionDeps(): SubscriptionDeps {
  return {
    async findActiveSubscriptions(customerProfileId) {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("subscriptions")
        .select("id, customer_profile_id, customer_category, status")
        .eq("customer_profile_id", customerProfileId)
        .in("status", NON_TERMINAL_STATUSES as unknown as string[]);

      if (error) {
        throw new Error(
          `Failed to load active subscriptions for ${customerProfileId}: ${error.message}`
        );
      }

      return (data ?? [])
        .map((row) => row as Record<string, unknown>)
        .filter((row) => isValidCategory(row.customer_category))
        .map(toSubscriptionRecord);
    },

    async processPayment(payment) {
      // MANUAL counter collection: treat as collected. Swap for a gateway
      // charge (returning { ok: false, message } on decline) when integrating
      // an online payment provider.
      return { ok: true, paymentId: payment.reference ?? undefined };
    },

    async createCategorySubscription({ customerProfileId, category, payment, paymentId }) {
      const admin = createAdminClient();

      const { data: sub, error: subError } = await admin
        .from("subscriptions")
        .insert({
          customer_profile_id: customerProfileId,
          plan_id: payment.planId,
          customer_category: category,
          starts_on: payment.startsOn,
          ends_on: payment.endsOn ?? null,
          effective_end_on: payment.endsOn ?? null,
          status: "PENDING",
          total_days: payment.totalDays ?? null,
          pause_credits_total: payment.pauseCreditsTotal ?? 0,
          pause_credits_used: 0,
          consumed_days: 0,
          franchise_id: payment.franchiseId ?? null,
        })
        .select("id, customer_profile_id, customer_category, status")
        .single();

      if (subError || !sub) {
        throw new Error(
          subError?.message ?? "Failed to create add-on subscription."
        );
      }

      const record = toSubscriptionRecord(sub as Record<string, unknown>);

      // Record the PAID invoice for the add-on subscription.
      const { error: payError } = await admin.from("payments").insert({
        subscription_id: record.id,
        customer_profile_id: customerProfileId,
        amount: payment.amount,
        base_amount: payment.baseAmount ?? null,
        tax_percent: payment.taxPercent ?? null,
        tax_amount: payment.taxAmount ?? null,
        discount_amount: payment.discountAmount ?? 0,
        payment_method: payment.method ?? "MANUAL",
        status: "PAID",
        paid_at: new Date().toISOString(),
        invoice_type: "SUBSCRIPTION",
        payment_reference: paymentId ?? payment.reference ?? null,
        payment_notes: payment.notes ?? null,
        franchise_id: payment.franchiseId ?? null,
      });

      if (payError) {
        throw new Error(
          `Add-on subscription created but recording its invoice failed: ${payError.message}`
        );
      }

      return record;
    },
  };
}

/**
 * Convenience factory returning a {@link SubscriptionService} wired to the
 * default Supabase-backed dependencies. Tests construct
 * `new SubscriptionService(fakeDeps)` directly instead.
 */
export function createSubscriptionService(
  deps: SubscriptionDeps = createDefaultSubscriptionDeps()
): SubscriptionService {
  return new SubscriptionService(deps);
}
