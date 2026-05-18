"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/logger";

export async function revalidateRidersPage() {
  revalidatePath("/admin/riders");
  return { success: true };
}

export async function updateRiderDetails(
  userId: string,
  fullName: string,
  mobile: string,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ full_name: fullName, mobile: mobile })
    .eq("id", userId);
  if (error) return { success: false, error: error.message };
  await logAdminAction("UPDATE_RIDER", "users", userId, {
    full_name: fullName,
    mobile: mobile,
  });
  revalidatePath("/admin/riders");
  return { success: true };
}

export async function deleteRider(riderId: string) {
  const supabase = await createClient();
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: riderData, error: fetchError } = await supabase
    .from("rider_profiles")
    .select("user_id")
    .eq("id", riderId)
    .single();
  if (fetchError || !riderData)
    return { success: false, error: "Rider profile not found." };
  const userId = riderData.user_id;

  try {
    await supabase
      .from("rider_service_areas")
      .update({ rider_id: null })
      .eq("rider_id", riderId);
    const { error: profileError } = await supabase
      .from("rider_profiles")
      .delete()
      .eq("id", riderId);
    if (profileError) throw profileError;
    const { error: userError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);
    if (userError) throw userError;
    const { error: authError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) throw authError;

    await logAdminAction("DELETE_RIDER", "rider_profiles", riderId, {
      action: "Deep deleted rider",
    });
    revalidatePath("/admin/riders");
    return { success: true };
  } catch (error: any) {
    if (error.code === "23503")
      return {
        success: false,
        error:
          "Cannot delete this rider because they have historical delivery records.",
      };
    return {
      success: false,
      error: error.message || "Failed to fully delete the rider account.",
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
  const supabase = await createClient();
  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", formData.email)
    .single();
  if (existingUser)
    return {
      success: false,
      error: "This email ID is already linked to an account.",
    };

  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: formData.email,
      password: formData.password,
      email_confirm: true,
      user_metadata: { full_name: formData.fullName },
    });
  if (authError) return { success: false, error: authError.message };
  const userId = authData.user.id;

  const { data: roleData } = await supabase
    .from("roles")
    .select("id")
    .eq("code", "RIDER")
    .single();
  if (roleData?.id)
    await supabase
      .from("users")
      .upsert({
        id: userId,
        auth_user_id: userId,
        full_name: formData.fullName,
        email: formData.email,
        mobile: formData.mobile,
        role_id: roleData.id,
        force_password_change: true,
      });
  const { error: profileError } = await supabase
    .from("rider_profiles")
    .insert({
      user_id: userId,
      employee_code: formData.employeeCode,
      is_online: false,
    });
  if (profileError) return { success: false, error: profileError.message };

  await logAdminAction("ONBOARD_RIDER", "rider_profiles", userId, {
    employeeCode: formData.employeeCode,
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
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    if (id) {
      const { error } = await supabaseAdmin
        .from("rider_service_areas")
        .update({ area_name: areaName, pincode })
        .eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin
        .from("rider_service_areas")
        .insert({ area_name: areaName, pincode });
      if (error) throw error;
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
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await supabaseAdmin
      .from("rider_service_areas")
      .delete()
      .eq("id", id);
    if (error) throw error;

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
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await supabaseAdmin
      .from("rider_service_areas")
      .update({ rider_id: riderId })
      .eq("id", areaId);
    if (error) throw error;

    revalidatePath("/admin/riders");
    return { success: true };
  } catch (error: any) {
    console.error("Assign Area Error:", error);
    return { success: false, error: "Failed to update rider mapping." };
  }
}