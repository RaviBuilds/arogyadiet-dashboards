"use server";

import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/logger";

export async function triggerSystemAutomation(automationName: string) {
  const supabase = await createClient();

  try {
    // AUTOMATION 3: Routing & Batching (API Route)
    if (automationName === "Routing & Batching") {
      // Calculate tomorrow's date dynamically for the URL
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];
      
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const dispatchUrl = `${baseUrl}/api/cron/dispatch?secret=arogya-demo-123&date=${dateStr}`;

      const response = await fetch(dispatchUrl, { method: "GET" });
      
      if (!response.ok) {
        return { success: false, error: `API returned status: ${response.status}` };
      }

      await logAdminAction("UPDATE", "system_automation", automationName, {
        executed_url: dispatchUrl,
      });
      return { success: true };
    }

    // AUTOMATION 1 & 2: Supabase RPCs
    let rpcFunctionName = "";
    
    if (automationName === "5:15 PM Order Gen") {
      rpcFunctionName = "run_daily_order_generation";
    } else if (automationName === "Product Linking") {
      rpcFunctionName = "run_product_linking";
    } else {
      return { success: false, error: "Unknown automation type." };
    }

    // Execute the stored procedure in Supabase
    const { error } = await supabase.rpc(rpcFunctionName);

    if (error) {
      console.error(`Error running RPC ${rpcFunctionName}:`, error);
      return { success: false, error: error.message };
    }

    // Log the successful execution
    await logAdminAction("UPDATE", "system_automation", automationName, {
      executed_rpc: rpcFunctionName,
    });

    return { success: true };

  } catch (error: any) {
    console.error("Critical error in triggerSystemAutomation:", error);
    return { success: false, error: "An unexpected server error occurred." };
  }
}