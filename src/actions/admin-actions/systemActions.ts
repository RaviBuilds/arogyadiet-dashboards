"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { generateDailyOrders } from "@/actions/system-actions/orderGeneration";
import { executeAutomatedDispatch } from "@/actions/system-actions/routeEngine";
import { getISTDateString, getTomorrowISTDateString } from "@/lib/dates/ist";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import { persistWorkloadSnapshots } from "@/lib/clinic/workload";
import { upsertAutomationLog, type AutomationRunSource } from "@/lib/automation/logging";

type ProductLinkingResult =
  | { success: true; count: number; targetDate: string }
  | { success: false; error: string };

type SystemAutomationResult =
  | { success: true }
  | { success: true; targetDate: string; inserted: number; skipped: number }
  | ProductLinkingResult
  | { success: false; error: string };

async function logProductLinkingRun({
  supabase,
  targetDate,
  addonsLinked,
  source,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  targetDate: string;
  addonsLinked: number;
  source: AutomationRunSource;
}) {
  await upsertAutomationLog(supabase, {
    automationType: "PRODUCT_LINK",
    targetDate,
    source,
    stats: { addonsLinked },
  });
}

export async function runProductLinkingAction(
  targetDate: string,
  source: AutomationRunSource = "cron",
): Promise<ProductLinkingResult> {
  // Scheduled (cron) runs are authenticated by CRON_SECRET at the route level
  // and carry no admin session — gating them with checkGroupManage made the
  // nightly product-linking cron fail with a 400 permission error (so routing
  // never ran and riders were never assigned). Only gate admin-triggered manual
  // runs; the sole manual caller (triggerSystemAutomation) passes source="manual".
  if (source === "manual") {
    const gate = await checkGroupManage("operations");
    if (!gate.ok) return { success: false, error: gate.error };
  }
  const today = getISTDateString(0);
  const tomorrow = getISTDateString(1);

  if (targetDate !== today && targetDate !== tomorrow) {
    return {
      success: false,
      error: `Product linking can only run for today (${today}) or tomorrow (${tomorrow}).`,
    };
  }

  const supabase = createAdminClient();

  // Deliveries in these states can no longer carry a piggy-backed shop product,
  // so they are never linkable. Everything else (ORDER_CREATED plus advanced
  // states like PACKED / OUT_FOR_DELIVERY / ASSIGNED / IN_TRANSIT) is a valid
  // link target — this is what lets a manual recovery re-run succeed after
  // dispatch has advanced the day's deliveries past ORDER_CREATED.
  const TERMINAL_DELIVERY_STATUSES = ["CANCELLED", "FAILED", "DELIVERED"];
  const isLinkableStatus = (status: unknown) =>
    !TERMINAL_DELIVERY_STATUSES.includes((status as string) ?? "");

  try {
    // Fetch every delivery for the target date, then classify in code so we can
    // keep ORDER_CREATED as the primary set while still linking against advanced
    // (non-terminal) deliveries on recovery re-runs.
    const { data: dateDeliveries, error: delError } = await supabase
      .from("delivery_orders")
      .select("id, customer_profile_id, delivery_date, status")
      .eq("delivery_date", targetDate);

    if (delError) {
      console.error("Error fetching delivery orders for product linking:", delError);
      return { success: false, error: delError.message };
    }

    const linkableDeliveries = (dateDeliveries ?? []).filter((d) =>
      isLinkableStatus(d.status),
    );
    // Primary set first (baseline behavior), then advanced deliveries so that a
    // recovery re-run can still link outstanding PAID orders for the day.
    const primaryDeliveries = linkableDeliveries.filter(
      (d) => d.status === "ORDER_CREATED",
    );
    const advancedDeliveries = linkableDeliveries.filter(
      (d) => d.status !== "ORDER_CREATED",
    );
    const orderedDeliveries = [...primaryDeliveries, ...advancedDeliveries];

    let updatedCount = 0;

    // Same-date linking: link each customer's own PAID, unlinked orders that
    // target this exact date to that customer's own delivery for the date.
    for (const delivery of orderedDeliveries) {
      const { data: updatedAddons, error: updateError } = await supabase
        .from("addon_orders")
        .update({ delivery_order_id: delivery.id })
        .eq("customer_profile_id", delivery.customer_profile_id)
        .eq("status", "PAID")
        .eq("target_delivery_date", targetDate)
        .is("delivery_order_id", null)
        .select("id");

      if (updateError) {
        console.error("Error linking addon orders:", updateError);
        return { success: false, error: updateError.message };
      }

      updatedCount += updatedAddons?.length ?? 0;
    }

    // Roll-forward: any PAID order still unlinked whose target date is on/before
    // the run date would otherwise be orphaned (the target day was paused, the
    // subscription ended, or no delivery row was generated). Carry each such
    // order forward to the customer's next available delivery on/after the run
    // date and re-point its target_delivery_date so state stays consistent.
    // Scoping stays strict: only the customer's own order is linked to the
    // customer's own delivery.
    const { data: strandedOrders, error: strandedError } = await supabase
      .from("addon_orders")
      .select("id, customer_profile_id, target_delivery_date")
      .eq("status", "PAID")
      .is("delivery_order_id", null)
      .lte("target_delivery_date", targetDate);

    if (strandedError) {
      console.error("Error fetching stranded addon orders for roll-forward:", strandedError);
      return { success: false, error: strandedError.message };
    }

    for (const order of strandedOrders ?? []) {
      const { data: futureDeliveries, error: futureError } = await supabase
        .from("delivery_orders")
        .select("id, delivery_date, status")
        .eq("customer_profile_id", order.customer_profile_id)
        .gte("delivery_date", targetDate)
        .order("delivery_date", { ascending: true });

      if (futureError) {
        console.error("Error fetching next delivery for roll-forward:", futureError);
        return { success: false, error: futureError.message };
      }

      // Earliest non-terminal delivery on/after the run date.
      const nextDelivery = (futureDeliveries ?? []).find((d) =>
        isLinkableStatus(d.status),
      );
      if (!nextDelivery) continue;

      const { data: rolledAddons, error: rollError } = await supabase
        .from("addon_orders")
        .update({
          delivery_order_id: nextDelivery.id,
          target_delivery_date: nextDelivery.delivery_date,
        })
        .eq("id", order.id)
        .eq("customer_profile_id", order.customer_profile_id)
        .is("delivery_order_id", null)
        .select("id");

      if (rollError) {
        console.error("Error rolling addon order forward:", rollError);
        return { success: false, error: rollError.message };
      }

      updatedCount += rolledAddons?.length ?? 0;
    }

    // Keep kitchen shop-product counts correct after LATE links (Defect #5).
    // A manual recovery re-run can link outstanding PAID orders (same-date or
    // rolled-forward) AFTER the nightly workload snapshot already ran, which
    // would otherwise leave the kitchen count undercounting the late-linked
    // product. Because computeClinicShopProductCounts recomputes counts from
    // addon_orders.delivery_order_id and persistWorkloadSnapshots upserts
    // (re-runs overwrite), re-persisting here refreshes the snapshot to include
    // the late link. Guarded to manual re-runs that actually linked something:
    // the nightly cron re-persists after its own linking completes (see the
    // link-products route), so it already reflects same-run roll-forward links.
    if (source === "manual" && updatedCount > 0) {
      try {
        await persistWorkloadSnapshots(targetDate);
      } catch (snapshotError) {
        // A snapshot refresh failure must not fail the recovery re-run itself;
        // the linking has already been persisted.
        console.error(
          "Workload snapshot refresh after manual product linking failed:",
          snapshotError,
        );
      }
    }

    await logAdminAction("UPDATE", "system_automation", "Product Linking", {
      executed_action: "runProductLinkingAction",
      target_date: targetDate,
      linked: updatedCount,
    });

    await logProductLinkingRun({
      supabase,
      targetDate,
      addonsLinked: updatedCount,
      source,
    });

    revalidatePath("/admin/operations");
    return { success: true, count: updatedCount, targetDate };
  } catch (error: unknown) {
    console.error("Critical error in runProductLinkingAction:", error);
    return { success: false, error: "An unexpected server error occurred." };
  }
}

