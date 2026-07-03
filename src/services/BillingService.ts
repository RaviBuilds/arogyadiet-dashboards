// src/services/BillingService.ts
// Business service for onboarding invoices, backed by the `payments` table.
//
// LAYERING: Server-only business logic. It receives an injected Supabase
// service-role client (`admin`) rather than constructing one, mirroring the
// `SupabaseClient`-parameter pattern used across `src/lib/*` (e.g.
// `stampCustomerByPrimaryAddress`, `resolveSubscriptionCoupon`). Passing the
// client in keeps the write/read logic deterministic and unit/property-testable
// against an in-memory fake client, and lets the caller share one admin client
// across the onboarding flow.
//
// SCOPE NOTE: During the primary onboarding path the atomic `onboard_customer`
// PL/pgSQL RPC already inserts the PAID `payments` row *inside the transaction*
// (see `scripts/create-onboard-customer-rpc.sql`). This service exists for the
// NON-RPC paths: add-on invoices, the idempotency guard against a second PAID
// row for a subscription, and the read helpers backing the customer Billing
// view.
//
// Requirements: 8.3, 8.4, 8.6, 11.3, 11.4

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The status value used for a recorded (collected) invoice. The onboarding
 * flow always records payment as PAID (Req 8.3); the duplicate guard in
 * {@link recordOnboardingInvoice} also keys off this exact value (Req 8.4).
 */
export const PAID_STATUS = "PAID" as const;

/** Default invoice classification, matching `payments.invoice_type` default. */
export const DEFAULT_INVOICE_TYPE = "SUBSCRIPTION" as const;

/**
 * The minimal description of the subscription being invoiced. `amountDue` is
 * the subscription amount due, which becomes the recorded `payments.amount`
 * (Req 8.3). `customerProfileId`/`franchiseId` are stamped onto the row when
 * provided so the invoice is scoped consistently with the rest of onboarding.
 */
export interface OnboardingInvoiceInput {
  /** `subscriptions.id` the invoice belongs to. */
  subscriptionId: string;
  /** The subscription amount due; recorded verbatim as `payments.amount`. */
  amountDue: number;
  /** `payments.customer_profile_id`, when known. */
  customerProfileId?: string | null;
  /** `payments.franchise_id`, when known. */
  franchiseId?: string | null;
  /** Optional invoice classification; defaults to `SUBSCRIPTION`. */
  invoiceType?: string;
}

/**
 * Outcome of {@link recordOnboardingInvoice}.
 *   - `RECORDED`         — exactly one PAID row was created (Req 8.3/8.6).
 *   - `ALREADY_RECORDED` — a PAID row already existed; nothing was written and
 *                          the existing row is left unchanged (Req 8.4).
 *   - `ERROR`            — the read or insert failed; no partial state.
 */
export type RecordInvoiceResult =
  | {
      ok: true;
      status: "RECORDED";
      paymentId: string;
      amount: number;
      paidAt: string;
    }
  | {
      ok: false;
      status: "ALREADY_RECORDED";
      existingPaymentId: string;
      message: string;
    }
  | { ok: false; status: "ERROR"; message: string };

/** A single invoice as rendered by the customer Billing view (Req 11.3). */
export interface InvoiceView {
  /** `payments.id`. */
  id: string;
  /** `payments.subscription_id`. */
  subscriptionId: string | null;
  /** Invoice amount (Req 11.3). */
  amount: number;
  /** Payment status, e.g. `PAID`/`PENDING` (Req 11.3). */
  status: string | null;
  /** Issue date — the row's `created_at` (Req 11.3). */
  issuedAt: string | null;
  /** When payment was collected, if recorded. */
  paidAt: string | null;
  /** Invoice classification. */
  invoiceType: string | null;
}

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

interface PaymentIdRow {
  id: string;
}

interface PaymentViewRow {
  id: string;
  subscription_id: string | null;
  amount: number | string | null;
  status: string | null;
  created_at: string | null;
  paid_at: string | null;
  invoice_type: string | null;
}

