"use server";

// src/actions/admin-actions/subscriptionPaymentActions.ts
//
// Server Actions for the MEAL subscription payment ledger — recording a balance
// payment collected from a customer after onboarding.
//
// Feature: meal-subscription-partial-payment
//
// Pattern (mirrors `src/actions/stayPaymentActions.ts`, the accommodation
// equivalent): authorise → Zod re-validate → row-locked RPC → project onto the
// invoice → mapped result carrying the authoritative post-payment balance, so the
// card re-renders without a second round trip.
//
// WHY THE LEDGER AND THE INVOICE ARE UPDATED SEPARATELY
// `record_subscription_payment_transaction` appends to the ledger only. The
// invoice's `amount_paid` / `balance_due` / `status` are then re-projected by
// `syncInvoicePaymentProjection`. If that projection fails, the collection is
// still recorded — money that was genuinely taken from a customer must never be
// rolled back because a denormalised cache could not be refreshed. The ledger is
// the source of truth and the sync is idempotent, so a later call repairs drift.

import { revalidatePath } from "next/cache";

import {
  checkGroupManage,
  getCurrentAdminContext,
} from "@/lib/auth/adminAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { getISTDateString } from "@/lib/dates/ist";
import { logAdminAction } from "@/lib/logger";
import { recordSubscriptionPayment } from "@/repositories/subscriptionPaymentRepository";
import {
  getSubscriptionBalance,
  syncInvoicePaymentProjection,
} from "@/services/SubscriptionPaymentService";
import {
  recordSubscriptionPaymentSchema,
  recordSubscriptionRefundSchema,
} from "@/validations/subscriptionPaymentSchema";

export type RecordPaymentActionResult =
  | {
      success: true;
      /** Authoritative figures as committed, derived inside the row lock. */
      totalPaid: number;
      remainingBalance: number;
      isFullyPaid: boolean;
    }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string>;
      /** Present on AMOUNT_EXCEEDS_BALANCE — the live figure to re-display. */
      remainingBalance?: number;
    };

/**
 * Resolve the caller's franchise, used to prove a FRANCHISE_ADMIN owns the
 * subscription they are recording against.
 *
 * `getCurrentAdminContext` does not expose `franchise_id`, so it is read here
 * rather than trusting anything supplied by the client.
 */
async function resolveCallerFranchiseId(
  userId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("franchise_id")
    .eq("id", userId)
    .maybeSingle();
  return (data?.franchise_id as string | null) ?? null;
}

/**
 * Record a balance payment against a subscription.
 *
 * @param subscriptionId the subscription being paid down
 * @param customerProfileId used only to revalidate the right Customer 360 path
 * @param input           raw form input, re-validated here
 */
