// src/services/KitLifecycleService.ts
//
// Business logic layer for KIT subscription lifecycle management.
// Handles expiration detection, eligibility checks, new KIT creation,
// receipt/start flows, and history derivation.
//
// LAYERING: This module applies business rules and validations.
// Data access is delegated to `src/repositories/kitLifecycleRepository`.
// Server action wrappers live in `src/actions/*`.
//
// Requirements: 1.2, 1.3, 1.6, 1.7, 1.8, 3.1–3.6, 4.9–4.12,
//               6.1–6.6, 8.2–8.6, 11.3, 11.4, 12.1

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

import { getISTDateString } from "@/lib/dates/ist";
import * as repo from "@/repositories/kitLifecycleRepository";
import type {
  ExpireCronsResult,
  KitEligibility,
  KitHistoryEntry,
  SendNewKitInput,
} from "@/types/kitLifecycle";

// ---------------------------------------------------------------------------
// 3.1 — Expiration Logic
// Requirements: 1.2, 1.3, 1.6, 1.7, 1.8, 12.1
// ---------------------------------------------------------------------------

/**
 * Find and expire all KIT subscriptions whose tracking period has ended.
 *
 * The cron executes daily. This function:
 * 1. Computes the current IST date (UTC+5:30)
 * 2. Queries for ACTIVE KIT subscriptions past their tracker_end_date
 * 3. Batch-updates them to EXPIRED atomically
 *
 * Returns success with count=0 when no subscriptions need expiration (idempotent).
 *
 * Validates: Requirements 1.2, 1.3, 1.6, 1.7, 1.8, 12.1
 */
export async function expireEligibleKits(): Promise<ExpireCronsResult> {
  try {
    // Compute current IST date (UTC+5:30) — the cron targets ~00:00 IST
    const currentISTDate = getISTDateString(0);

    // Find all ACTIVE KIT subscriptions past their tracker end date
    const expiredSubscriptions =
      await repo.findExpiredKitSubscriptions(currentISTDate);

    // Handle empty result — 0 expired is a success (idempotent)
    if (expiredSubscriptions.length === 0) {
      return { success: true, expired: 0 };
    }

    // Extract IDs and batch-update to EXPIRED atomically
    const ids = expiredSubscriptions.map((sub) => sub.id);
    const updatedCount = await repo.batchUpdateStatus(ids, "EXPIRED");

    return { success: true, expired: updatedCount };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during expiration";
    return { success: false, expired: 0, error: message };
  }
}

// ---------------------------------------------------------------------------
// 3.2 — Eligibility Check
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
// ---------------------------------------------------------------------------

/**
 * Determine if the admin can send a new KIT to this customer.
 *
 * Eligible when:
 *   (a) Most recent KIT subscription is EXPIRED, OR
 *   (b) Most recent KIT subscription is ACTIVE with ≤5 days remaining
 * AND:
 *   (c) No PENDING KIT subscription exists for this customer
 *   (d) At least one KIT subscription exists
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
export async function checkEligibility(
  customerProfileId: string
): Promise<KitEligibility> {
  // (d) Check if at least one KIT subscription exists
  const mostRecent = await repo.getMostRecentKitSubscription(customerProfileId);

  if (!mostRecent) {
    // No KIT subscriptions exist — not eligible (Req 3.6)
    return { eligible: false, reason: "not_eligible" };
  }

  // (c) Check no PENDING exists (Req 3.5)
  const hasPendingOrActive = await repo.hasActiveOrPending(customerProfileId);

  // If there's a PENDING subscription, not eligible regardless of other state
  // We need to distinguish: hasActiveOrPending returns true for ACTIVE too.
  // We check specifically: if the most recent is PENDING, not eligible (Req 3.4)
  if (mostRecent.status === "PENDING") {
    return { eligible: false, reason: "not_eligible" };
  }

  // (a) Most recent is EXPIRED → eligible (unless PENDING exists elsewhere)
  if (mostRecent.status === "EXPIRED") {
    // Check if there's already a PENDING subscription (Req 3.5)
    // hasActiveOrPending checks for both — if mostRecent is EXPIRED and
    // hasActiveOrPending is true, it means a PENDING exists
    if (hasPendingOrActive) {
      return { eligible: false, reason: "not_eligible" };
    }
    return { eligible: true, reason: "expired" };
  }

  // (b) Most recent is ACTIVE — check days remaining
  if (mostRecent.status === "ACTIVE") {
    const currentISTDate = getISTDateString(0);

    if (!mostRecent.kit_tracker_end_date) {
      // No end date computed yet — not eligible
      return { eligible: false, reason: "not_eligible" };
    }

    const endDate = parseISO(mostRecent.kit_tracker_end_date);
    const today = parseISO(currentISTDate);
    const daysRemaining = differenceInCalendarDays(endDate, today);

    if (daysRemaining <= 5) {
      // ≤5 days remaining — eligible (expiring soon)
      // But still check no PENDING exists. Since mostRecent is ACTIVE,
      // hasActiveOrPending is true because of it. We need to check if a
      // separate PENDING also exists. The repo returns true if ANY
      // PENDING or ACTIVE exists. Since the mostRecent IS ACTIVE,
      // hasActiveOrPending will always be true here. We need a different check.
      // Let's check getCustomerKitSubscriptions for any PENDING.
      const allSubs = await repo.getCustomerKitSubscriptions(customerProfileId);
      const hasPending = allSubs.some((s) => s.status === "PENDING");

      if (hasPending) {
        return { eligible: false, reason: "not_eligible" };
      }

      return {
        eligible: true,
        reason: "expiring_soon",
        daysRemaining,
      };
    }

    // More than 5 days remaining — not eligible (Req 3.3)
    return { eligible: false, reason: "not_eligible", daysRemaining };
  }

  // Fallback — not eligible
  return { eligible: false, reason: "not_eligible" };
}

// ---------------------------------------------------------------------------
// 3.3 — Create New KIT
// Requirements: 4.9, 4.10, 4.11, 4.12, 11.3, 11.4
// ---------------------------------------------------------------------------

/**
 * Create a new KIT subscription for a customer.
 *
 * Validates no existing PENDING/ACTIVE KIT subscription exists (Req 11.3, 11.4),
 * then creates the subscription record (status=PENDING) and associated
 * kit_shipping_info with shipping details.
 *
 * Validates: Requirements 4.9, 4.10, 4.11, 4.12, 11.3, 11.4
 */
