"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setRiderOnlineAction(isOnline: boolean) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Please login again to update your duty status." };
  }

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (appUserError || !appUser) {
    return { error: "Rider account not found." };
  }

  const now = new Date().toISOString();
  const riderUpdate = isOnline
    ? { is_online: true, last_online_at: now }
    : { is_online: false, last_offline_at: now };

  const { error: riderError } = await supabase
    .from("rider_profiles")
    .update(riderUpdate)
    .eq("user_id", appUser.id);

  if (riderError) {
    return { error: riderError.message };
  }

  if (isOnline) {
    const { error: lastLoginError } = await supabase
      .from("users")
      .update({ last_login_at: now })
      .eq("id", appUser.id);

    if (lastLoginError) {
      console.error("Failed to update rider last_login_at:", {
        userId: appUser.id,
        error: lastLoginError.message,
      });
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/route");
  revalidatePath("/rider/dashboard");
  revalidatePath("/rider/route");

  return { success: true, isOnline };
}
