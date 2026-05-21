"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateProfileAction(formData: any) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  // 1. Get the internal 'users' table ID
  const { data: dbUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!dbUser) return { error: "User record not found" };

  // 2. Update Identity info in 'users' table
  const { error: userUpdateError } = await supabase
    .from("users")
    .update({
      full_name: formData.full_name,
      mobile: formData.phone,
    })
    .eq("id", dbUser.id);

  if (userUpdateError) {
    console.error("User Update Error:", userUpdateError);
    return { error: "Failed to update core user details." };
  }

  // 3. UPSERT logic for customer_profiles
  // We use upsert so that if the profile row doesn't exist, it gets created automatically.
  const profilePayload = {
    user_id: dbUser.id, // Critical: include the foreign key for the insert scenario
    gender: formData.gender || null,
    date_of_birth: formData.date_of_birth
      ? formData.date_of_birth.split("T")[0]
      : null,
    dietary_preference: formData.dietary_preference,
    allergies: formData.allergies || null,
    // Add any other required fields for customer_profiles here (like is_active: true if needed)
    medical_history_notes: formData.medical_history_notes || null,
    has_medical_history: formData.has_medical_history || false,
  };

  const { error: profileUpsertError } = await supabase
    .from("customer_profiles")
    .upsert(profilePayload, {
      onConflict: "user_id", // Tells Supabase to update if user_id already exists
      ignoreDuplicates: false,
    });

  if (profileUpsertError) {
    console.error("Profile Upsert Error:", profileUpsertError);
    return { error: "Failed to save dietary preferences." };
  }

  // 4. Clear cache to force fresh data fetch on next load
  revalidatePath("/profile");
  return { success: true };
}
