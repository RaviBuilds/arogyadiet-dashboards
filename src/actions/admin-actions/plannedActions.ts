'use server';

import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { checkGroupManage } from "@/lib/auth/adminAccess";

// Action to completely remove an order from tomorrow's dispatch
export async function deletePlannedOrder(orderId: string) {
  const gate = await checkGroupManage("operations");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabase = await createClient();

  const { error } = await supabase
    .from("delivery_orders")
    .delete()
    .eq("id", orderId);

  if (error) {
    console.error("Error deleting planned order:", error);
    return { success: false, error: error.message };
  }

  await logAdminAction("DELETE", "delivery_order", orderId, {});
  revalidatePath("/admin/operations");
  return { success: true };
}

// Action to swap the meal category for a specific order
export async function updateOrderMeal(orderId: string, mealCategoryName: string) {
  const gate = await checkGroupManage("operations");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabase = await createClient();

  // First, look up the ID for the requested meal category name
  const { data: categoryData, error: catError } = await supabase
    .from("meal_categories")
    .select("id")
    .ilike("name", `%${mealCategoryName}%`)
    .limit(1)
    .single();

  if (catError || !categoryData) {
    return { success: false, error: "Meal category not found in database." };
  }

  // Update the delivery order with the new meal_category_id
  const { error: updateError } = await supabase
    .from("delivery_orders")
    .update({ meal_category_id: categoryData.id })
    .eq("id", orderId);

  if (updateError) {
    console.error("Error updating meal type:", updateError);
    return { success: false, error: updateError.message };
  }

  await logAdminAction("UPDATE", "delivery_order", orderId, {
    meal_category: mealCategoryName,
  });
  revalidatePath("/admin/operations");
  return { success: true };
}

// Action to fetch all available addresses for the customer tied to a specific order
export async function getAddressesForOrder(orderId: string) {
  const supabase = await createClient();
  
  // 1. Find the customer profile ID tied to this order
  const { data: order, error: orderError } = await supabase
    .from("delivery_orders")
    .select("customer_profile_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order?.customer_profile_id) {
    return { success: false, error: "Could not find customer for this order." };
  }

  // 2. Fetch all addresses for that customer
  const { data: addresses, error: addressError } = await supabase
    .from("addresses")
    .select("id, tag, street_1, street_2, landmark, city, pincode, is_primary")
    .eq("customer_profile_id", order.customer_profile_id)
    .order("is_primary", { ascending: false });

  if (addressError) {
    return { success: false, error: addressError.message };
  }

  return { success: true, addresses };
}

// Action to update the order with the newly selected address
export async function updateOrderAddress(orderId: string, addressId: string) {
  const gate = await checkGroupManage("operations");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabase = await createClient();

  const { error } = await supabase
    .from("delivery_orders")
    .update({ delivery_address_id: addressId })
    .eq("id", orderId);

  if (error) {
    console.error("Error updating order address:", error);
    return { success: false, error: error.message };
  }

  await logAdminAction("UPDATE", "delivery_order", orderId, { address_id: addressId });
  revalidatePath("/admin/operations");
  return { success: true };
}
