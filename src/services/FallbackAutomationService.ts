/**
 * FallbackAutomationService
 *
 * Shared business logic for the "fallback" automations — cron jobs that don't
 * have dedicated System Automation Control cards (unlike Order Creation,
 * Product Linking, and Routing & Batching). Each function here is called by:
 *   1. Its scheduled Supabase pg_cron route (source: "cron")
 *   2. The admin's manual "Run Script" trigger in the Fallback Automations
 *      panel (source: "manual")
 *
 * Both call sites share this single implementation so behavior never drifts
 * between scheduled and manual runs — only the automation_logs bookkeeping
 * source differs.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";
import { getCustomerNameByProfileId } from "@/lib/notifications/lookups";
import { notifySubscriptionExpired } from "@/lib/subscription/subscriptionNotifications";
import { expireEligibleKits } from "@/services/KitLifecycleService";
import { transitionStays } from "@/services/AccommodationService";
import { getISTDateString } from "@/lib/dates/ist";
import { upsertAutomationLog, type AutomationRunSource } from "@/lib/automation/logging";
import { format, addDays } from "date-fns";

const DISPATCH_IMAGES_BUCKET = "franchise-dispatch-images";
const DISPATCH_IMAGES_RETENTION_DAYS = 10;
const PO_RETENTION_MONTHS = 3;
const PO_STORAGE_BUCKET = "purchase-orders";

// ─── 1. Subscription Activation / Expiry ────────────────────────────────────

export type SubRef = { id: string; customer_profile_id: string };

export type SubActivateResult = {
  today: string;
  tomorrow: string;
  activated: number;
  stopped: number;
  /** Records needed to send the follow-up notifications (deferred). */
  activatedSubs: SubRef[];
  stoppedSubs: SubRef[];
};

/**
 * MAIN TASK: activate PENDING subscriptions starting tomorrow and expire ACTIVE
 * subscriptions past their end date, then log the SUB_ACTIVATE result.
 *
 * This intentionally does NOT send notifications — those are slow (external
 * push/email) and previously ran inline BEFORE the log write, which caused the
 * cron's pg_net call to time out at 5s and the SUB_ACTIVATE log to never be
 * written. Notifications are now run separately via
 * `sendSubscriptionActivationNotifications` (from the cron route's `after()`
 * pipeline, or awaited directly on the manual path).
 */
export async function runSubscriptionActivation(
  source: AutomationRunSource = "cron",
): Promise<SubActivateResult> {
  const supabaseAdmin = createAdminClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");

  const { data: activated, error: activateError } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "ACTIVE" })
    .eq("status", "PENDING")
    .eq("starts_on", tomorrow)
    .select("id, customer_profile_id, starts_on");

  if (activateError) {
    throw new Error(activateError.message);
  }

  const { data: stopped, error: stopError } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "EXPIRED" })
    .eq("status", "ACTIVE")
    .lte("effective_end_on", today)
    .select("id, customer_profile_id, effective_end_on");

  if (stopError) {
    throw new Error(stopError.message);
  }

  // Gather customer names for logging (quick reads; no external calls).
  const activatedNames: string[] = [];
  for (const sub of activated ?? []) {
    const { data: cp } = await supabaseAdmin
      .from("customer_profiles")
      .select("users!customer_profiles_user_id_fkey!inner(full_name)")
      .eq("id", sub.customer_profile_id)
      .maybeSingle();
    activatedNames.push((cp as any)?.users?.full_name || "Unknown");
  }

  const expiredNames: string[] = [];
  for (const sub of stopped ?? []) {
    const { data: cp } = await supabaseAdmin
      .from("customer_profiles")
      .select("users!customer_profiles_user_id_fkey!inner(full_name)")
      .eq("id", sub.customer_profile_id)
      .maybeSingle();
    expiredNames.push((cp as any)?.users?.full_name || "Unknown");
  }

  await upsertAutomationLog(supabaseAdmin, {
    automationType: "SUB_ACTIVATE",
    targetDate: today,
    source,
    stats: {
      subscriptionsActivated: activated?.length ?? 0,
      activatedCustomers: activatedNames,
      subscriptionsExpired: stopped?.length ?? 0,
      expiredCustomers: expiredNames,
    },
  });

  return {
    today,
    tomorrow,
    activated: activated?.length ?? 0,
    stopped: stopped?.length ?? 0,
    activatedSubs: (activated ?? []).map((s) => ({
      id: s.id,
      customer_profile_id: s.customer_profile_id,
    })),
    stoppedSubs: (stopped ?? []).map((s) => ({
      id: s.id,
      customer_profile_id: s.customer_profile_id,
    })),
  };
}

