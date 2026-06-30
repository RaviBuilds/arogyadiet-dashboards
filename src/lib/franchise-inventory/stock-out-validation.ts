// src/lib/franchise-inventory/stock-out-validation.ts
// Pure stock-out input validation for franchise inventory.
// Validates reason, quantity, comment (when OTHER), and available stock.
// No DB access — this is pure computation suitable for property-based testing.
//
// Requirements validated: 10.1, 10.3, 10.4, 10.5, 10.6, 12.6

import type { StockOutReason } from "@/types/franchiseInventory";

// ─────────────────────────────────────────────────────────────────────────────
// Allowed stock-out reasons (same set as STOCK_OUT_REASONS in validations)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_REASONS: readonly StockOutReason[] = [
  "MEAL_SUBSCRIPTION_SALE",
  "KIT_SUBSCRIPTION_SALE",
  "ONE_TIME_PURCHASE_SALE",
  "SPOILED",
  "DAMAGED",
  "OTHER",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input / Result types
// ─────────────────────────────────────────────────────────────────────────────

export interface StockOutValidationInput {
  reason: string;
  quantity: number;
  comment: string | null;
  availableQuantity: number;
}

export type StockOutValidationResult =
  | { valid: true }
  | {
      valid: false;
      error: string;
      code:
        | "INVALID_REASON"
        | "INVALID_QUANTITY"
        | "COMMENT_REQUIRED"
        | "INSUFFICIENT_STOCK";
      requested?: number;
      available?: number;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Validation function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a stock-out input in the following order:
 * 1. Reason must be in the allowed set.
 * 2. Quantity must be a positive whole number (integer > 0).
 * 3. When reason is OTHER, the comment must be a string of length 1–500.
 * 4. Requested quantity must not exceed available quantity.
 *
 * Returns early on the first validation failure.
 */
export function validateStockOutInput(
  input: StockOutValidationInput,
): StockOutValidationResult {
  // 1. Validate reason is in the allowed set (Requirement 10.1)
  if (!ALLOWED_REASONS.includes(input.reason as StockOutReason)) {
    return {
      valid: false,
      error: `Invalid stock-out reason: "${input.reason}". Must be one of: ${ALLOWED_REASONS.join(", ")}`,
      code: "INVALID_REASON",
    };
  }

  // 2. Validate quantity is a positive whole number (Requirement 10.4)
  if (
    !Number.isFinite(input.quantity) ||
    !Number.isInteger(input.quantity) ||
    input.quantity <= 0
  ) {
    return {
      valid: false,
      error: `Invalid quantity: quantity must be a positive whole number`,
      code: "INVALID_QUANTITY",
    };
  }

  // 3. Validate comment when reason is OTHER (Requirements 10.5, 10.6)
  if (input.reason === "OTHER") {
    if (
      input.comment === null ||
      input.comment === undefined ||
      typeof input.comment !== "string" ||
      input.comment.length < 1 ||
      input.comment.length > 500
    ) {
      return {
        valid: false,
        error: `Comment is required when reason is OTHER (must be 1–500 characters)`,
        code: "COMMENT_REQUIRED",
      };
    }
  }

  // 4. Available-stock check (Requirements 10.3, 12.6)
  if (input.quantity > input.availableQuantity) {
    return {
      valid: false,
      error: `Insufficient stock: requested ${input.quantity} but only ${input.availableQuantity} available`,
      code: "INSUFFICIENT_STOCK",
      requested: input.quantity,
      available: input.availableQuantity,
    };
  }

  return { valid: true };
}
