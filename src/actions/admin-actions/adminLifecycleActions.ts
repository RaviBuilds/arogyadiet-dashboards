"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function managePendingSubscription(
  subscriptionId: string, 
  payload: { starts_on?: string; status: string; }
) {
  const supabaseAdmin = createAdminClient();
  try {
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update(payload)
      .eq("id", subscriptionId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateActiveSubscriptionDates(
  subscriptionId: string,
  payload: { starts_on: string; pause_credits_total: number; }
) {
  const supabaseAdmin = createAdminClient();
  try {
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update(payload)
      .eq("id", subscriptionId);

    if (error) throw error;
    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