/**
 * FOLLOW-UP: notify customers/admins about newly-activated subscriptions.
 * Safe to run after the main task and its log have been recorded.
 */
export async function notifyActivatedSubscriptions(activatedSubs: SubRef[]): Promise<void> {
  if (!activatedSubs.length) return;
  const supabaseAdmin = createAdminClient();

  for (const sub of activatedSubs) {
    const { data: profile } = await supabaseAdmin
      .from("customer_profiles")
      .select("user_id")
      .eq("id", sub.customer_profile_id)
      .maybeSingle();

    if (profile?.user_id) {
      await sendNotificationToUser(profile.user_id, {
        title: "Subscription Activated!",
        message: "Your upcoming pending subscription has been activated. See more info.",
        actionUrl: "/customer/dashboard",
        sendEmail: false,
      });
    }

    const customerName = await getCustomerNameByProfileId(sub.customer_profile_id);

    await notifyAdmins({
      title: "Pending Subscription Activated!",
      message: `Hi Admin, Pending subscription has been activated for the customer ${customerName}.`,
      actionUrl: "/admin/customers",
      sendEmail: false,
    });
  }
}

/**
 * FOLLOW-UP: notify customers about expired subscriptions.
 */
export async function notifyExpiredSubscriptions(stoppedSubs: SubRef[]): Promise<void> {
  for (const sub of stoppedSubs) {
    await notifySubscriptionExpired(sub.customer_profile_id, sub.id);
  }
}

/**
 * Convenience wrapper that runs both notification passes. Used by the manual
 * "Run Script" path where the whole operation is awaited synchronously.
 */
export async function sendSubscriptionActivationNotifications(
  activatedSubs: SubRef[],
  stoppedSubs: SubRef[],
): Promise<void> {
  await notifyActivatedSubscriptions(activatedSubs);
  await notifyExpiredSubscriptions(stoppedSubs);
}

// ─── 2. KIT Expiration ───────────────────────────────────────────────────────

export async function runKitExpiration(
  source: AutomationRunSource = "cron",
): Promise<{ expired: number }> {
  const result = await expireEligibleKits();

  if (!result.success) {
    throw new Error(result.error || "Kit expiration failed.");
  }

  const supabaseAdmin = createAdminClient();
  const today = getISTDateString(0);
  const expiredCount = typeof result.expired === "number" ? result.expired : 0;

  await upsertAutomationLog(supabaseAdmin, {
    automationType: "KIT_EXPIRE",
    targetDate: today,
    source,
    stats: { kitsExpired: expiredCount },
  });

  return { expired: expiredCount };
}

// ─── 3. Dispatch Image Cleanup ───────────────────────────────────────────────

