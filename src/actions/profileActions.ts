"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { profileSchema, ProfileFormValues } from "@/validations/profileSchema";

export async function updateProfileAction(data: ProfileFormValues) {
  const supabase = await createClient();

  // 1. Get the authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // 2. Validate data using safeParse
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) {
    return { error: "Invalid profile data provided." };
  }

  try {
    // 3. Update the Master 'users' table
    // We update name, mobile (mapped from phone), diet, and allergies here.
    const { data: updatedUser, error: userError } = await supabase
      .from("users")
      .update({
        full_name: parsed.data.full_name,
        mobile: parsed.data.phone, // Database column is 'mobile'
        dietary_preference: parsed.data.dietary_preference,
        allergies: parsed.data.allergies,
      })
      .eq("auth_user_id", user.id)
      .select("id")
      .single();

    if (userError) throw userError;

    // 4. Update the 'customer_profiles' table[cite: 1]
    // This table stores DOB and Gender as per SRS Module 10[cite: 1]
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .update({
        date_of_birth: parsed.data.date_of_birth,
        gender: parsed.data.gender,
      })
      .eq("user_id", updatedUser.id); // Linking via the internal users.id[cite: 1]

    if (profileError) throw profileError;

    // 5. Refresh the UI[cite: 1]
    revalidatePath("/customer/profile");
    return { success: true };
  } catch (err: any) {
    console.error("Profile update error:", err);
    return { error: "Failed to update profile. Please try again." };
  }
}
