"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function createSubscriptionPlan(data: { code: string; name: string; duration_days: number; pause_credits: number; base_price: number; tax_amount: number; is_active: boolean; }) {
  const supabaseAdmin = createAdminClient();
  try {
    const totalPrice = Number(data.base_price) + Number(data.tax_amount);
    const { error } = await supabaseAdmin.from("subscription_plans").insert({
      code: data.code,
      name: data.name,
      duration_days: data.duration_days,
      pause_credits: data.pause_credits,
      base_price: data.base_price,
      tax_amount: data.tax_amount,
      price: totalPrice,
      is_active: data.is_active,
    });
    if (error) throw error;
    revalidatePath("/subscriptions");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateSubscriptionPlan(planId: string, data: { name: string; duration_days: number; pause_credits: number; base_price: number; tax_amount: number; is_active: boolean }) {
  const supabaseAdmin = createAdminClient();
  try {
    const totalPrice = Number(data.base_price) + Number(data.tax_amount);
    const { error } = await supabaseAdmin.from("subscription_plans").update({
      name: data.name,
      duration_days: data.duration_days,
      pause_credits: data.pause_credits,
      base_price: data.base_price,
      tax_amount: data.tax_amount,
      price: totalPrice,
      is_active: data.is_active
    }).eq("id", planId);
    if (error) throw error;
    revalidatePath("/subscriptions");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteSubscriptionPlan(planId: string) {
  const supabaseAdmin = createAdminClient();
  try {
    const { data: activeSubs, error: checkError } = await supabaseAdmin.from("subscriptions").select("id").eq("plan_id", planId).in("status", ["ACTIVE", "PENDING", "QUEUED"]).limit(1);
    if (checkError) throw checkError;
    if (activeSubs && activeSubs.length > 0) return { success: false, error: "Cannot delete: Plan has active subscribers." };
    const { error: deleteError } = await supabaseAdmin.from("subscription_plans").delete().eq("id", planId);
    if (deleteError) throw deleteError;
    revalidatePath("/subscriptions");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function setRecommendedPlan(planId: string) {
  const supabaseAdmin = createAdminClient();
  try {
    await supabaseAdmin.from("subscription_plans").update({ recommended: false }).not("id", "is", null);
    if (planId && planId !== "NONE") {
      await supabaseAdmin.from("subscription_plans").update({ recommended: true }).eq("id", planId);
    }
    revalidatePath("/subscriptions");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}