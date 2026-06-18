"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { updateUserPassword } from "@/services/AuthService";

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


export async function changeRiderPassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<{ success?: string; error?: string }> {
  if (!currentPassword) {
    return { error: "Current password is required" };
  }
  if (!newPassword) {
    return { error: "New password is required" };
  }
  if (newPassword !== confirmPassword) {
    return { error: "Passwords do not match" };
  }
  if (newPassword.length < 8) {
    return { error: "Password must be at least 8 characters long" };
  }
  if (currentPassword === newPassword) {
    return { error: "New password must be different from current password" };
  }

  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { error: "Authentication required" };
    }

    // Verify current password
    const { error: verificationError } =
      await supabase.auth.signInWithPassword({
        email: user.email!,
        password: currentPassword,
      });

    if (verificationError) {
      return { error: "Current password is incorrect" };
    }

    // Update password
    await updateUserPassword(newPassword);

    // Security: terminate all OTHER active sessions (other devices) while
    // keeping the current device signed in. A failure here must not prevent
    // the user from seeing the success message.
    try {
      await supabase.auth.signOut({ scope: "others" });
    } catch (signOutError) {
      console.error(
        "Rider password change: failed to revoke other sessions",
        signOutError,
      );
    }

    return {
      success: "Password updated successfully.",
    };
  } catch (error: any) {
    console.error("Rider password change error:", error.message);
    return {
      error: error.message || "Failed to update password. Please try again.",
    };
  }
}
