"use server";

// src/actions/admin-actions/adminPinActions.ts
// Admin server actions for PIN lifecycle management (customer-pin-auth feature).
//
// This module exposes admin-only operations related to customer PIN management,
// specifically the ability to reset a customer's PIN from the Customer 360 view.
//
// SECURITY: The plaintext PIN is passed only to the PinService for hashing.
// After hashing, the plaintext value is never stored, logged, or returned.
//
// Requirements: 7.4, 7.5, 7.6

import { isValidPinFormat } from "@/lib/pin/pinUtils";
import { resetPinToTemporary } from "@/services/PinService";

/**
 * Reset a customer's PIN to a new admin-set temporary PIN.
 *
 * Called from the Customer 360 "Reset PIN" dialog. After this operation the
 * customer will be forced to set a new permanent PIN on their next login
 * (Temp_PIN_Flag is set to true).
 *
 * - Validates PIN format before any database work (Req 7.3, 7.6).
 * - Delegates hashing and persistence to `PinService.resetPinToTemporary` (Req 7.4).
 * - Never stores or logs the plaintext PIN after hashing (Req 7.6).
 * - Returns a simple success/error result for UI consumption (Req 7.5).
 *
 * @param userId - The UUID primary key of the customer's `users` row.
 * @param newPin - The new 6-digit numeric temporary PIN set by the admin.
 * @returns `{ success: true }` on success, or `{ success: false, error: string }` on failure.
 *
 * Validates: Requirements 7.4, 7.5, 7.6.
 */
export async function resetCustomerPinAction(
  userId: string,
  newPin: string,
): Promise<{ success: boolean; error?: string }> {
  // 1. Validate PIN format before any further processing (Req 7.3, 7.6).
  if (!isValidPinFormat(newPin)) {
    return { success: false, error: "PIN must be exactly 6 numeric digits." };
  }

  try {
    // 2. Delegate to PinService which handles hashing + DB update.
    //    After this call, the plaintext PIN is no longer referenced (Req 7.6).
    await resetPinToTemporary(userId, newPin);

    return { success: true };
  } catch {
    // 3. Return generic error message — do not leak internal details (Req 7.5).
    return { success: false, error: "Failed to reset PIN. Please try again." };
  }
}
