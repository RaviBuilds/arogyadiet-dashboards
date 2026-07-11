"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { generateDailyOrders } from "@/actions/system-actions/orderGeneration";
import { executeAutomatedDispatch } from "@/actions/system-actions/routeEngine";
import { getISTDateString, getTomorrowISTDateString } from "@/lib/dates/ist";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import { persistWorkloadSnapshots } from "@/lib/clinic/workload";

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
}: {
  supabase: ReturnType<typeof createAdminClient>;
  targetDate: string;
  addonsLinked: number;
}) {
  const statsPayload = {
    addonsLinked,
  };

  try {
    const { data: existingLog, error: existingLogError } = await supabase
      .from("automation_logs")
      .select("run_count")
      .eq("automation_type", "PRODUCT_LINK")
      .eq("target_date", targetDate)
      .maybeSingle();

    if (existingLogError) {
      console.error("Error fetching product linking log:", existingLogError);
      return;
    }

    const { error: upsertError } = await supabase.from("automation_logs").upsert(
      {
        automation_type: "PRODUCT_LINK",
        target_date: targetDate,
        run_count: (existingLog?.run_count ?? 0) + 1,
        last_run_at: new Date().toISOString(),
        latest_stats: statsPayload,
      },
      { onConflict: "automation_type,target_date" },
    );

    if (upsertError) {
      console.error("Error upserting product linking log:", upsertError);
    }
  } catch (error) {
    console.error("Unexpected error logging product linking run:", error);
  }
}

export async function runProductLinkingAction(
  targetDate: string,
): Promise<ProductLinkingResult> {
  const gate = await checkGroupManage("operations");
  if (!gate.ok) return { success: false, error: gate.error };
  const today = getISTDateString(0);
  const tomorrow = getISTDateString(1);

  if (targetDate !== today && targetDate !== tomorrow) {
    return {
      success: false,
      error: `Product linking can only run for today (${today}) or tomorrow (${tomorrow}).`,
    };
  }

  const supabase = createAdminClient();

  try {
    const { data: deliveries, error: delError } = await supabase
      .from("delivery_orders")
      .select("id, customer_profile_id")
      .eq("delivery_date", targetDate)
      .eq("status", "ORDER_CREATED");

    if (delError) {
      console.error("Error fetching delivery orders for product linking:", delError);
      return { success: false, error: delError.message };
    }

    if (!deliveries?.length) {
      await logAdminAction("UPDATE", "system_automation", "Product Linking", {
        executed_action: "runProductLinkingAction",
        target_date: targetDate,
        linked: 0,
      });

      await logProductLinkingRun({
        supabase,
        targetDate,
        addonsLinked: 0,
      });

      revalidatePath("/admin/operations");
      return { success: true, count: 0, targetDate };
    }

    let updatedCount = 0;

    for (const delivery of deliveries) {
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

    await logAdminAction("UPDATE", "system_automation", "Product Linking", {
      executed_action: "runProductLinkingAction",
      target_date: targetDate,
      linked: updatedCount,
    });

    await logProductLinkingRun({
      supabase,
      targetDate,
      addonsLinked: updatedCount,
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

      const result = await executeAutomatedDispatch(targetDate);

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

      const result = await generateDailyOrders(targetDate);

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
      return runProductLinkingAction(targetDate);
    }

    return { success: false, error: "Unknown automation type." };
  } catch (error: unknown) {
    console.error("Critical error in triggerSystemAutomation:", error);
    return { success: false, error: "An unexpected server error occurred." };
  }
}
