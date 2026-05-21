"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function revalidateCustomersPage() {
  revalidatePath("/admin/customers");
  return { success: true };
}

export async function updateCustomerBasicInfo(
  profileId: string,
  userId: string,
  data: {
    fullName: string;
    mobile: string;
    dietaryPreference: string;
    gender: string;
    dateOfBirth: string;
  },
) {
  const supabase = await createClient();

  try {
    // 1. Update users table (fullName, mobile)
    const { error: userError } = await supabase
      .from("users")
      .update({
        full_name: data.fullName,
        mobile: data.mobile,
      })
      .eq("id", userId);

    if (userError) throw userError;

    // 2. Update customer_profiles table
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .update({
        dietary_preference: data.dietaryPreference,
        gender: data.gender,
        date_of_birth: data.dateOfBirth || null,
      })
      .eq("id", profileId);

    if (profileError) throw profileError;

    revalidatePath("/admin/customers");
    return { success: true };
  } catch (error: any) {
    console.error("Error updating customer info:", error);
    return {
      success: false,
      error: error.message || "Failed to update customer.",
    };
  }
}

export async function deleteCustomer(profileId: string, userId: string) {
  const supabase = await createClient();

  try {
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .delete()
      .eq("id", profileId);

    if (profileError) throw profileError;

    const { error: userError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (userError) throw userError;

    revalidatePath("/admin/customers");
    return { success: true };
  } catch (error: any) {
    // Handle Foreign Key constraints (e.g. if they have orders)
    if (error.code === "23503") {
      return {
        success: false,
        error:
          "Cannot delete this customer because they have historical subscription/order records.",
      };
    }
    console.error("Error deleting customer:", error);
    return {
      success: false,
      error: error.message || "Failed to delete customer.",
    };
  }
}
