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