export async function recordSubscriptionBalancePaymentAction(
  subscriptionId: string,
  customerProfileId: string,
  input: unknown,
): Promise<RecordPaymentActionResult> {
  // ── 1. Authorise ─────────────────────────────────────────────────────────
  // Two legitimate callers reach this from the shared Customer 360 dashboard:
  // a Core admin and a Franchise admin. `checkGroupManage` admits only
  // ADMIN/MASTER_ADMIN, so a franchise user needs the second branch — plus proof
  // that the subscription is actually theirs, otherwise one franchise could
  // record payments against another's customers.
  const ctx = await getCurrentAdminContext();

  if (!ctx.userId) {
    return { success: false, error: "You must be signed in to record a payment." };
  }

  const admin = createAdminClient();

  // Load the subscription first — needed for the ownership check and to reject a
  // bad id before any write is attempted.
  const { data: subscription, error: subError } = await admin
    .from("subscriptions")
    .select("id, customer_profile_id, franchise_id, customer_category, total_payable")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (subError || !subscription) {
    return { success: false, error: "Subscription not found." };
  }

  if (ctx.roleCode === "ADMIN" || ctx.roleCode === "MASTER_ADMIN") {
    const gate = await checkGroupManage("customers");
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }
  } else if (ctx.roleCode === "FRANCHISE_ADMIN") {
    const callerFranchiseId = await resolveCallerFranchiseId(ctx.userId);
    if (
      !callerFranchiseId ||
      subscription.franchise_id !== callerFranchiseId
    ) {
      return {
        success: false,
        error: "You do not have permission to record payments for this customer.",
      };
    }
  } else {
    return {
      success: false,
      error: "You do not have permission to record payments.",
    };
  }

  // A subscription with no Total_Payable was a single full payment (or predates
  // this feature) and has no balance to pay down. The RPC rejects it too; saying
  // so here gives a clearer message than the generic reason.
  if (Number(subscription.total_payable ?? 0) <= 0) {
    return {
      success: false,
      error: "This subscription has no recorded balance to collect against.",
    };
  }

  // ── 2. Re-validate ───────────────────────────────────────────────────────
  const parsed = recordSubscriptionPaymentSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the payment details.",
      fieldErrors,
    };
  }

  const { amount, paymentMethod, paymentReference, comment, transactionDate } =
    parsed.data;

  // ── 3. Row-locked append ─────────────────────────────────────────────────
  const result = await recordSubscriptionPayment(
    {
      subscriptionId,
      transactionType: "PARTIAL_BALANCE_PAYMENT",
      amount,
      transactionDate: transactionDate ?? getISTDateString(0),
      paymentMethod,
      paymentReference: paymentReference?.trim() || null,
      comment: comment?.trim() || null,
      createdBy: ctx.userId,
    },
    admin,
  );

  if (!result.ok) {
    switch (result.reason) {
      case "AMOUNT_EXCEEDS_BALANCE":
        return {
          success: false,
          error: "The amount exceeds the remaining balance.",
          // The balance the RPC derived inside the lock — authoritative, and
          // possibly different from what this form was rendered with.
          remainingBalance: result.remainingBalance,
          fieldErrors: {
            amount: `Amount cannot exceed the remaining balance of ₹${result.remainingBalance.toFixed(2)}.`,
          },
        };
      case "AMOUNT_NOT_POSITIVE":
        return {
          success: false,
          error: "Amount must be greater than ₹0.",
          fieldErrors: { amount: "Amount must be greater than ₹0." },
        };
      case "NO_TOTAL_PAYABLE":
        return {
          success: false,
          error: "This subscription has no recorded balance to collect against.",
        };
      case "NOT_FOUND":
        return { success: false, error: "Subscription not found." };
      case "DUPLICATE_ADVANCE":
        return {
          success: false,
          error: "An advance payment already exists for this subscription.",
        };
      case "REFUND_EXCEEDS_EXCESS":
        return {
          success: false,
          error: "The refund exceeds the excess paid.",
        };
      default:
        return {
          success: false,
          error: result.message ?? "The payment could not be recorded.",
        };
    }
  }

  // ── 4. Project onto the single invoice ───────────────────────────────────
  // Deliberately AFTER the ledger append and deliberately not transactional with
  // it. See the module header: a projection failure must not discard a
  // collection that was actually taken.
  const sync = await syncInvoicePaymentProjection(subscriptionId, admin);

  await logAdminAction("CREATE", "subscription_balance_payment", subscriptionId, {
    amount,
    paymentMethod,
    totalPaid: result.totalPaid,
    remainingBalance: result.remainingBalance,
    transactionId: result.transaction.id,
    invoiceSynced: sync.ok,
  });

  // ── 5. Refresh the Customer 360 view ─────────────────────────────────────
  // Both portals share the dashboard, and the action serves both, so both paths
  // are invalidated. Revalidating a path the caller never visits is a no-op.
  revalidatePath(`/admin/customers/${customerProfileId}`);
  revalidatePath(`/franchise/customers/${customerProfileId}`);

  if (!sync.ok) {
    // The money IS recorded. Only the invoice's cached figures lag, and the next
    // successful sync repairs them — so this is a warning, not a failure.
    return {
      success: false,
      error:
        "The payment was recorded, but the invoice totals could not be refreshed. Reload the page; if the figures still look wrong, contact support.",
    };
  }

  return {
    success: true,
    totalPaid: result.totalPaid,
    remainingBalance: result.remainingBalance,
    isFullyPaid: Math.round(result.remainingBalance * 100) === 0,
  };
}

// ─── Early Closure / Tenure Recalculation — locked-amount refund ────────────
//
// Feature: meal-subscription-early-closure
//
// Deliberately separate from recordSubscriptionBalancePaymentAction rather than
// a shared form with a REFUND option: a refund here must be for EXACTLY the
// server-derived excess, never an admin-typed figure, because it exists to
// settle an over-collection created by shortening the subscription's tenure.
// The client never gets to edit the amount field; it only ever displays the
// live `refundDue` and resubmits it, and the RPC re-derives the excess from the
// ledger inside the row lock regardless of what was sent.

export type RecordRefundActionResult =
  | {
      success: true;
      totalPaid: number;
      remainingBalance: number;
      isFullyPaid: boolean;
    }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string>;
      /** Present when the requested amount no longer matches the live excess. */
      excess?: number;
    };

/**
 * Record a refund against a subscription that was over-collected (typically
 * after a tenure recalculation shortened it below what was already paid).
 *
 * @param subscriptionId the subscription being refunded
 * @param customerProfileId used only to revalidate the right Customer 360 path
 * @param input           raw form input; `amount` MUST equal the live
 *                         `refundDue` at submit time — enforced here, not just
 *                         by the UI, so a stale or tampered client request
 *                         cannot refund an arbitrary figure.
 */