export async function runDispatchImageCleanup(
  source: AutomationRunSource = "cron",
): Promise<{ imagesDeleted: number; transfersProcessed: number }> {
  const admin = createAdminClient();
  const today = getISTDateString(0);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DISPATCH_IMAGES_RETENTION_DAYS);

  const { data: expiredTransfers, error: fetchError } = await admin
    .from("franchise_stock_transfers")
    .select("id, package_image_paths")
    .eq("state", "RECEIVED")
    .lt("received_at", cutoffDate.toISOString())
    .not("package_image_paths", "is", null);

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (!expiredTransfers || expiredTransfers.length === 0) {
    await upsertAutomationLog(admin, {
      automationType: "IMG_CLEANUP",
      targetDate: today,
      source,
      stats: { imagesDeleted: 0, transfersProcessed: 0 },
    });
    return { imagesDeleted: 0, transfersProcessed: 0 };
  }

  let totalDeleted = 0;
  let transfersProcessed = 0;

  for (const transfer of expiredTransfers) {
    const paths: string[] = transfer.package_image_paths ?? [];

    if (paths.length > 0) {
      const { error: deleteError } = await admin.storage
        .from(DISPATCH_IMAGES_BUCKET)
        .remove(paths);

      if (deleteError) {
        console.error(`Failed to delete images for transfer ${transfer.id}:`, deleteError.message);
        continue;
      }

      totalDeleted += paths.length;
    }

    await admin
      .from("franchise_stock_transfers")
      .update({ package_image_paths: null })
      .eq("id", transfer.id);

    transfersProcessed += 1;
  }

  await upsertAutomationLog(admin, {
    automationType: "IMG_CLEANUP",
    targetDate: today,
    source,
    stats: { imagesDeleted: totalDeleted, transfersProcessed },
  });

  return { imagesDeleted: totalDeleted, transfersProcessed };
}

// ─── 4. Accommodation Stay Transitions ───────────────────────────────────────

export async function runStayTransitions(
  source: AutomationRunSource = "cron",
): Promise<{ activated: number; finished: number }> {
  const currentDate = getISTDateString(0);
  const { activated, finished } = await transitionStays(currentDate);

  const supabaseAdmin = createAdminClient();
  await upsertAutomationLog(supabaseAdmin, {
    automationType: "STAY_TRANSITION",
    targetDate: currentDate,
    source,
    stats: { staysActivated: activated, staysFinished: finished },
  });

  return { activated, finished };
}

// ─── 5. Purchase Order Cleanup ───────────────────────────────────────────────

export async function runPurchaseOrderCleanup(
  source: AutomationRunSource = "cron",
): Promise<{ filesDeleted: number; lotsProcessed: number }> {
  const admin = createAdminClient();
  const today = getISTDateString(0);

  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - PO_RETENTION_MONTHS);

  const { data: expiredLots, error: fetchError } = await admin
    .from("inventory_lots")
    .select("id, purchase_order_path, created_at")
    .not("purchase_order_path", "is", null)
    .lt("created_at", cutoffDate.toISOString());

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (!expiredLots || expiredLots.length === 0) {
    await upsertAutomationLog(admin, {
      automationType: "PO_CLEANUP",
      targetDate: today,
      source,
      stats: { posDeleted: 0, lotsProcessed: 0, message: "No expired POs to clean up" },
    });
    return { filesDeleted: 0, lotsProcessed: 0 };
  }

  let filesDeleted = 0;
  let lotsProcessed = 0;

  for (const lot of expiredLots) {
    const path = lot.purchase_order_path;

    if (path) {
      const { error: deleteError } = await admin.storage
        .from(PO_STORAGE_BUCKET)
        .remove([path]);

      if (deleteError) {
        console.error(`Failed to delete PO file for lot ${lot.id}:`, deleteError.message);
        continue;
      }

      filesDeleted++;
    }

    await admin
      .from("inventory_lots")
      .update({ purchase_order_path: null })
      .eq("id", lot.id);

    lotsProcessed++;
  }

  await upsertAutomationLog(admin, {
    automationType: "PO_CLEANUP",
    targetDate: today,
    source,
    stats: {
      posDeleted: filesDeleted,
      lotsProcessed,
      cutoffDate: cutoffDate.toISOString().split("T")[0],
    },
  });

  return { filesDeleted, lotsProcessed };
}