const INVOICE_COLUMNS =
  "id, subscription_id, amount, status, created_at, paid_at, invoice_type";

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Record the onboarding invoice for a subscription as a single PAID
 * `payments` row (Req 8.3/8.6): `amount` equals the subscription amount due and
 * `paid_at` is set to now.
 *
 * Idempotency guard (Req 8.4): if a PAID `payments` row already exists for the
 * subscription this rejects the duplicate, leaves the existing row untouched,
 * and returns `ALREADY_RECORDED` — it never creates a second invoice. This
 * preserves the "exactly one invoice per onboarded subscription" invariant on
 * the non-RPC paths (the RPC path enforces the same via its single in-transaction
 * insert).
 *
 * @param subscription  The subscription/amount being invoiced.
 * @param admin         A Supabase service-role client (injected for testability).
 * @param now           Injection point for the paid-at timestamp; defaults to
 *                      the current time. Callers normally omit this.
 */
export async function recordOnboardingInvoice(
  subscription: OnboardingInvoiceInput,
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<RecordInvoiceResult> {
  // 1) Reject if a PAID invoice already exists for this subscription (Req 8.4).
  const { data: existing, error: lookupError } = await admin
    .from("payments")
    .select("id")
    .eq("subscription_id", subscription.subscriptionId)
    .eq("status", PAID_STATUS)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    return {
      ok: false,
      status: "ERROR",
      message: `Failed to check for an existing invoice: ${lookupError.message}`,
    };
  }

  if (existing) {
    return {
      ok: false,
      status: "ALREADY_RECORDED",
      existingPaymentId: (existing as PaymentIdRow).id,
      message: "Payment is already recorded for this subscription.",
    };
  }

  // 2) Insert exactly one PAID row: amount = amount due, paid_at = now
  //    (Req 8.3/8.6).
  const paidAt = now.toISOString();
  const insertRow: Record<string, unknown> = {
    subscription_id: subscription.subscriptionId,
    amount: subscription.amountDue,
    status: PAID_STATUS,
    paid_at: paidAt,
    invoice_type: subscription.invoiceType ?? DEFAULT_INVOICE_TYPE,
  };
  if (subscription.customerProfileId != null) {
    insertRow.customer_profile_id = subscription.customerProfileId;
  }
  if (subscription.franchiseId != null) {
    insertRow.franchise_id = subscription.franchiseId;
  }

  const { data: inserted, error: insertError } = await admin
    .from("payments")
    .insert(insertRow)
    .select("id")
    .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      status: "ERROR",
      message:
        insertError?.message ?? "Failed to record the onboarding invoice.",
    };
  }

  return {
    ok: true,
    status: "RECORDED",
    paymentId: (inserted as PaymentIdRow).id,
    amount: subscription.amountDue,
    paidAt,
  };
}

// ---------------------------------------------------------------------------
// Reads (customer Billing view — Req 11.3/11.4)
// ---------------------------------------------------------------------------

/**
 * Fetch the invoice(s) recorded for a subscription, newest first, for the
 * customer Billing view (Req 11.3). Returns an empty array when none exist so
 * the caller can render the "no invoice found" state (Req 11.4) — a missing
 * invoice is a normal display case, not an error.
 */
export async function getSubscriptionInvoices(
  subscriptionId: string,
  admin: SupabaseClient,
): Promise<InvoiceView[]> {
  const { data, error } = await admin
    .from("payments")
    .select(INVOICE_COLUMNS)
    .eq("subscription_id", subscriptionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to load invoices for subscription ${subscriptionId}: ${error.message}`,
    );
  }

  return (data ?? []).map((row) => toInvoiceView(row as PaymentViewRow));
}

/**
 * Fetch every invoice for a customer, newest first, for the Billing view
 * (Req 11.3). Returns an empty array when none exist so the caller can render
 * the "no invoice found" state (Req 11.4).
 */
export async function getCustomerInvoices(
  customerProfileId: string,
  admin: SupabaseClient,
): Promise<InvoiceView[]> {
  const { data, error } = await admin
    .from("payments")
    .select(INVOICE_COLUMNS)
    .eq("customer_profile_id", customerProfileId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to load invoices for customer ${customerProfileId}: ${error.message}`,
    );
  }

  return (data ?? []).map((row) => toInvoiceView(row as PaymentViewRow));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Maps a raw `payments` row to the Billing-view shape (Req 11.3). */
function toInvoiceView(row: PaymentViewRow): InvoiceView {
  return {
    id: String(row.id),
    subscriptionId: row.subscription_id ?? null,
    amount: Number(row.amount ?? 0),
    status: row.status ?? null,
    issuedAt: row.created_at ?? null,
    paidAt: row.paid_at ?? null,
    invoiceType: row.invoice_type ?? null,
  };
}