export async function triggerSystemAutomation(
  automationName: string,
  options?: { targetDate?: string },
): Promise<SystemAutomationResult> {
  const gate = await checkGroupManage("operations");
  if (!gate.ok) return { success: false, error: gate.error };
  try {
    // AUTOMATION 3: Routing & Batching
    // Calls the dispatch engine directly server-side. No HTTP round-trip and no
    // CRON_SECRET in client code — the /api/cron/dispatch route stays reserved
    // for the scheduled cron job only.
    if (automationName === "Routing & Batching") {
      const today = getISTDateString(0);
      const tomorrow = getTomorrowISTDateString();
      const targetDate = options?.targetDate || today;

      if (targetDate !== today && targetDate !== tomorrow) {
        return {
          success: false,
          error: `Routing can only run for today (${today}) or tomorrow (${tomorrow}).`,
        };
      }

      const result = await executeAutomatedDispatch(targetDate, undefined, "manual");

      if ("error" in result && result.error) {
        return { success: false, error: result.error };
      }

      // Persist workload snapshots after dispatch (finalized counts)
      try {
        await persistWorkloadSnapshots(targetDate);
      } catch (snapshotError) {
        console.error("Workload snapshot error after manual dispatch:", snapshotError);
      }

      await logAdminAction("UPDATE", "system_automation", automationName, {
        executed_action: "executeAutomatedDispatch",
        target_date: targetDate,
      });
      return { success: true };
    }

    // AUTOMATION 1: 5:15 PM Order Gen
    if (
      automationName === "5:15 PM Order Gen" ||
      automationName === "5:15 PM Order Creation"
    ) {
      const today = getISTDateString(0);
      const tomorrow = getTomorrowISTDateString();
      const targetDate = options?.targetDate || tomorrow;

      if (targetDate !== today && targetDate !== tomorrow) {
        return {
          success: false,
          error: `Order generation can only run for today (${today}) or tomorrow (${tomorrow}).`,
        };
      }

      const result = await generateDailyOrders(targetDate, "manual");

      if (!result.success) {
        return {
          success: false,
          error: result.error ?? "Order generation failed.",
        };
      }

      // Persist workload snapshots after order creation (initial meal counts)
      try {
        await persistWorkloadSnapshots(targetDate);
      } catch (snapshotError) {
        console.error("Workload snapshot error after manual order gen:", snapshotError);
      }

      await logAdminAction("UPDATE", "system_automation", automationName, {
        executed_action: "generateDailyOrders",
        target_date: targetDate,
        inserted: result.inserted ?? 0,
        skipped: result.skipped ?? 0,
      });

      return {
        success: true,
        targetDate,
        inserted: result.inserted ?? 0,
        skipped: result.skipped ?? 0,
      };
    }

    // AUTOMATION 2: Product Linking
    if (automationName === "Product Linking") {
      const targetDate = options?.targetDate ?? getISTDateString(0);
      return runProductLinkingAction(targetDate, "manual");
    }

    return { success: false, error: "Unknown automation type." };
  } catch (error: unknown) {
    console.error("Critical error in triggerSystemAutomation:", error);
    return { success: false, error: "An unexpected server error occurred." };
  }
}
