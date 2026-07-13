"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import {
  computeForCustomer,
  computeForAddress,
  type DeliveryChargeOutcome,
} from "@/services/DeliveryChargeService";

/**
 * Calculates the delivery charge for a customer given their profile and plan
 * duration. Gated by admin authorization (checkGroupManage("customers")).
 *
 * Returns the full DeliveryChargeOutcome so the admin UI can display
 * distance/rate note or the precise failure message.
 *
 * Requirements: 7.2, 8.1, 8.2
 */
export async function calculateDeliveryChargeAction(input: {
  customerProfileId: string;
  planDays: number;
}): Promise<
  | { success: true; outcome: DeliveryChargeOutcome }
  | { success: false; error: string }
> {
  // Admin authorization gate
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    const db = createAdminClient();
    const outcome = await computeForCustomer(db, {
      customerProfileId: input.customerProfileId,
      planDays: input.planDays,
    });

    return { success: true, outcome };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to calculate delivery charge";
    return { success: false, error: message };
  }
}

/**
 * Calculates the delivery charge using address data directly (no customerProfileId needed).
 * Used during Quick Onboarding when the customer does not yet exist.
 *
 * Gated by admin authorization (checkGroupManage("customers")).
 *
 * Requirements: 7.2
 */
export async function calculateDeliveryChargeForAddressAction(input: {
  address: { pincode: string | null; lat: number | null; lng: number | null };
  planDays: number;
}): Promise<
  | { success: true; outcome: DeliveryChargeOutcome }
  | { success: false; error: string }
> {
  // Admin authorization gate
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    const db = createAdminClient();
    const outcome = await computeForAddress(db, {
      address: input.address,
      planDays: input.planDays,
    });

    return { success: true, outcome };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to calculate delivery charge";
    return { success: false, error: message };
  }
}