export async function createNewKit(
  input: SendNewKitInput
): Promise<{ success: true; subscriptionId: string } | { success: false; error: string }> {
  try {
    // Validate no existing PENDING or ACTIVE KIT subscription (Req 11.3, 11.4, 4.12)
    const exists = await repo.hasActiveOrPending(input.customerProfileId);
    if (exists) {
      return {
        success: false,
        error: "A pending or active KIT already exists for this customer.",
      };
    }

    // Create the subscription with status=PENDING (Req 4.10)
    const subscriptionId = await repo.createKitSubscription({
      customer_profile_id: input.customerProfileId,
      customer_category: "KIT",
      status: "PENDING",
      kit_product_id: input.kitProductId,
      kit_duration_days: input.kitDurationDays,
    });

    // Create kit_shipping_info with shipped_at=NOW() (Req 4.10)
    await repo.createShippingInfo({
      customer_profile_id: input.customerProfileId,
      subscription_id: subscriptionId,
      courier_partner: input.courierPartner,
      tracking_number: input.trackingNumber,
      tracking_url: input.trackingUrl ?? null,
      shipped_at: new Date().toISOString(),
    });

    return { success: true, subscriptionId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create KIT order";
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// 3.4 — Mark Received and Start KIT
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
// ---------------------------------------------------------------------------

/**
 * Mark a PENDING KIT as received (sets delivered_at on kit_shipping_info).
 *
 * Validates:
 * - Subscription exists and belongs to the customer (ownership)
 * - Subscription has customer_category = 'KIT' (category isolation)
 * - Subscription has status PENDING
 *
 * Does NOT set kit_received_date (that happens at start time).
 *
 * Validates: Requirements 6.1
 */
export async function markKitReceived(
  subscriptionId: string,
  customerId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    // Validate ownership + category
    const subscription = await repo.getSubscriptionWithOwner(subscriptionId);

    if (!subscription) {
      return { success: false, error: "Subscription not found." };
    }

    if (subscription.customer_profile_id !== customerId) {
      return { success: false, error: "Unauthorized: subscription does not belong to this customer." };
    }

    if (subscription.customer_category !== "KIT") {
      return { success: false, error: "Category mismatch: not a KIT subscription." };
    }

    if (subscription.status !== "PENDING") {
      return { success: false, error: "Only PENDING subscriptions can be marked as received." };
    }

    // Set delivered_at timestamp (Req 6.1)
    await repo.markKitDelivered(subscriptionId);

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not mark KIT as received.";
    return { success: false, error: message };
  }
}

/**
 * Start a new KIT — transition from PENDING to ACTIVE.
 *
 * Validates:
 * - Subscription exists and belongs to the customer
 * - Subscription has customer_category = 'KIT'
 * - Subscription has status PENDING
 * - delivered_at is set (customer has received the KIT)
 * - startDate ≤ current IST date (not in the future)
 * - startDate ≥ delivered_at date (not before delivery)
 * - No other ACTIVE KIT subscription exists for the customer
 *
 * Computes end_date = startDate + (kit_duration_days - 1) + kit_total_skipped_days
 *
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6
 */
export async function startNewKit(
  subscriptionId: string,
  startDate: string,
  customerId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    // Validate ownership + category
    const subscription = await repo.getSubscriptionWithOwner(subscriptionId);

    if (!subscription) {
      return { success: false, error: "Subscription not found." };
    }

    if (subscription.customer_profile_id !== customerId) {
      return { success: false, error: "Unauthorized: subscription does not belong to this customer." };
    }

    if (subscription.customer_category !== "KIT") {
      return { success: false, error: "Category mismatch: not a KIT subscription." };
    }

    if (subscription.status !== "PENDING") {
      return { success: false, error: "Only PENDING subscriptions can be started." };
    }

    // Validate delivered_at is set (customer must have received the KIT)
    const shippingInfo = await repo.getShippingInfo(subscriptionId);

    if (!shippingInfo || !shippingInfo.delivered_at) {
      return { success: false, error: "KIT must be marked as received before starting." };
    }

    // Validate startDate ≤ current IST date (Req 6.3 — not in the future)
    const currentISTDate = getISTDateString(0);
    if (startDate > currentISTDate) {
      return { success: false, error: "Start date cannot be in the future." };
    }

    // Validate startDate ≥ delivered_at date (Req 6.3)
    const deliveredAtDate = format(
      parseISO(shippingInfo.delivered_at),
      "yyyy-MM-dd"
    );
    if (startDate < deliveredAtDate) {
      return { success: false, error: "Start date cannot be before delivery date." };
    }

    // Check no other ACTIVE KIT subscription exists (Req 6.5)
    const allSubs = await repo.getCustomerKitSubscriptions(customerId);
    const hasOtherActive = allSubs.some(
      (s) => s.id !== subscriptionId && s.status === "ACTIVE"
    );

    if (hasOtherActive) {
      return {
        success: false,
        error: "Existing KIT must expire before a new KIT can be started.",
      };
    }

    // Compute end_date = startDate + (duration - 1) + skipped_days (Req 6.4)
    const duration = subscription.kit_duration_days ?? 0;
    const skippedDays = subscription.kit_total_skipped_days ?? 0;
    const totalDaysToAdd = duration - 1 + skippedDays;

    const startDateObj = parseISO(startDate);
    const endDateObj = addDays(startDateObj, totalDaysToAdd);
    const endDate = format(endDateObj, "yyyy-MM-dd");

    // Update record: set kit_received_date, kit_tracker_end_date, status=ACTIVE
    await repo.startKit(subscriptionId, startDate, endDate);

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "KIT could not be started.";
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// 3.5 — KIT History
// Requirements: 8.2, 8.3, 8.4, 8.5, 8.6
// ---------------------------------------------------------------------------

/**
 * Fetch all KIT subscriptions for a customer and derive display fields.
 *
 * Derives:
 * - daysTakenMeal: count of daily logs with status 'FOOD_TAKEN'
 * - shippingStatus: "Not Shipped" | "Shipped" | "Delivered"
 * - canDownloadReport: false for PENDING subscriptions
 *
 * Ordered by created_at descending (newest first).
 *
 * Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6
 */
export async function getKitHistory(
  customerProfileId: string
): Promise<KitHistoryEntry[]> {
  const historyRows = await repo.getKitHistory(customerProfileId);

  return historyRows.map((row) => {
    // Derive daysTakenMeal — count of FOOD_TAKEN daily logs (Req 8.3)
    const daysTakenMeal = row.kit_daily_logs.filter(
      (log) => log.status === "FOOD_TAKEN"
    ).length;

    // Derive shippingStatus from kit_shipping_info (Req 8.5, Property 14)
    const shippingInfo =
      row.kit_shipping_info.length > 0 ? row.kit_shipping_info[0] : null;

    let shippingStatus: "Not Shipped" | "Shipped" | "Delivered";
    if (!shippingInfo || !shippingInfo.shipped_at) {
      shippingStatus = "Not Shipped";
    } else if (shippingInfo.delivered_at) {
      shippingStatus = "Delivered";
    } else {
      shippingStatus = "Shipped";
    }

    // canDownloadReport = false for PENDING subscriptions (Req 8.6)
    const canDownloadReport = row.status !== "PENDING";

    return {
      id: row.id,
      orderDate: row.created_at,
      kitProductName: row.kit_products?.name ?? "Unknown Product",
      kitDays: row.kit_duration_days ?? 0,
      daysTakenMeal,
      daysSkipped: row.kit_total_skipped_days ?? 0,
      status: row.status as "ACTIVE" | "EXPIRED" | "PENDING",
      shippingStatus,
      canDownloadReport,
    };
  });
}
