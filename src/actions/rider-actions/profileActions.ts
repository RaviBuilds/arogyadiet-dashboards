"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateRiderAvatar(userId: string, avatarUrl: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("users")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId);

  if (error) throw new Error(error.message);

  revalidatePath("/rider/profile");
  return { success: true };
}

export async function updateEmergencyContact(
  riderProfileId: string,
  contact: string,
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("rider_profiles")
    .update({ emergency_contact: contact })
    .eq("id", riderProfileId);

  if (error) throw new Error(error.message);

  revalidatePath("/profile");
  return { success: true };
}
