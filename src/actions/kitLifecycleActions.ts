"use server";

// src/actions/kitLifecycleActions.ts
//
// Customer-facing server actions for KIT lifecycle management.
// Handles: marking KIT as received, starting a new KIT, fetching KIT history,
// and determining the KIT Tracker page display state.
//
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.3, 7.4, 7.5

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { startNewKitSchema } from "@/validations/kitLifecycleSchema";
import * as KitLifecycleService from "@/services/KitLifecycleService";
import * as repo from "@/repositories/kitLifecycleRepository";
import type { KitHistoryEntry } from "@/types/kitLifecycle";

// ---------------------------------------------------------------------------
// Types — KIT Tracker Display State (Discriminated Union)
// ---------------------------------------------------------------------------

/**
 * Discriminated union representing which UI state to show on the KIT Tracker page.
 *
 * Priority order (Req 7.5, Property 9):
 * 1. "start_flow" — new KIT delivered (delivered_at set), ready to start
 * 2. "receipt_flow" — new KIT shipped but not received
 * 3. "processing" — new KIT exists but no shipping info yet
 * 4. "expiration" — most recent KIT expired, no newer subscription
 * 5. "active" — KIT is ACTIVE, show normal tracker
 */
export type KitTrackerState =
  | {
      type: "start_flow";
      subscriptionId: string;
      deliveredAt: string;
      kitProductName?: string;
      kitDurationDays: number;
    }
  | {
      type: "receipt_flow";
      subscriptionId: string;
      courierPartner: string;
      trackingNumber: string;
      trackingUrl: string | null;
      shippedAt: string;
    }
  | {
      type: "processing";
      subscriptionId: string;
    }
  | {
      type: "expiration";
      message: string;
    }
  | {
      type: "active";
      subscriptionId: string;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Authenticate the current customer session and resolve their customer_profile_id.
 * Mirrors the pattern from shop-actions / addressActions.
 */
async function authenticateCustomer(): Promise<
  { success: true; customerProfileId: string } | { success: false; error: string }
> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  const { data: dbUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!dbUser) {
    return { success: false, error: "User not found." };
  }

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", dbUser.id)
    .single();

  if (!profile) {
    return { success: false, error: "Customer profile not found." };
  }

  return { success: true, customerProfileId: profile.id };
}

// ---------------------------------------------------------------------------
// 6.1 — markKitReceivedAction
// Requirements: 6.1
// ---------------------------------------------------------------------------

/**
 * Mark a PENDING KIT subscription as received (sets delivered_at on shipping info).
 * Does NOT start the KIT — the customer explicitly starts later via startNewKitAction.
 */
export async function markKitReceivedAction(
  subscriptionId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await authenticateCustomer();
  if (!auth.success) {
    return { success: false, error: auth.error };
  }

  const result = await KitLifecycleService.markKitReceived(
    subscriptionId,
    auth.customerProfileId
  );

  if ("success" in result && result.success) {
    revalidatePath("/kit-tracker");
    revalidatePath("/dashboard");
  }

  return result;
}

// ---------------------------------------------------------------------------
// 6.2 — startNewKitAction
// Requirements: 6.2, 6.3, 6.4, 6.5
// ---------------------------------------------------------------------------

/**
 * Start a new KIT — transition from PENDING to ACTIVE with chosen start date.
 * Validates input with Zod before delegating to the service layer.
 */
export async function startNewKitAction(
  subscriptionId: string,
  startDate: string
): Promise<{ success: true } | { success: false; error: string }> {
  // Validate input with Zod schema
  const parsed = startNewKitSchema.safeParse({ subscriptionId, startDate });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const auth = await authenticateCustomer();
  if (!auth.success) {
    return { success: false, error: auth.error };
  }

  const result = await KitLifecycleService.startNewKit(
    parsed.data.subscriptionId,
    parsed.data.startDate,
    auth.customerProfileId
  );

  if ("success" in result && result.success) {
    revalidatePath("/kit-tracker");
    revalidatePath("/dashboard");
  }

  return result;
}

// ---------------------------------------------------------------------------
// 6.3 — getKitHistoryAction
// Requirements: 8.2, 8.3, 8.4, 8.5, 8.6
// ---------------------------------------------------------------------------

