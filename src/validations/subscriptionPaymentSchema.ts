// src/validations/subscriptionPaymentSchema.ts
//
// Validation for recording a balance payment against a MEAL subscription.
//
// Feature: meal-subscription-partial-payment
//
// The RPC re-checks the amount against the live balance inside a row lock, so
// this schema deliberately does NOT try to validate against a balance the client
// supplied — by submit time that figure may be stale. Its job is shape and
// bounds only; the authoritative "does this fit the balance" answer comes from
// `record_subscription_payment_transaction`.

import { z } from "zod";

/** Matches the NUMERIC(10,2) ceiling on `subscription_payment_transactions.amount`. */
export const MAX_SUBSCRIPTION_PAYMENT_AMOUNT = 9_999_999.99;

/** How the money arrived. Free-form on the column; constrained here for the UI. */
export const SUBSCRIPTION_PAYMENT_METHODS = [
  "COUNTER",
  "CASH",
  "UPI",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER",
] as const;

export type SubscriptionPaymentMethod =
  (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

export const recordSubscriptionPaymentSchema = z.object({
  amount: z
    .coerce.number({ message: "Enter a valid amount." })
    .positive("Amount must be greater than ₹0.")
    .max(
      MAX_SUBSCRIPTION_PAYMENT_AMOUNT,
      `Amount cannot exceed ₹${MAX_SUBSCRIPTION_PAYMENT_AMOUNT.toLocaleString("en-IN")}.`,
    )
    .refine(
      // Money has at most 2 decimals. Checked in the integer domain because
      // `value * 100 % 1` on a float can report a remainder for a perfectly
      // valid figure like 3583.29.
      (value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6,
      "Amount cannot have more than 2 decimal places.",
    ),

  paymentMethod: z.enum(SUBSCRIPTION_PAYMENT_METHODS, {
    message: "Select how the payment was collected.",
  }),

  /** Cheque number, UPI reference, receipt number — whatever ties it to reality. */
  paymentReference: z
    .string()
    .max(200, "Reference must be at most 200 characters.")
    .optional()
    .or(z.literal("")),

  comment: z
    .string()
    .max(500, "Comment must be at most 500 characters.")
    .optional()
    .or(z.literal("")),

  /**
   * The business date money changed hands, which is not always today — an admin
   * may be recording yesterday's counter collection.
   */
  transactionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .optional(),
});

export type RecordSubscriptionPaymentInput = z.input<
  typeof recordSubscriptionPaymentSchema
>;

// ─── Early Closure / Tenure Recalculation ───────────────────────────────────
//
// Feature: meal-subscription-early-closure
//
// Shape-and-bounds validation only. The RPC re-validates the end-date range and
// the "strictly lower than current" rule for both charge fields inside the row
// lock, since the client's copy of those figures may be stale by submit time.

export const recalculateSubscriptionTenureSchema = z.object({
  newEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid end date."),

  newBaseAmount: z
    .coerce.number({ message: "Enter a valid subscription charge." })
    .min(0, "Subscription charge cannot be negative.")
    .max(9_999_999.99, "Subscription charge is too large.")
    .refine(
      (value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6,
      "Amount cannot have more than 2 decimal places.",
    ),

  newDeliveryCharge: z
    .coerce.number({ message: "Enter a valid delivery charge." })
    .min(0, "Delivery charge cannot be negative.")
    .max(999_999.99, "Delivery charge is too large.")
    .refine(
      (value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6,
      "Amount cannot have more than 2 decimal places.",
    ),

  /** Admin acknowledgment gate — enforced client-side too, re-checked here. */
  acknowledged: z.literal(true, {
    message: "Confirm you have communicated the settlement to the customer.",
  }),
});

export type RecalculateSubscriptionTenureInput = z.input<
  typeof recalculateSubscriptionTenureSchema
>;

/**
 * Recording a refund is deliberately NOT a free-typed amount. The amount is
 * always the server-derived excess at submit time; the client sends it back
 * only so the RPC's row-locked check can confirm it hasn't drifted, and the
 * error message on mismatch is exactly the same "excess exceeded" path the
 * ledger RPC already returns.
 */
export const recordSubscriptionRefundSchema = z.object({
  amount: z
    .coerce.number({ message: "Enter a valid amount." })
    .positive("Refund amount must be greater than ₹0.")
    .max(MAX_SUBSCRIPTION_PAYMENT_AMOUNT),

  remark: z
    .string()
    .trim()
    .min(1, "A remark is required before processing a refund.")
    .max(500, "Remark must be at most 500 characters."),

  comment: z
    .string()
    .max(500, "Comment must be at most 500 characters.")
    .optional()
    .or(z.literal("")),

  transactionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .optional(),
});

export type RecordSubscriptionRefundInput = z.input<
  typeof recordSubscriptionRefundSchema
>;
