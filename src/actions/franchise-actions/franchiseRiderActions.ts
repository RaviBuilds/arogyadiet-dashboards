"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";

/**
 * Onboard a rider for a franchise.
 * Same as admin onboardRider but stamps franchise_id.
 */
export async function franchiseOnboardRider(formData: {
  fullName: string;
  email: string;
  mobile: string;
  employeeCode: string;
  password: string;
  franchiseId: string;
}) {
  const supabaseAdmin = createAdminClient();

  if (!formData.franchiseId) {
    return { success: false, error: "Franchise ID is required." };
  }

  const { data: existingUser } = await supabaseAdmin
    .from("users")
    .select("id, is_active")
    .eq("email", formData.email)
    .single();

  if (existingUser) {
    if (!existingUser.is_active) {
      const { data: roleData } = await supabaseAdmin
        .from("roles")
        .select("id")
        .eq("code", "RIDER")
        .single();

      if (roleData?.id) {
        await supabaseAdmin
          .from("users")
          .update({
            is_active: true,
            role_id: roleData.id,
            full_name: formData.fullName,
            mobile: formData.mobile,
            franchise_id: formData.franchiseId,
            force_password_change: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingUser.id);

        const { data: existingProfile } = await supabaseAdmin
          .from("rider_profiles")
          .select("id")
          .eq("user_id", existingUser.id)
          .single();

        if (existingProfile) {
          await supabaseAdmin
            .from("rider_profiles")
            .update({
              is_active: true,
              franchise_id: formData.franchiseId,
              employee_code: formData.employeeCode,
            })
            .eq("id", existingProfile.id);
        } else {
          await supabaseAdmin.from("rider_profiles").insert({
            user_id: existingUser.id,
            employee_code: formData.employeeCode,
            is_online: false,
            franchise_id: formData.franchiseId,
          });
        }

        await logAdminAction("REACTIVATE", "rider", existingUser.id, {
          employee_code: formData.employeeCode,
          email: formData.email,
          franchise_id: formData.franchiseId,
        });
        revalidatePath("/franchise/riders");
        return { success: true };
      }
    }

    return {
      success: false,
      error: "This email ID is already linked to an active account.",
    };
  }

  // Create new auth user
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: formData.email,
      password: formData.password,
      email_confirm: true,
      user_metadata: { full_name: formData.fullName },
    });

  if (authError) return { success: false, error: authError.message };
  const userId = authData.user.id;

  // Get RIDER role
  const { data: roleData } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("code", "RIDER")
    .single();

  if (roleData?.id) {
    await supabaseAdmin.from("users").upsert({
      id: userId,
      auth_user_id: userId,
      full_name: formData.fullName,
      email: formData.email,
      mobile: formData.mobile,
      role_id: roleData.id,
      franchise_id: formData.franchiseId,
      force_password_change: true,
    });
  }

  const { error: profileError } = await supabaseAdmin
    .from("rider_profiles")
    .insert({
      user_id: userId,
      employee_code: formData.employeeCode,
      is_online: false,
      franchise_id: formData.franchiseId,
    });

  if (profileError) return { success: false, error: profileError.message };

  await logAdminAction("CREATE", "rider", userId, {
    employee_code: formData.employeeCode,
    email: formData.email,
    franchise_id: formData.franchiseId,
  });
  revalidatePath("/franchise/riders");
  return { success: true };
}

/**
 * Update rider details (franchise admin version).
 */
export async function franchiseUpdateRiderDetails(
  userId: string,
  fullName: string,
  mobile: string,
  emergencyContact: string,
  joiningDate: string,
) {
  const supabaseAdmin = createAdminClient();

  const { error: userError } = await supabaseAdmin
    .from("users")
    .update({ full_name: fullName, mobile })
    .eq("id", userId);

  if (userError) return { success: false, error: userError.message };

  const { error: profileError } = await supabaseAdmin
    .from("rider_profiles")
    .update({ emergency_contact: emergencyContact, joining_date: joiningDate })
    .eq("user_id", userId);

  if (profileError) return { success: false, error: profileError.message };

  revalidatePath("/franchise/riders");
  return { success: true };
}

/**
 * Deactivate a rider (franchise admin version).
 */
export async function franchiseDeleteRider(riderId: string) {
  const supabaseAdmin = createAdminClient();

  const { data: riderData, error: fetchError } = await supabaseAdmin
    .from("rider_profiles")
    .select("user_id, is_active")
    .eq("id", riderId)
    .single();

  if (fetchError || !riderData)
    return { success: false, error: "Rider profile not found." };
  if (!riderData.is_active)
    return { success: false, error: "Rider account is already deactivated." };

  const userId = riderData.user_id;

  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("auth_user_id")
    .eq("id", userId)
    .single();

  try {
    await supabaseAdmin
      .from("rider_service_areas")
      .update({ rider_id: null })
      .eq("rider_id", riderId);

    await supabaseAdmin
      .from("rider_profiles")
      .update({ is_active: false, is_online: false })
      .eq("id", riderId);

    await supabaseAdmin
      .from("users")
      .update({ is_active: false })
      .eq("id", userId);

    if (userData?.auth_user_id) {
      await supabaseAdmin.auth.admin.updateUserById(userData.auth_user_id, {
        ban_duration: "876600h",
      });
    }

    revalidatePath("/franchise/riders");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to deactivate rider." };
  }
}