export async function recordSubscriptionRefundAction(
  subscriptionId: string,
  customerProfileId: string,
  input: unknown,
): Promise<RecordRefundActionResult> {
  const ctx = await getCurrentAdminContext();

  if (!ctx.userId) {
    return { success: false, error: "You must be signed in to process a refund." };
  }

  const admin = createAdminClient();

  const { data: subscription, error: subError } = await admin
    .from("subscriptions")
    .select("id, customer_profile_id, franchise_id, total_payable")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (subError || !subscription) {
    return { success: false, error: "Subscription not found." };
  }

  if (ctx.roleCode === "ADMIN" || ctx.roleCode === "MASTER_ADMIN") {
    const gate = await checkGroupManage("customers");
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }
  } else if (ctx.roleCode === "FRANCHISE_ADMIN") {
    const callerFranchiseId = await resolveCallerFranchiseId(ctx.userId);
    if (
      !callerFranchiseId ||
      subscription.franchise_id !== callerFranchiseId
    ) {
      return {
        success: false,
        error: "You do not have permission to process refunds for this customer.",
      };
    }
  } else {
    return {
      success: false,
      error: "You do not have permission to process refunds.",
    };
  }

  // ── Re-validate ───────────────────────────────────────────────────────────
  const parsed = recordSubscriptionRefundSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the refund details.",
      fieldErrors,
    };
  }

  const { amount, remark, comment, transactionDate } = parsed.data;

  // The amount is LOCKED to the live excess — re-derive it server-side rather
  // than trusting the client's copy, and reject a submission that no longer
  // matches (the balance may have moved between page load and submit, e.g. a
  // second admin already processed part of it).
  const liveBalance = await getSubscriptionBalance(subscriptionId, admin);
  const liveExcess = liveBalance ? Math.max(-liveBalance.remainingBalance, 0) : 0;

  if (liveExcess <= 0) {
    return {
      success: false,
      error: "There is no refund due on this subscription.",
    };
  }

  if (Math.round(amount * 100) !== Math.round(liveExcess * 100)) {
    return {
      success: false,
      error: `The refund amount must exactly match the current excess of ₹${liveExcess.toFixed(2)}. Reload and try again.`,
      excess: liveExcess,
      fieldErrors: { amount: `Must equal ₹${liveExcess.toFixed(2)}.` },
    };
  }

  // ── Row-locked append ─────────────────────────────────────────────────────
  const result = await recordSubscriptionPayment(
    {
      subscriptionId,
      transactionType: "REFUND",
      amount,
      transactionDate: transactionDate ?? getISTDateString(0),
      paymentMethod: "REFUND",
      remark,
      comment: comment?.trim() || null,
      createdBy: ctx.userId,
    },
    admin,
  );

  if (!result.ok) {
    switch (result.reason) {
      case "REFUND_EXCEEDS_EXCESS":
        return {
          success: false,
          error: "The refund exceeds the excess paid.",
          excess: result.excess,
          fieldErrors: {
            amount: `Cannot exceed the excess of ₹${result.excess.toFixed(2)}.`,
          },
        };
      case "AMOUNT_NOT_POSITIVE":
        return {
          success: false,
          error: "Amount must be greater than ₹0.",
          fieldErrors: { amount: "Amount must be greater than ₹0." },
        };
      case "NO_TOTAL_PAYABLE":
        return {
          success: false,
          error: "This subscription has no recorded balance to refund against.",
        };
      case "NOT_FOUND":
        return { success: false, error: "Subscription not found." };
      case "DUPLICATE_ADVANCE":
        return {
          success: false,
          error: "An advance payment already exists for this subscription.",
        };
      default:
        return {
          success: false,
          error:
            "message" in result && result.message
              ? result.message
              : "The refund could not be recorded.",
        };
    }
  }

  const sync = await syncInvoicePaymentProjection(subscriptionId, admin);

  await logAdminAction("CREATE", "subscription_refund", subscriptionId, {
    amount,
    remark,
    totalPaid: result.totalPaid,
    remainingBalance: result.remainingBalance,
    transactionId: result.transaction.id,
    invoiceSynced: sync.ok,
  });

  revalidatePath(`/admin/customers/${customerProfileId}`);
  revalidatePath(`/franchise/customers/${customerProfileId}`);

  if (!sync.ok) {
    return {
      success: false,
      error:
        "The refund was recorded, but the invoice totals could not be refreshed. Reload the page; if the figures still look wrong, contact support.",
    };
  }

  return {
    success: true,
    totalPaid: result.totalPaid,
    remainingBalance: result.remainingBalance,
    isFullyPaid: Math.round(result.remainingBalance * 100) === 0,
  };
}
