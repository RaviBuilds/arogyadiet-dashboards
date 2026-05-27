"use server";

import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/logger";
import { generateDailyOrders } from "@/actions/system-actions/orderGeneration";
import { getTomorrowISTDateString } from "@/lib/dates/ist";

export async function triggerSystemAutomation(
  automationName: string,
  options?: { targetDate?: string },
) {
  const supabase = await createClient();

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

    // AUTOMATION 2: Product Linking (Supabase RPC)
    if (automationName === "Product Linking") {
      const { error } = await supabase.rpc("run_product_linking");

      if (error) {
        console.error("Error running RPC run_product_linking:", error);
        return { success: false, error: error.message };
      }

      await logAdminAction("UPDATE", "system_automation", automationName, {
        executed_rpc: "run_product_linking",
      });

      return { success: true };
    }

    return { success: false, error: "Unknown automation type." };
  } catch (error: unknown) {
    console.error("Critical error in triggerSystemAutomation:", error);
    return { success: false, error: "An unexpected server error occurred." };
  }
}