/**
 * Fetch all KIT subscriptions for the authenticated customer as history entries.
 */
export async function getKitHistoryAction(): Promise<
  { success: true; history: KitHistoryEntry[] } | { success: false; error: string }
> {
  const auth = await authenticateCustomer();
  if (!auth.success) {
    return { success: false, error: auth.error };
  }

  try {
    const history = await KitLifecycleService.getKitHistory(auth.customerProfileId);
    return { success: true, history };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch KIT history.";
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// 6.4 — getKitTrackerStateAction
// Requirements: 7.1, 7.3, 7.4, 7.5, Property 9
// ---------------------------------------------------------------------------

/**
 * Determine which display state to show on the KIT Tracker page.
 *
 * Priority order (from design Property 9 / Req 7.5):
 * 1. start_flow: newer KIT subscription has delivered_at set → show "Start your new KIT"
 * 2. receipt_flow: newer KIT subscription shipped but not received → show "Mark as Received"
 * 3. processing: newer KIT subscription exists but no shipping info → show "order being processed"
 * 4. expiration: most recent KIT is EXPIRED with no newer PENDING/ACTIVE → show expiration message
 * 5. active: KIT is ACTIVE → show normal daily tracker
 */
export async function getKitTrackerStateAction(): Promise<
  { success: true; state: KitTrackerState } | { success: false; error: string }
> {
  const auth = await authenticateCustomer();
  if (!auth.success) {
    return { success: false, error: auth.error };
  }

  try {
    const subscriptions = await repo.getCustomerKitSubscriptions(
      auth.customerProfileId
    );

    // No KIT subscriptions at all
    if (subscriptions.length === 0) {
      return {
        success: true,
        state: { type: "expiration", message: "No KIT subscription found." },
      };
    }

    // Check for PENDING subscription (most recent first, ordered by created_at DESC)
    const pendingSub = subscriptions.find((s) => s.status === "PENDING");

    if (pendingSub) {
      // Get shipping info for this PENDING subscription
      const shippingInfo = await repo.getShippingInfo(pendingSub.id);

      if (shippingInfo && shippingInfo.delivered_at) {
        // Priority 1: delivered_at is set → start flow (Req 7.3 / criterion 3)
        return {
          success: true,
          state: {
            type: "start_flow",
            subscriptionId: pendingSub.id,
            deliveredAt: shippingInfo.delivered_at,
            kitDurationDays: pendingSub.kit_duration_days ?? 0,
          },
        };
      }

      if (shippingInfo && shippingInfo.shipped_at) {
        // Priority 2: shipped but not received → receipt flow (Req 7.4 / criterion 4)
        return {
          success: true,
          state: {
            type: "receipt_flow",
            subscriptionId: pendingSub.id,
            courierPartner: shippingInfo.courier_partner,
            trackingNumber: shippingInfo.tracking_number,
            trackingUrl: shippingInfo.tracking_url,
            shippedAt: shippingInfo.shipped_at,
          },
        };
      }

      // Priority 3: PENDING but no shipping info → processing (Req 5.4)
      return {
        success: true,
        state: {
          type: "processing",
          subscriptionId: pendingSub.id,
        },
      };
    }

    // No PENDING subscription — check the most recent subscription
    const mostRecent = subscriptions[0]; // ordered by created_at DESC

    if (mostRecent.status === "ACTIVE") {
      // Priority 5: ACTIVE KIT → show normal tracker
      return {
        success: true,
        state: {
          type: "active",
          subscriptionId: mostRecent.id,
        },
      };
    }

    if (mostRecent.status === "EXPIRED") {
      // Priority 4: EXPIRED with no PENDING → show expiration message (Req 7.1)
      return {
        success: true,
        state: {
          type: "expiration",
          message:
            "KIT has been expired, contact the admin to issue new KIT",
        },
      };
    }

    // Fallback — shouldn't normally reach here
    return {
      success: true,
      state: {
        type: "expiration",
        message: "No active KIT subscription found.",
      },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to determine KIT tracker state.";
    return { success: false, error: message };
  }
}
