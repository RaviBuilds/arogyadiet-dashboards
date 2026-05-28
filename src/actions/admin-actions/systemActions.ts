"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { generateDailyOrders } from "@/actions/system-actions/orderGeneration";
import { getISTDateString, getTomorrowISTDateString } from "@/lib/dates/ist";

type ProductLinkingResult = {
  success: boolean;
  count?: number;
  targetDate?: string;
  error?: string;
};

export async function runProductLinkingAction(
  targetDate: string,
): Promise<ProductLinkingResult> {
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
) {
  try {
    // AUTOMATION 3: Routing & Batching (API Route)
    if (automationName === "Routing & Batching") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split("T")[0];

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const dispatchUrl = `${baseUrl}/api/cron/dispatch?secret=${process.env.CRON_SECRET || "arogya-demo-123"}&date=${dateStr}`;

      const response = await fetch(dispatchUrl, { method: "GET" });

      if (!response.ok) {
        return { success: false, error: `API returned status: ${response.status}` };
      }

      await logAdminAction("UPDATE", "system_automation", automationName, {
        executed_url: dispatchUrl,
      });
      return { success: true };
    }

    // AUTOMATION 1: 5:15 PM Order Gen
    if (automationName === "5:15 PM Order Gen") {
      const tomorrow = getTomorrowISTDateString();
      const targetDate = options?.targetDate || tomorrow;

      if (targetDate !== tomorrow) {
        return {
          success: false,
          error: `Order generation can only run for tomorrow (${tomorrow}).`,
        };
      }

      const result = await generateDailyOrders(targetDate);

      if (!result.success) {
        return { success: false, error: result.error };
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
      const targetDate = options?.targetDate ?? getTomorrowISTDateString();
      return runProductLinkingAction(targetDate);
    }

    return { success: false, error: "Unknown automation type." };
  } catch (error: unknown) {
    console.error("Critical error in triggerSystemAutomation:", error);
    return { success: false, error: "An unexpected server error occurred." };
  }
}
