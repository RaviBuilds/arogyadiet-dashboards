"use server";

// Customer PIN management actions for changing PIN from profile page

import * as PinService from "@/services/PinService";
import { normalizeMobile, isValidPinFormat } from "@/lib/pin/pinUtils";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChangePinResult =
  | { outcome: "OK" }
  | { outcome: "INVALID"; message: string }
  | { outcome: "MISMATCH"; message: string }
  | { outcome: "INVALID_FORMAT"; message: string }
  | { outcome: "ERROR"; message: string };

/**
 * Change PIN for the currently authenticated customer.
 * Verifies current PIN, validates new PIN format, and updates.
 */
export async function changePinAction(
  currentPin: string,
  newPin: string,
  confirmPin: string,
): Promise<ChangePinResult> {
  // 1. Validate PIN formats
  if (!isValidPinFormat(currentPin) || !isValidPinFormat(newPin) || !isValidPinFormat(confirmPin)) {
    return {
      outcome: "INVALID_FORMAT",
      message: "PIN must be exactly 6 digits",
    };
  }

  // 2. Check PINs match
  if (newPin !== confirmPin) {
    return {
      outcome: "MISMATCH",
      message: "New PINs do not match",
    };
  }

  // 3. Get authenticated user's mobile from session
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      outcome: "ERROR",
      message: "Not authenticated",
    };
  }

  // Get mobile from users table
  const admin = createAdminClient();
  const { data: dbUser } = await admin
    .from("users")
    .select("mobile")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!dbUser?.mobile) {
    return {
      outcome: "ERROR",
      message: "User mobile not found",
    };
  }

  const mobile = dbUser.mobile;

  // 4. Verify current PIN
  const verifyResult = await PinService.verifyPin(mobile, currentPin);

  if (!verifyResult || !verifyResult.valid) {
    return {
      outcome: "INVALID",
      message: "Current PIN is incorrect",
    };
  }

  // 5. Set new permanent PIN
  try {
    await PinService.setPermanentPin(mobile, newPin);
    return { outcome: "OK" };
  } catch (error) {
    console.error("[pinManagementActions] setPermanentPin failed:", error);
    return {
      outcome: "ERROR",
      message: "Failed to update PIN. Please try again.",
    };
  }
}
