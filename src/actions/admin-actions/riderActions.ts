"use server";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export async function revalidateRidersPage() {
  revalidatePath("/admin/riders");
  return { success: true };
}

export async function updateRiderDetails(
  userId: string,
  fullName: string,
  mobile: string,
  emergencyContact: string,
  joiningDate: string,
) {
  const supabaseAdmin = createAdminClient();

  const { error: userError } = await supabaseAdmin
    .from("users")
    .update({ full_name: fullName, mobile: mobile })
    .eq("id", userId);

  if (userError) {
    console.error("User update error:", userError);
    return { success: false, error: userError.message };
  }

  const { error: riderProfileError } = await supabaseAdmin
    .from("rider_profiles")
    .update({
      emergency_contact: emergencyContact,
      joining_date: joiningDate ,
    })
    .eq("user_id", userId);

  if (riderProfileError) {
    console.error("Rider profile update error:", riderProfileError);
    return { success: false, error: riderProfileError.message };
  }

  await logAdminAction("UPDATE", "rider", userId, {
    full_name: fullName,
    mobile: mobile,
    emergency_contact: emergencyContact,
    joining_date: joiningDate,
  });
  revalidatePath("/admin/riders");
  return { success: true };
}

export async function deleteRider(riderId: string) {
  const supabaseAdmin = createAdminClient();
  const { data: riderData, error: fetchError } = await supabaseAdmin
    .from("rider_profiles")
    .select("user_id, is_active")
    .eq("id", riderId)
    .single();
  if (fetchError || !riderData)
    return { success: false, error: "Rider profile not found." };
  if (riderData.is_active === false) {
    return { success: false, error: "Rider account is already deactivated." };
  }

  const userId = riderData.user_id;

  const { data: userData, error: userFetchError } = await supabaseAdmin
    .from("users")
    .select("auth_user_id")
    .eq("id", userId)
    .single();
  if (userFetchError || !userData) {
    return { success: false, error: "Rider user account not found." };
  }

  try {
    const { error: areaError } = await supabaseAdmin
      .from("rider_service_areas")
      .update({ rider_id: null })
      .eq("rider_id", riderId);
    if (areaError) throw areaError;

    const { error: profileError } = await supabaseAdmin
      .from("rider_profiles")
      .update({ is_active: false, is_online: false })
      .eq("id", riderId);
    if (profileError) throw profileError;

    const { error: userError } = await supabaseAdmin
      .from("users")
      .update({ is_active: false })
      .eq("id", userId);
    if (userError) throw userError;

    if (userData.auth_user_id) {
      const { error: authError } =
        await supabaseAdmin.auth.admin.updateUserById(userData.auth_user_id, {
          ban_duration: "876600h",
        });
      if (authError) throw authError;
    }

    await logAdminAction("DELETE", "rider", riderId, {
      user_id: userId,
      soft_deleted: true,
    });
    revalidatePath("/admin/riders");
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Failed to deactivate the rider account.",
    };
  }
}

export async function onboardRider(formData: {
  fullName: string;
  email: string;
  mobile: string;
  employeeCode: string;
  password: string;
}) {
  const supabaseAdmin = createAdminClient();
  
  const { data: existingUser } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", formData.email)
    .single();
  if (existingUser)
    return {
      success: false,
      error: "This email ID is already linked to an account.",
    };

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: formData.email,
      password: formData.password,
      email_confirm: true,
      user_metadata: { full_name: formData.fullName },
    });
  if (authError) return { success: false, error: authError.message };
  const userId = authData.user.id;

  const { data: roleData } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("code", "RIDER")
    .single();
  if (roleData?.id)
    await supabaseAdmin.from("users").upsert({
      id: userId,
      auth_user_id: userId,
      full_name: formData.fullName,
      email: formData.email,
      mobile: formData.mobile,
      role_id: roleData.id,
      force_password_change: true,
    });
  const { error: profileError } = await supabaseAdmin
    .from("rider_profiles")
    .insert({
      user_id: userId,
      employee_code: formData.employeeCode,
      is_online: false,
    });
  if (profileError) return { success: false, error: profileError.message };

  await logAdminAction("CREATE", "rider", userId, {
    employee_code: formData.employeeCode,
    email: formData.email,
  });
  revalidatePath("/admin/riders");
  return { success: true };
}

// --- NEW: SERVICE AREA ACTIONS ---
export async function upsertServiceArea(
  id: string | null,
  areaName: string,
  pincode: string,
) {
  try {
    const supabaseAdmin = createAdminClient();

    if (id) {
      const { error } = await supabaseAdmin
        .from("rider_service_areas")
        .update({ area_name: areaName, pincode })
        .eq("id", id);
      if (error) throw error;
      await logAdminAction("UPDATE", "service_area", id, { area_name: areaName, pincode });
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("rider_service_areas")
        .insert({ area_name: areaName, pincode })
        .select("id")
        .single();
      if (error) throw error;
      await logAdminAction("CREATE", "service_area", inserted?.id ?? null, {
        area_name: areaName,
        pincode,
      });
    }

    revalidatePath("/admin/riders");
    return { success: true };
  } catch (error: any) {
    console.error("Upsert Area Error:", error);
    return {
      success: false,
      error:
        error.code === "23505"
          ? `The pincode ${pincode} is already added to the system.`
          : error.message,
    };
  }
}

export async function deleteServiceArea(id: string) {
  try {
    const supabaseAdmin = createAdminClient();
    const { error } = await supabaseAdmin
      .from("rider_service_areas")
      .delete()
      .eq("id", id);
    if (error) throw error;

    await logAdminAction("DELETE", "service_area", id, {});
    revalidatePath("/admin/riders");
    return { success: true };
  } catch (error: any) {
    console.error("Delete Area Error:", error);
    return {
      success: false,
      error: "Failed to delete area. It might be linked to existing data.",
    };
  }
}

export async function updateAreaAssignment(
  areaId: string,
  riderId: string | null,
) {
  try {
    const supabaseAdmin = createAdminClient();
    const { error } = await supabaseAdmin
      .from("rider_service_areas")
      .update({ rider_id: riderId })
      .eq("id", areaId);
    if (error) throw error;

    await logAdminAction("UPDATE", "service_area", areaId, { rider_id: riderId });
    revalidatePath("/admin/riders");
    return { success: true };
  } catch (error: any) {
    console.error("Assign Area Error:", error);
    return { success: false, error: "Failed to update rider mapping." };
  }
}